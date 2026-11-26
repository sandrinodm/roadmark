import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atlasFile,
  installDom,
  isA,
  loadPage,
  params,
  query,
  serve,
  settle,
  setUrl,
} from './test-dom.ts';

/**
 * The rendered Feature sets page (no filter chips) and the search index.
 */
const [page, index] = await Promise.all([
  atlasFile('sets/index.html'),
  atlasFile('search-index.json'),
]);

// The palette mounts once and keeps its dialog, as on a page that never reloads.
installDom({ keepPage: true });
loadPage(page, '/sets/');

/**
 * The module under test, loaded once the DOM globals exist. Importing it registers the dialog and
 * command components.
 */
const { openPalette } = await import('./palette.ts');

/**
 * Index URL the page names.
 */
const INDEX_URL = '/search-index.json';

/**
 * Hint shown before anything is typed.
 */
const HINT = 'Search items, releases, people, teams and Jira keys.';

/**
 * Opens the palette and lets the search run.
 *
 * @param text Initial query.
 * @param filters Whether to open the filters disclosure.
 */
async function open(text = '', filters = false): Promise<void> {
  await openPalette(INDEX_URL, text, filters);
  await settle();
}

/**
 * The live message under the field.
 *
 * @returns Message text.
 */
function message(): string {
  return query('ui-dialog [data-message]', HTMLElement).textContent;
}

/**
 * The listed results, by group.
 *
 * @returns Group heading and result labels.
 */
function results(): Array<[string, Array<string>]> {
  return [...document.querySelectorAll('ui-dialog ui-command-group')].map((group) => [
    group.querySelector('ui-command-group-label')?.textContent ?? '',
    [...group.querySelectorAll('ui-command-item')].map((item) => item.getAttribute('label') ?? ''),
  ]);
}

/**
 * Types into the search field as the reader does.
 *
 * @param text New field value.
 */
async function type(text: string): Promise<void> {
  const input = query('ui-dialog ui-command-input input', HTMLInputElement);
  input.value = text;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await settle();
}

/**
 * Presses Escape inside the palette.
 */
async function escape(): Promise<void> {
  query('ui-dialog ui-command-input input', HTMLInputElement).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await settle();
}

/**
 * Whether the palette dialog is open.
 *
 * @returns Its `open` state.
 */
function isOpen(): boolean {
  return document.querySelector('ui-dialog')?.open === true;
}

void describe('openPalette', () => {
  void it('says search is unavailable when the index cannot load', async () => {
    setUrl('/sets/?collection-q=billing');
    serve({});
    await open('setup');
    assert.equal(isOpen(), true);
    assert.equal(message(), 'Search is unavailable. Close and reopen search to retry.');
    assert.equal(location.search, '?collection-q=billing&search=palette&pq=setup');
    await escape();
  });

  void it('opens with a query, ranks the index and records the state in the URL', async () => {
    setUrl('/sets/?collection-q=billing');
    serve({ [INDEX_URL]: index });
    await open('PLAT-88');
    assert.equal(isOpen(), true);
    assert.deepEqual(results(), [
      ['Best matches', ['Guided workspace setup', 'Setup completion events']],
    ]);
    assert.equal(message(), '2 results');
    assert.equal(params().get('search'), 'palette');
    assert.equal(params().get('pq'), 'PLAT-88');
    assert.equal(params().get('collection-q'), 'billing', 'the page’s own search is left alone');
  });

  void it('searches as the reader types and says when nothing matches', async () => {
    await type('maya');
    assert.deepEqual(results()[0], ['Best matches', ['Maya Chen']]);
    assert.equal(params().get('pq'), 'maya');
    await type('zzzz');
    assert.deepEqual(results(), []);
    assert.equal(message(), 'No results. Try a different title, name, ID or Jira key.');
    await type('');
    assert.equal(message(), HINT);
    assert.equal(params().has('pq'), false);
  });

  void it('closes on Escape, forgetting the search and its URL state', async () => {
    await type('setup');
    assert.notDeepEqual(results(), []);
    await escape();
    assert.equal(isOpen(), false);
    assert.equal(location.search, '?collection-q=billing');
    assert.deepEqual(results(), []);
    assert.equal(message(), HINT);
    assert.equal(query('ui-dialog ui-command-input input', HTMLInputElement).value, '');
  });

  void it('opens the filters, narrows by them and counts them', async () => {
    setUrl('/sets/?type=release');
    await open('', true);
    assert.equal(params().get('search'), 'filters');
    const details = query('ui-dialog details.palette-filters', HTMLDetailsElement);
    assert.equal(details.open, true);
    for (let attempt = 0; attempt < 20 && !details.querySelector('form'); attempt += 1) {
      await settle();
    }

    const form = query('form', HTMLFormElement, details);
    const typeSelect = query('select[name="type"]', HTMLSelectElement, form);
    assert.equal(typeSelect.value, 'release', 'preselected from the URL');
    assert.deepEqual(results(), [
      ['Releases', ['Event foundation', 'Spring onboarding launch', 'Summer billing release']],
    ]);
    assert.equal(query('.palette-filter-count', HTMLElement, details).textContent, ' (1 active)');

    query('select[name="status"]', HTMLSelectElement, form).value = 'planned';
    form.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    assert.equal(params().get('status'), 'planned');
    assert.deepEqual(results(), [['Releases', ['Summer billing release']]]);
    assert.equal(message(), '1 result');
    assert.equal(query('.palette-filter-count', HTMLElement, details).textContent, ' (2 active)');

    query('select[name="team"]', HTMLSelectElement, form).value = 'growth';
    form.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    assert.equal(message(), 'No results. Clear a filter and try again.');
  });

  void it('puts back the filters it changed when it closes', async () => {
    await escape();
    assert.equal(location.search, '?type=release', 'filters the page has no chip for come back');
  });

  void it('records collapsing the filters and reopens without snapshotting twice', async () => {
    setUrl('/sets/');
    await open('', true);
    const details = query('ui-dialog details.palette-filters', HTMLDetailsElement);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    assert.equal(params().get('search'), 'palette');
    setUrl('/sets/?search=palette&team=growth');
    await open('');
    assert.equal(isOpen(), true);
    await escape();
    assert.equal(location.search, '', 'the filters from the first open are restored');
  });

  void it('keeps its markup free of author content until results arrive', () => {
    const dialog = query('ui-dialog', HTMLElement);
    assert.ok(isA(dialog.querySelector('ui-command'), HTMLElement));
    assert.equal(query('ui-dialog-title', HTMLElement, dialog).textContent, 'Search the roadmap');
  });
});
