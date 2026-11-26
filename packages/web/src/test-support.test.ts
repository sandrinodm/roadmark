/**
 * Shared fixtures and HTML queries for the renderer's unit tests. The name ends in `.test.ts` so
 * packaging and the production lint rules treat it as test code; it declares no tests itself.
 */
import type { Compilation, Entity, Workspace } from '@roadmark/compiler/model';
import type { DefaultTreeAdapterTypes } from 'parse5';

import { parse, parseFragment } from 'parse5';

import type { SiteData } from './data.ts';
import type { SafeHtml } from './ui/html.ts';

import { siteData } from './data.ts';

/**
 * A parsed element.
 */
export type Element = DefaultTreeAdapterTypes.Element;

/**
 * Any parsed node that can hold children.
 */
export type Parent = DefaultTreeAdapterTypes.ParentNode;

/**
 * A deployment prefix nested below the domain root, as a team site would use.
 */
export const BASE = '/product/roadmap/';

/**
 * A title that breaks out of text and attributes unless it is escaped.
 */
export const HOSTILE = `<img src=x onerror="alert('x')"> & <script>alert(1)</script>`;

/**
 * Builds a roadmap record with every required field filled in.
 *
 * @param fields ID, title and any fields that differ from the defaults.
 * @returns Item unless `kind` says otherwise.
 */
export function entity(fields: Partial<Entity> & Pick<Entity, 'id' | 'title'>): Entity {
  return {
    kind: 'item',
    description: 'Fixture description',
    source: `${fields.id}.md`,
    html: '',
    text: 'Markdown body text',
    contributing_teams: [],
    depends_on: [],
    jira: [],
    ...fields,
  };
}

/**
 * Builds a compilation around some records.
 *
 * @param entities Records in any order.
 * @param workspace Workspace fields that differ from the defaults.
 * @returns Compilation without diagnostics or assets.
 */
export function compilation(
  entities: Array<Entity>,
  workspace: Partial<Workspace> = {},
): Compilation {
  return {
    workspace: { schema_version: 1, title: 'Fixture roadmap', people: {}, teams: {}, ...workspace },
    entities,
    assets: [],
    diagnostics: [],
  };
}

/**
 * Indexes some records under the nested deployment prefix.
 *
 * @param entities Records in any order.
 * @param workspace Workspace fields that differ from the defaults.
 * @returns Site data.
 */
export function dataFor(entities: Array<Entity>, workspace: Partial<Workspace> = {}): SiteData {
  return siteData(compilation(entities, workspace), BASE);
}

/**
 * Parses rendered markup as the body of a document. Table parts must be wrapped in a table first,
 * because the parser drops stray `<tr>` and `<td>` tags.
 *
 * @param markup Rendered fragment.
 * @returns Fragment root.
 */
export function fragment(markup: SafeHtml | string): Parent {
  return parseFragment(String(markup));
}

/**
 * Parses a complete HTML document.
 *
 * @param markup Rendered document.
 * @returns Document root.
 */
export function documentOf(markup: string): Parent {
  return parse(markup);
}

/**
 * Lists every element under a node in document order.
 *
 * @param root Parsed node.
 * @returns Descendant elements.
 */
export function elements(root: Parent): Array<Element> {
  const found: Array<Element> = [];
  for (const node of root.childNodes) {
    if ('tagName' in node) {
      found.push(node, ...elements(node));
    }
  }

  return found;
}

/**
 * Finds the elements with a tag name and, optionally, some attribute values.
 *
 * @param root Parsed node.
 * @param tag Tag name, or `*` for any.
 * @param attributes Attribute values the element must have; `true` only requires presence.
 * @returns Matching elements in document order.
 */
export function findAll(
  root: Parent,
  tag: string,
  attributes: Record<string, string | true> = {},
): Array<Element> {
  return elements(root).filter(
    (element) =>
      (tag === '*' || element.tagName === tag) &&
      Object.entries(attributes).every(([name, value]) => {
        const actual = attr(element, name);
        return value === true ? actual !== undefined : actual === value;
      }),
  );
}

/**
 * Finds the one element with a tag name and attribute values, failing when there is not exactly
 * one.
 *
 * @param root Parsed node.
 * @param tag Tag name, or `*` for any.
 * @param attributes Attribute values the element must have.
 * @returns The element.
 * @throws Error when no element or several elements match.
 */
export function findOne(
  root: Parent,
  tag: string,
  attributes: Record<string, string | true> = {},
): Element {
  const [match, ...rest] = findAll(root, tag, attributes);
  if (match === undefined || rest.length > 0) {
    throw new Error(
      `Expected one <${tag}> matching ${JSON.stringify(attributes)}, found ${rest.length + (match ? 1 : 0)}.`,
    );
  }

  return match;
}

/**
 * Reads an attribute.
 *
 * @param element Parsed element.
 * @param name Attribute name.
 * @returns Value, or undefined when absent.
 */
export function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

/**
 * Whether an element carries a class.
 *
 * @param element Parsed element.
 * @param name Class name.
 * @returns Whether the class is present.
 */
export function hasClass(element: Element, name: string): boolean {
  return (attr(element, 'class') ?? '').split(/\s+/).includes(name);
}

/**
 * Reads the text content of a node with whitespace collapsed, as a reader sees it.
 *
 * @param root Parsed node.
 * @returns Trimmed text.
 */
export function textOf(root: Parent): string {
  return rawText(root).replaceAll(/\s+/g, ' ').trim();
}

