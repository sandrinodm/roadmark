import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atlasFile, installDom, loadPage, query, serve, setUrl } from './test-dom.ts';

/**
 * The rendered Items page and the search index it reads.
 */
const [page, index] = await Promise.all([
  atlasFile('items/index.html'),
  atlasFile('search-index.json'),
]);
// The search records the table's catalogue order once, as on a page that never changes.
installDom({ keepPage: true });
loadPage(page, '/items/');

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { searchItems } = await import('./item-search.ts');

/**
 * Calls to the match setter, latest last.
 */
let matches: Array<ReadonlySet<string> | undefined> = [];

/**
 * Records what the search restricts the table to.
 *
 * @param ids Matched IDs, or undefined for no restriction.
 */
function setTextMatches(ids: ReadonlySet<string> | undefined): void {
  matches.push(ids);
}

/**
 * Moves the Items page to a URL and serves the index.
 *
 * @param path Path and query.
 * @returns The fetch mock.
 */
function visit(path: string): ReturnType<typeof serve> {
  matches = [];
  setUrl(path);
  return serve({ '/search-index.json': index });
}

/**
 * Lists the item table's groups and rows in document order.
 *
 * @returns Set ID of each group with its row IDs.
 */
function tableOrder(): Array<[string, Array<string>]> {
  return [...document.querySelectorAll<HTMLElement>('tbody[data-work-group]')].map((group) => [
    group.dataset['workSet'] ?? '',
    [...group.querySelectorAll<HTMLElement>('tr[data-filter-entry]')].map(
      (row) => row.dataset['filterEntry'] ?? '',
    ),
  ]);
}

/**
 * The catalogue's own order, as rendered.
 */
const CATALOGUE: Array<[string, Array<string>]> = [
  ['set-billing', ['item-invoice-preview']],
  ['set-onboarding', ['item-setup-recovery', 'item-guided-setup', 'item-starter-templates']],
  ['set-platform', ['item-setup-events']],
];

void describe('searchItems', () => {
  void it('reports the search as unavailable when the index cannot load, then retries', async () => {
    setUrl('/items/?q=setup');
    const failing = serve({});
    await searchItems(setTextMatches);
    assert.equal(failing.mock.callCount(), 1);
    assert.equal(query('[data-inline-results]', HTMLElement).hidden, false);
    assert.equal(query('[data-index-list]', HTMLElement).hidden, true);
    assert.equal(
      query('[data-search-message]', HTMLElement).textContent,
      'Search is unavailable. Reload the page to retry.',
    );

    const fetched = visit('/items/?q=setup');
    await searchItems(setTextMatches);
    assert.equal(fetched.mock.callCount(), 1, 'a failed load is not cached');
    assert.equal(query('[data-inline-results]', HTMLElement).hidden, true);
  });

  void it('shows the whole table in catalogue order without a query', async () => {
    const fetched = visit('/items/');
    await searchItems(setTextMatches);
    assert.deepEqual(matches, [undefined]);
    assert.deepEqual(tableOrder(), CATALOGUE);
    assert.equal(query('[data-index-list]', HTMLElement).hidden, false);
    assert.equal(fetched.mock.callCount(), 0, 'nothing to rank, so the index is not needed');
  });

  void it('restricts the table to matching items and orders groups by their best match', async () => {
    visit('/items/?q=PLAT-88');
    await searchItems(setTextMatches);
    assert.deepEqual(matches, [new Set(['item-guided-setup', 'item-setup-events'])]);
    assert.deepEqual(tableOrder(), [
      ['set-onboarding', ['item-guided-setup', 'item-setup-recovery', 'item-starter-templates']],
      ['set-platform', ['item-setup-events']],
      ['set-billing', ['item-invoice-preview']],
    ]);

    setUrl('/items/');
    await searchItems(setTextMatches);
    assert.deepEqual(tableOrder(), CATALOGUE, 'clearing the search restores the catalogue order');
  });

  void it('applies the chips from the URL to the ranked items', async () => {
    visit('/items/?q=PLAT-88&status=done');
    await searchItems(setTextMatches);
    assert.deepEqual(matches, [new Set(['item-setup-events'])]);
  });

  void it('lists other record types under the field with a count', async () => {
    visit('/items/?q=launch&type=release');
    await searchItems(setTextMatches);
    assert.deepEqual(matches, [undefined]);
    assert.equal(query('[data-index-list]', HTMLElement).hidden, true);
    assert.equal(query('[data-inline-results]', HTMLElement).hidden, false);
    const rows = [...document.querySelectorAll('[data-search-results] li')];
    assert.deepEqual(
      rows.map((row) => [
        row.querySelector('a')?.getAttribute('href'),
        row.querySelector('a')?.textContent,
        row.querySelector('.tag')?.textContent,
      ]),
      [['/releases/rel-spring/', 'Spring onboarding launch', 'Release']],
    );
    assert.equal(query('[data-search-message]', HTMLElement).textContent, '1 result');
    assert.equal(query('[data-filter-count]', HTMLElement).textContent, '1 result');
  });

  void it('lists every record of a type for an empty query, and says when none match', async () => {
    visit('/items/?type=person');
    await searchItems(setTextMatches);
    assert.equal(document.querySelectorAll('[data-search-results] li').length, 2);
    assert.equal(query('[data-search-message]', HTMLElement).textContent, '2 results');

    setUrl('/items/?type=team&q=nothing-like-this');
    await searchItems(setTextMatches);
    assert.equal(document.querySelectorAll('[data-search-results] li').length, 0);
    assert.equal(
      query('[data-search-message]', HTMLElement).textContent,
      'No results. Try a different title, name, ID or Jira key.',
    );
  });

  void it('lets only the latest search write its results', async () => {
    visit('/items/?q=PLAT-88');
    const first = searchItems(setTextMatches);
    setUrl('/items/?q=invoice');
    const second = searchItems(setTextMatches);
    await Promise.all([first, second]);
    assert.deepEqual(matches, [new Set(['item-invoice-preview'])]);
  });

  void it('does nothing on a page without the Items section or index', async () => {
    matches = [];
    loadPage('<main><section id="browse"></section></main>', '/items/?q=x');
    const fetched = serve({});
    await searchItems(setTextMatches);
    assert.deepEqual(matches, []);
    assert.equal(fetched.mock.callCount(), 0);
  });
});
