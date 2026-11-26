import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atlasFile,
  installDom,
  loadPage,
  params,
  query,
  runModule,
  settle,
  setUrl,
} from './test-dom.ts';

/**
 * Rendered pages with filter bars: chips on the timeline and a release, text on the home page.
 */
const [timeline, home, release] = await Promise.all([
  atlasFile('timeline/index.html'),
  atlasFile('index.html'),
  atlasFile('releases/rel-spring/index.html'),
]);
installDom();

/**
 * The event every list on the page listens to.
 */
const { FILTERS_CHANGED } = await import('./events.ts');

/**
 * Shows a page and runs the filters module on it, as the page load does.
 *
 * @param html Page.
 * @param path Path and query.
 */
async function open(html: string, path: string): Promise<void> {
  loadPage(html, path);
  await runModule('filters.ts');
}

/**
 * Lists the distinct records shown in the filtered region.
 *
 * @returns Record IDs, sorted.
 */
function shown(): Array<string> {
  const ids = [...document.querySelectorAll<HTMLElement>('[data-filter-entry]:not([hidden])')].map(
    (entry) => entry.dataset['filterEntry'] ?? '',
  );
  return [...new Set(ids)].toSorted();
}

/**
 * Text of the page's record count.
 *
 * @returns Count label.
 */
function count(): string {
  return query('[data-filter-count]', HTMLElement).textContent;
}

/**
 * Moves to a URL and tells the page its filters changed, as a control does.
 *
 * @param path Path and query.
 */
function change(path: string): void {
  setUrl(path);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}

