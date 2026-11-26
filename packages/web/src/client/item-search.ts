/**
 * The Items page's search: ranks `search-index.json` for the text and chips in the URL. Items
 * narrow the grouped table in place; any other record type lists its results under the field.
 */

import type { PreparedEntry, RankedResult } from './search-rank.ts';

import { matchesFilters } from './palette-filters.ts';
import { prepareEntry, rank } from './search-rank.ts';

/**
 * Most results listed at once; refine the search or the chips to see others.
 */
const MAX_RESULTS = 50;

/**
 * Prepared index, fetched on first use.
 */
let index: Promise<Array<PreparedEntry>> | undefined;

/**
 * Counts searches so a slow index load never overwrites newer results.
 */
let version = 0;

/**
 * Fetches and prepares the index once.
 *
 * @param url Index URL.
 * @returns Prepared records.
 */
function load(url: string): Promise<Array<PreparedEntry>> {
  index ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Search index unavailable');
      }

      const entries: unknown = await response.json();
      if (!Array.isArray(entries)) {
        throw new Error('Search index has an unexpected shape');
      }

      return entries.map(prepareEntry);
    })
    .catch((error: unknown) => {
      index = undefined;
      throw error;
    });
  return index;
}

/**
 * Builds one result row as a link, with author text set as text only.
 *
 * @param result Ranked record.
 * @returns List item.
 */
function resultRow({ entry, snippet }: RankedResult): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'row';
  const main = document.createElement('div');
  main.className = 'row-main';
  const title = document.createElement('div');
  title.className = 'row-title';
  const link = document.createElement('a');
  link.href = entry.href;
  link.textContent = entry.title;
  const kind = document.createElement('span');
  kind.className = 'tag';
  kind.textContent = entry.kind;
  title.append(link, kind);
  main.append(title);
  const summary = snippet.map(({ text }) => text).join('');
  if (summary) {
    const line = document.createElement('p');
    line.className = 'row-summary';
    line.textContent = summary;
    main.append(line);
  }

  row.append(main);
  return row;
}

/**
 * Shows either the narrowed table or the result list.
 *
 * @param scope Items page section.
 * @param listing Whether to show results instead of the table.
 */
function show(scope: Element, listing: boolean): void {
  const table = scope.querySelector<HTMLElement>('[data-index-list]');
  const results = scope.querySelector<HTMLElement>('[data-inline-results]');
  if (table && results) {
    table.hidden = listing;
    results.hidden = !listing;
  }
}

/**
 * Restricts the table to the matched items, or lifts the restriction with undefined.
 */
type MatchSetter = (ids: ReadonlySet<string> | undefined) => void;

/**
 * Runs the search for the current URL.
 *
 * @param setTextMatches Restricts the table rows to the matched items.
 */
export async function searchItems(setTextMatches: MatchSetter): Promise<void> {
  const scope = document.querySelector('#browse');
  const url = document.querySelector<HTMLElement>('[data-index]')?.dataset['index'];
  if (!scope || url === undefined) {
    return;
  }

  const params = new URLSearchParams(location.search);
  const query = params.get('q') ?? '';
  const type = params.get('type') ?? 'item';
  const current = (version += 1);
  if (!query.trim() && type === 'item') {
    show(scope, false);
    orderTable(scope, []);
    setTextMatches(undefined);
    return;
  }

  params.set('type', type);
  try {
    const prepared = await load(url);
    if (current !== version) {
      return;
    }

    const results = rank(
      prepared.filter(({ entry }) => matchesFilters(entry, params)),
      query,
    );
    if (type === 'item') {
      show(scope, false);
      const ids = results.map(({ entry }) => entry.id);
      orderTable(scope, ids);
      setTextMatches(new Set(ids));
      return;
    }

    orderTable(scope, []);
    setTextMatches(undefined);
    listResults(scope, results);
  } catch {
    if (current === version) {
      show(scope, true);
      say(scope, 'Search is unavailable. Reload the page to retry.');
    }
  }
}

/**
 * Lists results of other record types under the field and counts them.
 *
 * @param scope Items page section.
 * @param results Ranked results.
 */
function listResults(scope: Element, results: ReadonlyArray<RankedResult>): void {
  show(scope, true);
  const shown = results.slice(0, MAX_RESULTS);
  scope.querySelector('[data-search-results]')?.replaceChildren(...shown.map(resultRow));
  const total = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
  const label = shown.length < results.length ? `${total}, showing ${shown.length}` : total;
  for (const counter of document.querySelectorAll('[data-filter-count]')) {
    counter.textContent = label;
  }

  say(
    scope,
    results.length === 0 ? 'No results. Try a different title, name, ID or Jira key.' : label,
  );
}

/**
 * Updates the announced result message.
 *
 * @param scope Items page section.
 * @param text Message.
 */
function say(scope: Element, text: string): void {
  const message = scope.querySelector('[data-search-message]');
  if (message) {
    message.textContent = text;
  }
}

/**
 * Puts the item table in rank order: feature-set groups by their best-ranked item, items within a
 * group by rank. Rows that did not match keep their place at the end (they are hidden). An empty
 * ranking restores the catalogue order, so the DOM always reads in the order shown.
 *
 * @param scope Items page section.
 * @param ranked Matching item IDs, best first; empty for catalogue order.
 */
function orderTable(scope: Element, ranked: ReadonlyArray<string>): void {
  const table = scope.querySelector('.catalogue-table');
  if (!table) {
    return;
  }

  const groups = [...table.querySelectorAll<HTMLElement>('tbody[data-work-group]')];
  original ??= groups.map((group) => ({
    group,
    rows: [...group.querySelectorAll<HTMLElement>('tr[data-filter-entry]')],
  }));
  const position = new Map(ranked.map((id, place) => [id, place]));
  /**
   * Rank of a row, or the end for rows that did not match.
   */
  const rankOf = (row: HTMLElement): number =>
    position.get(row.dataset['filterEntry'] ?? '') ?? Number.POSITIVE_INFINITY;
  const ordered = original.map(({ group, rows }, order) => {
    const sorted = rows
      .map((row, place) => ({ row, place }))
      .toSorted((a, b) => rankOf(a.row) - rankOf(b.row) || a.place - b.place)
      .map(({ row }) => row);
    return { group, rows: sorted, best: Math.min(...sorted.map(rankOf)), order };
  });
  for (const { group, rows } of ordered.toSorted((a, b) => a.best - b.best || a.order - b.order)) {
    group.append(...rows);
    table.append(group);
  }
}

/**
 * The catalogue's own order of groups and rows, recorded before the first reordering.
 */
let original: Array<{ group: HTMLElement; rows: Array<HTMLElement> }> | undefined;
