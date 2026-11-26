import { FILTER_NAMES, readPaletteState } from './palette-url.ts';

/**
 * Query parameters the Items catalogue read when it was the home page.
 */
const ITEMS_PARAMETERS = ['q', ...FILTER_NAMES];

/**
 * Decodes a URL fragment, tolerating malformed escapes.
 *
 * @param hash `location.hash`.
 * @returns The fragment id, or the raw text when it cannot be decoded.
 */
function fragmentId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/**
 * Whether the current URL is an Items link from when Items was the home page: `q`, the Items
 * filters' `search=1`, a filter parameter, or a fragment the Items page renders that the home page
 * does not. URLs with the palette's own state are not.
 *
 * @param home Home page root with the Items anchors.
 * @returns Whether to forward.
 */
function isLegacyItemsLink(home: HTMLElement): boolean {
  const params = new URLSearchParams(location.search);
  if (readPaletteState(params).open || params.has('pq')) {
    return false;
  }

  const fragment = fragmentId(location.hash);
  const anchors = new Set((home.dataset['itemsAnchors'] ?? '').split(' ').filter(Boolean));
  const oldAnchor = anchors.has(fragment) && document.getElementById(fragment) === null;
  return (
    oldAnchor || params.get('search') === '1' || ITEMS_PARAMETERS.some((name) => params.has(name))
  );
}

/**
 * Sends an old Items link on to the Items page with its query and fragment. `search=1` is dropped:
 * the Items page shows its filters anyway, and the palette must not take over the Items search.
 *
 * @param home Home page root.
 * @returns Whether the page is navigating away.
 */
function forward(home: HTMLElement): boolean {
  const target = home.dataset['itemsForward'];
  if (target === undefined || !isLegacyItemsLink(home)) {
    return false;
  }

  const params = new URLSearchParams(location.search);
  params.delete('search');
  const query = params.toString();
  location.replace(`${target}${query ? `?${query}` : ''}${location.hash}`);
  return true;
}

/**
 * On the home page, forwards old Items links now and after in-page fragment changes.
 *
 * @returns Whether the page is navigating away.
 */
export function forwardLegacyItemsLinks(): boolean {
  const home = document.querySelector<HTMLElement>('[data-items-forward]');
  if (!home) {
    return false;
  }

  addEventListener('hashchange', () => forward(home));
  return forward(home);
}