void describe('filters', () => {
  // First: once a test presses the bar, the select element stays defined for the whole file.
  void it('loads the chip controls when the bar is first reached, opening a pressed chip', async () => {
    await open(timeline, '/timeline/?status=planned');
    assert.equal(customElements.get('ui-select'), undefined);
    const chip = query('ui-select[data-filter="team"]', HTMLElement);
    query('ui-select-trigger button', HTMLElement, chip).click();
    for (let attempt = 0; attempt < 50 && !chip.hasAttribute('data-open'); attempt += 1) {
      await settle();
    }

    assert.notEqual(customElements.get('ui-select'), undefined);
    assert.equal(chip.hasAttribute('data-open'), true, 'the press before the upgrade opens it');
  });

  void it('shows the rows that pass every chip in the URL and counts distinct records', async () => {
    await open(timeline, '/timeline/?status=planned&set=set-billing');
    assert.deepEqual(shown(), ['item-invoice-preview', 'rel-summer']);
    assert.equal(count(), '2 entries');
    const lanes = [...document.querySelectorAll<HTMLElement>('details[data-lane]')];
    assert.deepEqual(
      lanes.flatMap((lane) => (lane.hidden ? [] : [lane.dataset['lane']])),
      ['rel-summer'],
    );
    assert.equal(query('[data-filter-empty]', HTMLElement).hidden, true);
  });

  void it('marks active chips, shows their choice and offers to clear them', async () => {
    await open(timeline, '/timeline/?status=planned');
    const bar = query('[data-filter-bar]', HTMLElement);
    assert.equal(bar.dataset['ready'], '');
    const status = query('ui-select[data-filter="status"]', HTMLElement);
    assert.equal(status.hasAttribute('data-active'), true);
    assert.equal(query('.chip-pending', HTMLElement, status).textContent, 'Planned');
    const team = query('ui-select[data-filter="team"]', HTMLElement);
    assert.equal(team.hasAttribute('data-active'), false);
    assert.equal(query('.chip-pending', HTMLElement, team).textContent, 'Any');
    assert.equal(query('[data-filter-clear]', HTMLElement).hidden, false);

    change('/timeline/');
    assert.equal(status.hasAttribute('data-active'), false);
    assert.equal(query('.chip-pending', HTMLElement, status).textContent, 'Any');
    assert.equal(query('[data-filter-clear]', HTMLElement).hidden, true);
    assert.equal(count(), '8 entries');
  });

  void it('refilters on a filter change and on history navigation', async () => {
    await open(timeline, '/timeline/');
    change('/timeline/?team=billing');
    assert.deepEqual(shown(), ['item-invoice-preview', 'rel-summer']);
    setUrl('/timeline/?type=release');
    dispatchEvent(new PopStateEvent('popstate'));
    assert.deepEqual(shown(), ['rel-foundation', 'rel-spring', 'rel-summer']);
    assert.equal(count(), '3 entries');
  });

  void it('adds an option for a shared value this list lacks and shows the empty state', async () => {
    await open(timeline, '/timeline/?team=nobody');
    assert.deepEqual(shown(), []);
    assert.equal(count(), '0 entries');
    assert.equal(query('[data-filter-empty]', HTMLElement).hidden, false);
    const option = query(
      'ui-select[data-filter="team"] ui-select-item[value="nobody"]',
      HTMLElement,
    );
    assert.equal(option.getAttribute('label'), 'nobody (no matching items)');
    assert.equal(
      query('ui-select[data-filter="team"] .chip-pending', HTMLElement).textContent,
      'nobody (no matching items)',
    );
    change('/timeline/?team=nobody');
    assert.equal(document.querySelectorAll('ui-select-item[value="nobody"]').length, 1);
  });

  void it('clears every filter in the bar with one history entry, keeping other parameters', async () => {
    await open(timeline, '/timeline/?status=planned&team=growth&zoom=quarter');
    const before = history.length;
    query('[data-filter-clear]', HTMLElement).click();
    assert.equal(location.search, '?zoom=quarter');
    assert.equal(history.length, before + 1);
    assert.equal(count(), '8 entries');
  });

  void it('carries the filters onto links that preserve them', async () => {
    await open(timeline, '/timeline/?status=planned&team=growth&zoom=quarter');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-preserve-filters]')];
    assert.notEqual(links.length, 0);
    for (const link of links) {
      assert.equal(link.href, 'https://roadmap.test/items/?status=planned&team=growth');
    }

    change('/timeline/');
    assert.equal(links[0]?.href, 'https://roadmap.test/items/');
  });

  void it('carries only record types the timeline shows onto timeline links', async () => {
    await open(release, '/releases/rel-spring/?type=set&status=planned&selected=other');
    const link = query('[data-preserve-filters]', HTMLAnchorElement);
    assert.equal(
      link.href,
      'https://roadmap.test/timeline/?selected=rel-spring&status=planned',
      'type=set is dropped and the link’s own selection is kept',
    );
    change('/releases/rel-spring/?type=item&role=owner');
    assert.equal(
      link.href,
      'https://roadmap.test/timeline/?selected=rel-spring&type=item&role=owner',
    );
  });

  void it('narrows by the text field, ignoring case and accents, and counts each group', async () => {
    await open(home, '/?collection-q=SPRÍNG');
    assert.deepEqual(shown(), ['rel-spring']);
    assert.equal(count(), '1 release');
    const groups = [...document.querySelectorAll<HTMLElement>('[data-filter-group]')];
    const visible = groups.filter((group) => !group.hidden);
    assert.notEqual(visible.length, 0);
    assert.ok(visible.length < groups.length, 'groups without a match are hidden');
    const input = query('input[data-filter-text="contains"]', HTMLInputElement);
    assert.equal(input.value, 'SPRÍNG');
    assert.equal(query('[data-filter-clear]', HTMLElement).hidden, false);
  });

  void it('writes typed text to the URL without adding history entries', async () => {
    await open(home, '/');
    const before = history.length;
    const input = query('input[data-filter-text="contains"]', HTMLInputElement);
    input.value = '  summer ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(params().get('collection-q'), 'summer');
    assert.equal(history.length, before);
    assert.deepEqual(shown(), ['rel-summer']);
    input.value = ' ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(params().has('collection-q'), false);
    assert.equal(shown().length, 3);
  });
});
