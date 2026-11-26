import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SearchEntry } from './search-rank.ts';

import { installDom, params, query, setUrl } from './test-dom.ts';

installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { activeFilterCount, filterForm, matchesFilters, syncFilterForm } =
  await import('./palette-filters.ts');

/**
 * The event every list on the page listens to.
 */
const { FILTERS_CHANGED } = await import('./events.ts');

/**
 * Builds an index record with defaults for the fields a test does not care about.
 *
 * @param fields Fields that matter to the test.
 * @returns Index record.
 */
function entry(fields: Partial<SearchEntry> & Pick<SearchEntry, 'id' | 'title'>): SearchEntry {
  return {
    kind: 'Item',
    type: 'item',
    status: '',
    release: [],
    set: [],
    teams: [],
    href: `/items/${fields.id}/`,
    description: '',
    jira: [],
    text: '',
    ...fields,
  };
}

/**
 * A small index with every record type the filters offer.
 */
const INDEX: ReadonlyArray<SearchEntry> = [
  entry({
    id: 'guided',
    title: 'Guided setup',
    status: 'in-progress',
    release: ['spring'],
    set: ['onboarding'],
    teams: ['growth'],
  }),
  entry({
    id: 'loose',
    title: 'Loose end',
    status: 'planned',
    release: ['~unassigned'],
    teams: ['platform'],
  }),
  entry({ id: 'spring', title: 'Spring launch', type: 'release', kind: 'Release' }),
  entry({ id: 'autumn', title: 'Autumn launch', type: 'release', kind: 'Release' }),
  entry({ id: 'onboarding', title: 'Onboarding', type: 'set', kind: 'Feature set' }),
  entry({ id: 'growth', title: 'Growth', type: 'team', kind: 'Team' }),
  entry({ id: 'platform', title: 'Platform', type: 'team', kind: 'Team' }),
];

/**
 * Lists a select's options as value and label pairs.
 *
 * @param form Filter form.
 * @param name Select name.
 * @returns Option pairs.
 */
function options(form: HTMLFormElement, name: string): Array<[string, string]> {
  return [...query(`select[name="${name}"]`, HTMLSelectElement, form).options].map((option) => [
    option.value,
    option.text,
  ]);
}

/**
 * Reads each select's current value.
 *
 * @param form Filter form.
 * @returns Values by select name.
 */
function values(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...form.querySelectorAll('select')].map((select) => [select.name, select.value]),
  );
}

void describe('palette filters', () => {
  void it('counts the filters set, ignoring type=all and empty values', () => {
    assert.equal(activeFilterCount(new URLSearchParams('')), 0);
    assert.equal(activeFilterCount(new URLSearchParams('type=all&status=&q=x&pq=y')), 0);
    assert.equal(activeFilterCount(new URLSearchParams('type=item&status=done&team=a&set=b')), 4);
  });

  void it('matches string fields exactly and list fields by membership', () => {
    const [guided, loose] = INDEX;
    assert.ok(guided && loose);
    assert.equal(matchesFilters(guided, new URLSearchParams('')), true);
    assert.equal(matchesFilters(guided, new URLSearchParams('type=all&status=in-progress')), true);
    assert.equal(matchesFilters(guided, new URLSearchParams('status=in')), false);
    assert.equal(matchesFilters(guided, new URLSearchParams('team=growth&set=onboarding')), true);
    assert.equal(matchesFilters(guided, new URLSearchParams('team=platform')), false);
    assert.equal(matchesFilters(loose, new URLSearchParams('release=~unassigned')), true);
    assert.equal(matchesFilters(loose, new URLSearchParams('type=release')), false);
  });

  void it('offers every type, status, release, set and team in the index, sorted by label', () => {
    const form = filterForm(INDEX, () => undefined);
    assert.deepEqual(options(form, 'type'), [
      ['', 'All types'],
      ['all', 'All records'],
      ['set', 'Feature set'],
      ['item', 'Item'],
      ['release', 'Release'],
      ['team', 'Team'],
    ]);
    assert.deepEqual(options(form, 'status'), [
      ['', 'All statuses'],
      ['in-progress', 'In progress'],
      ['planned', 'Planned'],
    ]);
    assert.deepEqual(options(form, 'release'), [
      ['', 'All releases'],
      ['autumn', 'Autumn launch'],
      ['spring', 'Spring launch'],
      ['~unassigned', 'Unassigned'],
    ]);
    assert.deepEqual(options(form, 'set'), [
      ['', 'All feature sets'],
      ['onboarding', 'Onboarding'],
    ]);
    assert.deepEqual(options(form, 'team'), [
      ['', 'All teams'],
      ['growth', 'Growth'],
      ['platform', 'Platform'],
    ]);
    assert.equal(
      query('button[type="reset"]', HTMLButtonElement, form).textContent,
      'Clear filters',
    );
  });

  void it('preselects the URL’s filters and falls back to any for unknown values', () => {
    setUrl('/?type=release&team=nobody&set=onboarding');
    const form = filterForm(INDEX, () => undefined);
    assert.deepEqual(values(form), {
      type: 'release',
      status: '',
      release: '',
      set: 'onboarding',
      team: '',
    });
  });

  void it('writes a change to the URL with the filters open, keeping the page search', () => {
    setUrl('/items/?q=setup&pq=guided&search=palette&status=planned');
    let changes = 0;
    let events = 0;
    document.addEventListener(FILTERS_CHANGED, () => {
      events += 1;
    });
    const form = filterForm(INDEX, () => {
      changes += 1;
    });
    document.body.append(form);
    query('select[name="team"]', HTMLSelectElement, form).value = 'growth';
    query('select[name="status"]', HTMLSelectElement, form).value = '';
    form.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(location.search, '?q=setup&pq=guided&search=filters&team=growth');
    assert.equal(changes, 1);
    assert.equal(events, 1);
  });

  void it('clears every filter on reset and keeps the selects in step', () => {
    setUrl('/?type=item&release=spring&set=onboarding&pq=x');
    let changes = 0;
    const form = filterForm(INDEX, () => {
      changes += 1;
    });
    const reset = new Event('reset', { cancelable: true });
    form.dispatchEvent(reset);
    assert.equal(reset.defaultPrevented, true);
    assert.equal(location.search, '?pq=x&search=filters');
    assert.deepEqual(new Set(Object.values(values(form))), new Set(['']));
    assert.equal(changes, 1);
  });

  void it('never submits, and syncs the selects when the URL changes elsewhere', () => {
    const form = filterForm(INDEX, () => undefined);
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, true);
    setUrl('/?status=planned&type=all');
    syncFilterForm(form);
    assert.equal(values(form)['status'], 'planned');
    assert.equal(values(form)['type'], 'all');
    assert.equal(params().get('status'), 'planned', 'syncing never writes the URL');
  });
});
