import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installDom, loadPage, params, setUrl } from './test-dom.ts';

installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const {
  FILTER_NAMES,
  adoptLegacyQuery,
  closePaletteUrl,
  readPaletteState,
  snapshotFilters,
  writeOpen,
  writeQuery,
} = await import('./palette-url.ts');

/**
 * The event every list on the page listens to, from the module that owns the name.
 */
const { FILTERS_CHANGED } = await import('./events.ts');

/**
 * Counts `FILTERS_CHANGED` events while a function runs.
 *
 * @param run Code that may dispatch the event.
 * @returns Number of events.
 */
function countChanges(run: () => void): number {
  let count = 0;
  /**
   * Counts one event.
   */
  const listener = (): void => {
    count += 1;
  };
  document.addEventListener(FILTERS_CHANGED, listener);
  try {
    run();
  } finally {
    document.removeEventListener(FILTERS_CHANGED, listener);
  }

  return count;
}

void describe('palette URL contract', () => {
  void it('lists the filters in display order', () => {
    assert.deepEqual(FILTER_NAMES, ['type', 'status', 'release', 'set', 'team']);
  });

  void it('reads open, filters and query from search and pq only', () => {
    assert.deepEqual(readPaletteState(new URLSearchParams('')), {
      open: false,
      filters: false,
      query: '',
    });
    assert.deepEqual(readPaletteState(new URLSearchParams('search=palette&pq=billing')), {
      open: true,
      filters: false,
      query: 'billing',
    });
    assert.deepEqual(readPaletteState(new URLSearchParams('search=filters')), {
      open: true,
      filters: true,
      query: '',
    });
    assert.deepEqual(readPaletteState(new URLSearchParams('search=1&q=billing')), {
      open: false,
      filters: false,
      query: '',
    });
  });

  void it('records the palette as open without touching the page search', () => {
    setUrl('/items/?q=setup&collection-q=growth&type=item#browse');
    writeOpen(false);
    assert.equal(location.search, '?q=setup&collection-q=growth&type=item&search=palette');
    assert.equal(location.hash, '#browse');
    writeOpen(true);
    assert.equal(params().get('search'), 'filters');
    assert.equal(params().get('q'), 'setup');
    assert.equal(history.length, 1, 'the URL is replaced, not pushed');
  });

  void it('writes a trimmed query to pq and removes it when blank', () => {
    setUrl('/sets/?q=page&collection-q=sets');
    writeQuery('  guided setup ');
    assert.equal(params().get('pq'), 'guided setup');
    writeQuery('   ');
    assert.equal(params().has('pq'), false);
    assert.equal(params().get('q'), 'page');
    assert.equal(params().get('collection-q'), 'sets');
  });

  void it('snapshots only the filter parameters that are set', () => {
    setUrl('/?type=item&team=platform&q=ignored&pq=ignored&role=owner');
    assert.deepEqual(
      [...snapshotFilters()],
      [
        ['type', 'item'],
        ['team', 'platform'],
      ],
    );
  });

  void it('on close, removes its state and restores filters the page has no chip for', () => {
    loadPage(
      '<div data-filter-bar><ui-select data-filter="status"></ui-select></div>',
      '/sets/?search=filters&pq=setup&q=sets&collection-q=x&type=release&status=done&team=growth',
    );
    const changes = countChanges(() => {
      closePaletteUrl(
        new Map([
          ['type', 'item'],
          ['status', 'planned'],
          ['set', 'set-billing'],
        ]),
      );
    });
    assert.equal(changes, 1);
    const after = params();
    assert.equal(after.has('search'), false);
    assert.equal(after.has('pq'), false);
    assert.equal(after.get('q'), 'sets', 'the page search stays');
    assert.equal(after.get('collection-q'), 'x');
    assert.equal(after.get('type'), 'item', 'restored to its value when the palette opened');
    assert.equal(after.get('status'), 'done', 'the page has a chip for status, so it is kept');
    assert.equal(after.get('set'), 'set-billing', 'restored although the palette cleared it');
    assert.equal(after.has('team'), false, 'added in the palette and removed again');
  });

  void it('moves an older palette link’s q to pq and opens the palette', () => {
    setUrl('/sets/?q=billing&team=growth');
    assert.deepEqual(adoptLegacyQuery(), { open: true, filters: false, query: 'billing' });
    assert.equal(location.search, '?team=growth&pq=billing&search=palette');
  });

  void it('turns search=1 into the open filters, with or without a query', () => {
    setUrl('/people/?search=1');
    assert.deepEqual(adoptLegacyQuery(), { open: true, filters: true, query: '' });
    assert.equal(location.search, '?search=filters');
    setUrl('/people/?search=1&q=maya');
    assert.deepEqual(adoptLegacyQuery(), { open: true, filters: true, query: 'maya' });
    assert.equal(params().has('q'), false);
  });

  void it('leaves a URL alone that already has palette state or no legacy query', () => {
    setUrl('/sets/?search=palette&pq=new&q=old');
    assert.deepEqual(adoptLegacyQuery(), { open: true, filters: false, query: 'new' });
    assert.equal(location.search, '?search=palette&pq=new&q=old');
    setUrl('/sets/?q=');
    assert.deepEqual(adoptLegacyQuery(), { open: false, filters: false, query: '' });
    assert.equal(location.search, '?q=');
  });
});