/**
 * Concatenates the text nodes under a node.
 *
 * @param root Parsed node.
 * @returns Text.
 */
function rawText(root: Parent): string {
  return root.childNodes
    .map((node) => {
      if (node.nodeName === '#text' && 'value' in node) {
        return node.value;
      }

      return 'childNodes' in node ? rawText(node) : '';
    })
    .join('');
}

/**
 * Lists the `href` of every link under a node.
 *
 * @param root Parsed node.
 * @returns Link targets in document order.
 */
export function hrefs(root: Parent): Array<string> {
  return findAll(root, 'a').flatMap((link) => attr(link, 'href') ?? []);
}

/**
 * Reads one entry of a list, failing when it is missing.
 *
 * @param list Entries.
 * @param index Position.
 * @returns The entry.
 * @throws Error when the list is shorter.
 */
export function nth<T>(list: ReadonlyArray<T>, index: number): T {
  const entry = list[index];
  if (entry === undefined) {
    throw new Error(`Expected an entry at ${index}, found ${list.length} entries.`);
  }

  return entry;
}

/**
 * The deployment prefix of the publication fixture.
 */
export const TEAM_BASE = '/teams/tools/roadmap/';

/**
 * A release whose ID is the word "unassigned", to tell it from work without a release.
 */
export const release = entity({
  kind: 'release',
  id: 'unassigned',
  title: 'Release <Beta>',
  description: 'Release description',
  status: 'in-progress',
  target: '2027-Q2',
  outcome: 'Distinguishable release outcome',
});

/**
 * A finished item in the release, with a Jira key.
 */
export const done = entity({
  id: 'done',
  title: 'Publish updates',
  status: 'done',
  target: '2027-04',
  release: release.id,
  jira: ['TEST-8'],
});

/**
 * A cancelled item in the release.
 */
export const cancelled = entity({
  id: 'cancelled',
  title: 'Former roadmap item',
  status: 'cancelled',
  target: '2027-05',
  release: release.id,
});

/**
 * An undated item without a release that depends on the finished one.
 */
export const spare = entity({
  id: 'spare',
  title: 'Get a design review',
  status: 'planned',
  depends_on: [{ item: done.id, reason: 'Needs the update log.' }],
  contributing_teams: ['design'],
});

/**
 * A small publication roadmap with a schedule warning on the finished item.
 */
export const fixture: Compilation = {
  workspace: {
    schema_version: 1,
    title: 'Publication & planning',
    people: {},
    teams: { design: 'Design' },
  },
  entities: [release, done, cancelled, spare],
  assets: [],
  diagnostics: [
    {
      severity: 'warning',
      rule: 'schedule-conflict',
      file: done.source,
      line: 4,
      column: 3,
      message: 'Check the target date.',
      fix: 'Choose a release date.',
    },
  ],
};

/**
 * Extends the publication fixture with people, including two homonyms, a feature set whose PM and
 * team the finished item inherits, and an item with a direct contributor.
 *
 * @returns Compilation.
 */
export function profilesFixture(): Compilation {
  const set = entity({
    id: 'set-design',
    kind: 'set',
    title: 'Design system',
    pm: 'alex',
    engineering_team: 'design',
  });
  const inherited = {
    ...done,
    set: set.id,
    pm: 'alex',
    inherited_pm: true,
    engineering_team: 'design',
    inherited_engineering_team: true,
    contributors: ['alex'],
    contributing_teams: ['design'],
  } satisfies Entity;
  const contributed = entity({
    id: 'release-copy',
    title: 'Write release copy',
    contributors: ['alex-ops'],
  });
  return {
    ...fixture,
    workspace: {
      ...fixture.workspace,
      people: { alex: 'Alex Reed', 'alex-ops': 'Alex Reed', taylor: 'Taylor Lee' },
      person_details: {
        alex: { role: 'Product manager', teams: ['design'] },
        taylor: { role: 'Designer', teams: ['design'] },
      },
      team_details: { design: { description: 'Facilitates reviews & design' } },
    },
    entities: [release, set, inherited, { ...cancelled, pm: 'alex-ops' }, spare, contributed],
  };
}

/**
 * Reads a rendered text file, failing when it is missing or binary.
 *
 * @param files Rendered site.
 * @param key Output path.
 * @returns File text.
 * @throws TypeError when the file is missing or binary.
 */
export function pageText(files: Map<string, string | Uint8Array>, key: string): string {
  const page = files.get(key);
  if (typeof page !== 'string') {
    throw new TypeError(`Expected ${key} to be a rendered page.`);
  }

  return page;
}

/**
 * Lists the feature-set tabs on a page as label, address and whether it is current.
 *
 * @param page Page HTML.
 * @returns One entry per tab.
 */
export function tabs(page: string): Array<string> {
  return [
    ...page.matchAll(/<a href="([^"]+)"\s*(aria-current="page")?\s*>(Overview|Items)<\/a>/g),
  ].map(([, href, current, label]) => `${label}:${href}:${current ? 'current' : ''}`);
}

/**
 * Lists the row titles of a catalogue table in order.
 *
 * @param page Page HTML.
 * @returns Titles.
 */
export function rowTitles(page: string): Array<string> {
  return [
    ...page.matchAll(/<th class="catalogue-item-title"[^>]*>\s*<a href="[^"]+">([^<]+)<\/a>/g),
  ].map(([, title = '']) => title);
}
