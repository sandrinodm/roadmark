import type { Compilation, Kind } from '@roadmark/compiler/model';

import { readFile } from 'node:fs/promises';

import type { Page } from './ui/shell.ts';

import { renderBrandStyles } from './brand.ts';
import { clientAssets } from './client-bundle.ts';
import { route, siteData } from './data.ts';
import { featureSetsPage, releasePlan } from './pages/collections.ts';
import { viewsPage } from './pages/directory.ts';
import { itemsPage } from './pages/items.ts';
import { movedPage } from './pages/moved.ts';
import { peoplePage, personPage } from './pages/people.ts';
import { entityPage, recordHeading } from './pages/record.ts';
import { setItemsPage } from './pages/set-items.ts';
import { teamPage, teamsPage } from './pages/teams.ts';
import { timelinePage } from './pages/timeline.ts';
import { profileView } from './profile-view.ts';
import { searchIndex } from './search-index.ts';
import { shell } from './ui/shell.ts';

/**
 * Static stylesheet and display font shipped with every build.
 */
const BROWSER_FILES: ReadonlyArray<[source: string, output: string]> = [
  ['styles/site.css', 'site.css'],
  ['fonts/geist-latin.woff2', 'geist-latin.woff2'],
  ['fonts/geist-license.txt', 'geist-license.txt'],
];

/**
 * Default inline source for the roadmap's site mark.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="5" fill="#27272a"/>
  <path d="M6.5 23.5h5a4.5 4.5 0 0 0 4.5-4.5v-6a4.5 4.5 0 0 1 4.5-4.5h5M7.5 16h3.5m10 0h3.5"
    fill="none" stroke="#fafafa" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="11" cy="23.5" r="2.2" fill="#fafafa"/>
  <path d="m24 6 2.5 2.5L24 11l-2.5-2.5z" fill="#fafafa"/>
</svg>`;

/**
 * Renders all public site pages, indexes, and base assets for a validated compilation.
 *
 * @param model Validated roadmap model with rendered Markdown.
 * @param base Normalized, slash-terminated URL prefix.
 * @returns Map from output-relative paths to rendered text or binary assets.
 * @throws If a bundled asset cannot be read.
 */
export async function renderSite(
  model: Compilation,
  base: string,
): Promise<Map<string, string | Uint8Array>> {
  const data = siteData(model, base);
  const files = new Map<string, string | Uint8Array>(model.diagrams);
  const [home, items] = entryPages(data);
  files.set('index.html', home);
  files.set('items/index.html', items);
  files.set('themes/index.html', items);

  const pages = [
    {
      key: 'sets/index.html',
      title: 'Feature sets',
      nav: 'sets',
      html: featureSetsPage(data),
    },
    {
      key: 'timeline/index.html',
      title: 'Timeline',
      nav: 'timeline',
      timeline: true,
      html: timelinePage(data),
    },
    {
      key: 'views/index.html',
      title: 'Directory',
      nav: 'people',
      html: peoplePage(data),
    },
    {
      key: 'views/scopes/index.html',
      title: 'Work scopes',
      html: viewsPage(data),
    },
    {
      key: 'teams/index.html',
      title: 'Teams',
      nav: 'teams',
      html: teamsPage(data),
    },
    {
      key: 'people/index.html',
      title: 'People',
      nav: 'people',
      html: peoplePage(data),
    },
  ] as const;
  for (const page of pages) {
    files.set(page.key, shell(data, page, page.html));
  }

  files.set('releases/index.html', movedPage(data, 'Releases', data.base));
  for (const [key, page] of setItemsPages(data)) {
    files.set(key, page);
  }

  for (const entity of data.entities) {
    const page: Page = {
      title: entity.title,
      nav: collectionFor(entity.kind),
      description: entity.description,
      itemPage: entity.kind === 'item',
    };
    files.set(
      `${route(entity.kind, entity.id)}index.html`,
      shell(data, page, entityPage(data, entity)),
    );
  }

  for (const [kind, directory] of [
    ['team', data.teams],
    ['person', data.people],
  ] as const) {
    for (const [id, title] of directory) {
      const view = profileView(data, kind, id);
      const prefix = route(kind, id);
      const profile = kind === 'person' ? personPage(data, view) : teamPage(data, view);
      const nav = kind === 'person' ? 'people' : 'teams';
      files.set(`${prefix}index.html`, shell(data, { title, nav }, profile));
      files.set(
        `${prefix}timeline/index.html`,
        shell(data, { title: `${title} timeline`, nav, timeline: true }, timelinePage(data, view)),
      );
    }
  }

  files.set('search-index.json', searchIndex(data));
  files.set('assets/mark.svg', MARK);
  if (data.brand !== undefined) {
    files.set('assets/brand.css', renderBrandStyles(data.brand));
  }

  const [assets, client] = await Promise.all([staticAssets(), clientAssets()]);
  for (const [key, value] of assets) {
    files.set(`assets/${key}`, value);
  }

  for (const [key, value] of client) {
    files.set(key, value);
  }

  return files;
}

/**
 * Renders the home page (Releases) and the Items page. The Items page used to be the home page, so
 * its anchors are listed on the home page, which forwards them to "items/".
 *
 * @param data Indexed roadmap.
 * @returns Home and Items documents.
 */
function entryPages(data: ReturnType<typeof siteData>): [home: string, items: string] {
  const catalogue = itemsPage(data);
  const anchors = [...catalogue.value.matchAll(/\sid="([^"]+)"/g)].flatMap(([, id]) => id ?? []);
  return [
    shell(data, { title: 'Releases', nav: 'releases' }, releasePlan(data, anchors)),
    shell(data, { title: 'Items', nav: 'items' }, catalogue),
  ];
}

/**
 * Renders each feature set's Items tab.
 *
 * @param data Indexed roadmap.
 * @returns Output paths paired with documents.
 */
function setItemsPages(data: ReturnType<typeof siteData>): Array<[string, string]> {
  return data.sets.map((set) => [
    `${route('set', set.id)}items/index.html`,
    shell(
      data,
      { title: `${set.title} items`, nav: 'sets', description: set.description },
      setItemsPage(data, set, recordHeading(data, set)),
    ),
  ]);
}

/**
 * Maps a record to its parent collection in the primary navigation.
 *
 * @param kind Kind of roadmap record.
 * @returns The collection that can be used to reach this record.
 */
function collectionFor(kind: Kind): NonNullable<Page['nav']> {
  let collection: NonNullable<Page['nav']>;
  switch (kind) {
    case 'release':
      collection = 'releases';
      break;
    case 'set':
      collection = 'sets';
      break;
    case 'item':
      collection = 'items';
      break;
  }

  return collection;
}

/**
 * Loads the built-in stylesheet, display font and its licence.
 *
 * @returns Output asset names paired with their bytes.
 * @throws If a required bundled asset cannot be read.
 */
async function staticAssets(): Promise<Array<[string, Uint8Array]>> {
  return Promise.all(
    BROWSER_FILES.map(async ([file, output]): Promise<[string, Uint8Array]> => [
      output,
      await readFile(new URL(file, import.meta.url)),
    ]),
  );
}
