/**
 * The search palette's URL contract.
 *
 * - `pq` is the palette's query. `search=palette` means the palette is open; `search=filters` means
 *   it is open with its Filters disclosure expanded.
 * - The palette never reads or writes `q` or `collection-q`: those belong to the page's own search
 *   field (Items, Releases, Feature sets).
 * - The palette's filters (`type`, `status`, `release`, `set`, `team`) are the same parameters the
 *   page lists read. Closing the palette removes `pq` and `search`, and puts back, as they were
 *   when it opened, every filter the page has no chip for (all of them on the home page and on
 *   record pages), so a closed page never carries palette-only state.
 * - A URL with `search=palette|filters` reopens the palette on any page.
 * - Older links: on the home page (Releases), `q`, `search=1`, filter parameters or an Items fragment
 *   are old Items links and forward to `items/` (legacy-home.ts). Elsewhere, outside the Items
 *   page, an older `q` is moved to `pq` and opens the palette.
 */

import { FILTERS_CHANGED } from './events.ts';

/**
 * URL parameters the palette narrows by, in display order.
 */
export const FILTER_NAMES = ['type', 'status', 'release', 'set', 'team'] as const;

/**
 * Parameter holding the palette's query.
 */
export const PALETTE_QUERY = 'pq';

/**
 * `search` value while the palette is open.
 */
export const OPEN = 'palette';

/**
 * `search` value while the palette is open with its filters expanded.
 */
export const FILTERS_OPEN = 'filters';

/**
 * The palette's state as the URL records it.
 */
export type PaletteState = {
  /**
   * Whether the palette is open.
   */
  open: boolean;

  /**
   * Whether its filters are expanded.
   */
  filters: boolean;

  /**
   * Its query.
   */
  query: string;
};

/**
 * Reads the palette's state from URL parameters.
 *
 * @param params URL parameters.
 * @returns Palette state.
 */
export function readPaletteState(params: URLSearchParams): PaletteState {
  const search = params.get('search');
  return {
    open: search === OPEN || search === FILTERS_OPEN,
    filters: search === FILTERS_OPEN,
    query: params.get(PALETTE_QUERY) ?? '',
  };
}

/**
 * Records the palette as open, with or without its filters, keeping everything else.
 *
 * @param filters Whether the filters are expanded.
 */
export function writeOpen(filters: boolean): void {
  const url = new URL(location.href);
  url.searchParams.set('search', filters ? FILTERS_OPEN : OPEN);
  history.replaceState(null, '', url);
}

/**
 * Records the palette's query.
 *
 * @param query Search text.
 */
export function writeQuery(query: string): void {
  const url = new URL(location.href);
  if (query.trim()) {
    url.searchParams.set(PALETTE_QUERY, query.trim());
  } else {
    url.searchParams.delete(PALETTE_QUERY);
  }

  history.replaceState(null, '', url);
}

/**
 * Captures the filter parameters when the palette opens.
 *
 * @returns Filter values by name; absent filters are left out.
 */
export function snapshotFilters(): Map<string, string> {
  const params = new URLSearchParams(location.search);
  return new Map(
    FILTER_NAMES.flatMap((name): Array<[string, string]> => {
      const value = params.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

/**
 * Removes the palette's state when it closes, and puts back every filter the page has no chip for
 * as it was when the palette opened.
 *
 * @param before Filters when the palette opened.
 */
export function closePaletteUrl(before: ReadonlyMap<string, string>): void {
  const url = new URL(location.href);
  url.searchParams.delete(PALETTE_QUERY);
  url.searchParams.delete('search');
  for (const name of FILTER_NAMES) {
    if (document.querySelector(`[data-filter="${name}"]`)) {
      continue;
    }

    const value = before.get(name);
    if (value === undefined) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }

  history.replaceState(null, '', url);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}

/**
 * Moves an older palette link's `q` (and `search=1`) to the palette's own parameters, on pages
 * whose search field does not use `q`.
 *
 * @returns The palette state after the move.
 */
export function adoptLegacyQuery(): PaletteState {
  const url = new URL(location.href);
  const state = readPaletteState(url.searchParams);
  const legacy = url.searchParams.get('q');
  const filters = url.searchParams.get('search') === '1';
  if (state.open || (!legacy && !filters)) {
    return state;
  }

  url.searchParams.delete('q');
  if (legacy) {
    url.searchParams.set(PALETTE_QUERY, legacy);
  }

  url.searchParams.set('search', filters ? FILTERS_OPEN : OPEN);
  history.replaceState(null, '', url);
  return readPaletteState(url.searchParams);
}
