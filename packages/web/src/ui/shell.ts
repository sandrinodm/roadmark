import type { SiteData } from '../data.ts';
import type { SafeHtml } from './html.ts';
import type { IconName } from './icons.ts';

import { brandColorScheme } from '../brand.ts';
import { CLIENT_DIRECTORY } from '../client-bundle.ts';
import { icon } from './glyph.ts';
import { html } from './html.ts';

/**
 * Primary destinations, in header order.
 */
export type Destination = 'releases' | 'sets' | 'items' | 'timeline' | 'people' | 'teams';

/**
 * Page metadata used by the shared document shell.
 */
export type Page = {
  /**
   * Visible page name used for the document title.
   */
  title: string;

  /**
   * Optional metadata description for the page.
   */
  description?: string;

  /**
   * Primary destination that represents the current page, when applicable.
   */
  nav?: Destination;

  /**
   * Uses the article shell for a single roadmap item.
   */
  itemPage?: boolean;

  /**
   * Loads the interactive chart on pages that contain a timeline.
   */
  timeline?: boolean;
};

/**
 * Header links in display order.
 */
const DESTINATIONS: ReadonlyArray<[Destination, string, IconName]> = [
  ['releases', 'Releases', 'release'],
  ['sets', 'Feature sets', 'set'],
  ['items', 'Items', 'work'],
  ['timeline', 'Timeline', 'timeline'],
  ['people', 'People', 'person'],
  ['teams', 'Teams', 'team'],
];

/**
 * Default workspace mark and its display size in pixels.
 */
const DEFAULT_LOGO = {
  /**
   * Path relative to the deployed site.
   */
  output: 'assets/mark.svg',

  /**
   * Display width in pixels.
   */
  width: 28,

  /**
   * Display height in pixels.
   */
  height: 28,
};

/**
 * Wraps page content in the document shell: head, app bar, main landmark and scripts.
 *
 * @param data Indexed workspace and resolved presentation settings.
 * @param page Document title and navigation metadata.
 * @param main Rendered main content.
 * @returns Complete HTML document.
 */
export function shell(data: SiteData, page: Page, main: SafeHtml): string {
  const { base } = data;
  const { scheme, logo, themeColor } = presentation(data);
  return html`<!doctype html>
<html lang="en"${scheme === 'dark' ? html` class="dark"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${page.description ?? data.workspace.title}">
  <meta name="color-scheme" content="${scheme}">
  <meta name="theme-color" content="${themeColor}">
  <title>${page.title} · ${data.workspace.title}</title>
  <link rel="icon" href="${base + logo.output}">
  <link rel="stylesheet" href="${base}assets/site.css">
  ${data.brand === undefined ? '' : html`<link rel="stylesheet" href="${base}assets/brand.css" />`}
  <script type="module" src="${base + CLIENT_DIRECTORY}boot.js"></script>
</head>
<body${page.itemPage ? html` class="item-page"` : ''}>
  <a class="skip-link" href="#main">Skip to content</a>
  ${appBar(data, page, logo)}
  <main id="main" tabindex="-1" class="app-main reader-main">${main}</main>
</body>
</html>
`.value;
}

/**
 * Resolves the brand settings the document head and app bar need.
 *
 * @param data Workspace and resolved brand.
 * @returns Colour scheme, logo and theme colour.
 */
function presentation(data: SiteData) {
  const config = data.brand?.config;
  return {
    scheme: brandColorScheme(config?.colors?.surface),
    logo: data.brand?.logo ?? DEFAULT_LOGO,
    themeColor: config?.header?.background ?? config?.colors?.surface ?? '#ffffff',
  };
}

/**
 * Renders the workspace mark, primary navigation and search button.
 *
 * @param data Workspace and resolved brand.
 * @param page Current page and navigation context.
 * @param logo Local mark and its display dimensions.
 * @returns App bar markup.
 */
function appBar(data: SiteData, page: Page, logo: typeof DEFAULT_LOGO): SafeHtml {
  const { base } = data;
  const workspace = data.workspace.title;
  const showTitle = !data.brand?.logo || data.brand.config.header?.logo?.show_title !== false;
  const current = DESTINATIONS.find(([id]) => id === page.nav)?.[1] ?? 'Menu';
  return html`<header class="app-bar">
    <div class="app-bar-inner">
      <a class="app-brand" href="${base}" aria-label="${workspace} home">
        <img src="${base + logo.output}" alt="" width="${logo.width}" height="${logo.height}" />
        ${showTitle ? html`<span>${workspace}</span>` : ''}
      </a>
      <nav class="app-nav" aria-label="Primary">${navLinks(base, page, false)}</nav>
      ${searchButton(base)}
      <details class="app-menu" data-collection-picker>
        <summary aria-label="Menu, current section ${current}">
          ${icon('menu')}<span>${current}</span>
        </summary>
        <nav aria-label="Primary">${navLinks(base, page, true)}</nav>
      </details>
    </div>
  </header>`;
}

/**
 * Renders the primary destinations with the current one marked.
 *
 * @param base Deployment prefix.
 * @param page Current page context.
 * @param withIcons Whether to show a glyph before each label (the narrow-screen menu).
 * @returns Anchor list.
 */
function navLinks(base: string, page: Page, withIcons: boolean): Array<SafeHtml> {
  return DESTINATIONS.map(([id, label, glyph]) => {
    const current = page.nav === id ? html`aria-current="page"` : '';
    const preserve = id === 'items' && (page.nav === 'items' || page.timeline);
    return html`<a
      href="${base}${id === 'releases' ? '' : `${id}/`}"
      ${current}${preserve ? html` data-preserve-filters` : ''}
      >${withIcons ? icon(glyph) : ''}<span>${label}</span></a
    >`;
  });
}

/**
 * Renders the search button. It stays hidden until the boot script can open the palette.
 *
 * @param base Deployment prefix.
 * @returns Search trigger.
 */
function searchButton(base: string): SafeHtml {
  return html`<button
    class="app-search"
    type="button"
    data-search-open
    data-index="${base}search-index.json"
    aria-label="Search the roadmap"
    aria-keyshortcuts="/ Control+K Meta+K"
    hidden
  >
    ${icon('search')}<span>Search</span><kbd aria-hidden="true">/</kbd>
  </button>`;
}
