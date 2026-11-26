import type { SearchEntry } from './search-rank.ts';

import { statusLabel } from '../ui/status.ts';
import { FILTERS_CHANGED } from './events.ts';
import { FILTER_NAMES, FILTERS_OPEN } from './palette-url.ts';

/**
 * URL parameters the palette narrows by, in display order.
 */
const NAMES = FILTER_NAMES;

/**
 * Name of a palette filter and its URL parameter.
 */
type FilterName = (typeof NAMES)[number];

/**
 * Index field each filter reads.
 */
const FIELDS = new Map<FilterName, 'type' | 'status' | 'release' | 'set' | 'teams'>([
  ['type', 'type'],
  ['status', 'status'],
  ['release', 'release'],
  ['set', 'set'],
  ['team', 'teams'],
]);

/**
 * Visible label and "any" option per filter, in display order.
 */
const LABELS: ReadonlyArray<[FilterName, string, string]> = [
  ['type', 'Type', 'All types'],
  ['status', 'Status', 'All statuses'],
  ['release', 'Release', 'All releases'],
  ['set', 'Feature set', 'All feature sets'],
  ['team', 'Team', 'All teams'],
];

/**
 * Release value for work without a release.
 */
const UNASSIGNED_RELEASE = '~unassigned';

/**
 * Counts the filters set in a query string.
 *
 * @param params Current URL parameters.
 * @returns Number of active filters.
 */
export function activeFilterCount(params: URLSearchParams): number {
  return NAMES.filter(
    (name) => params.get(name) && !(name === 'type' && params.get(name) === 'all'),
  ).length;
}

/**
 * Checks an index record against the filters in a query string.
 *
 * @param entry Indexed record.
 * @param params Current URL parameters.
 * @returns Whether the record passes every active filter.
 */
export function matchesFilters(entry: SearchEntry, params: URLSearchParams): boolean {
  return NAMES.every((name) => {
    const filter = params.get(name);
    if (!filter || (name === 'type' && filter === 'all')) {
      return true;
    }

    const value = entry[FIELDS.get(name) ?? 'type'];
    return typeof value === 'string' ? value === filter : value.includes(filter);
  });
}

/**
 * Lists records of one type as filter options.
 *
 * @param entries Whole index.
 * @param type Record type.
 * @returns ID and title pairs.
 */
function optionsOfType(entries: ReadonlyArray<SearchEntry>, type: string): Array<[string, string]> {
  return entries.flatMap((entry): Array<[string, string]> =>
    entry.type === type ? [[entry.id, entry.title]] : [],
  );
}

/**
 * Sorts options by label.
 *
 * @param options Value and label pairs.
 * @returns A sorted copy.
 */
function byLabel(options: Array<[string, string]>): Array<[string, string]> {
  return options.toSorted((a, b) => a[1].localeCompare(b[1]));
}

/**
 * Collects the options each filter offers from the index.
 *
 * @param entries Whole index.
 * @returns Value and label pairs per filter, sorted by label.
 */
function choices(entries: ReadonlyArray<SearchEntry>): Record<FilterName, Array<[string, string]>> {
  const types = new Map(entries.map((entry): [string, string] => [entry.type, entry.kind]));
  const statuses = new Set(entries.flatMap((entry) => (entry.status ? [entry.status] : [])));

  const releases = optionsOfType(entries, 'release');
  if (entries.some((entry) => entry.release.includes(UNASSIGNED_RELEASE))) {
    releases.push([UNASSIGNED_RELEASE, 'Unassigned']);
  }

  return {
    type: [['all', 'All records'], ...byLabel([...types])],
    status: byLabel([...statuses].map((status): [string, string] => [status, statusLabel(status)])),
    release: byLabel(releases),
    set: byLabel(optionsOfType(entries, 'set')),
    team: byLabel(optionsOfType(entries, 'team')),
  };
}

/**
 * Builds native selects for every filter, preselected from the URL.
 *
 * @param entries Whole index.
 * @param onChange Called after a filter changes the URL.
 * @returns The filter form.
 */
export function filterForm(
  entries: ReadonlyArray<SearchEntry>,
  onChange: () => void,
): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'palette-filter-form';
  const options = choices(entries);
  for (const [name, label, all] of LABELS) {
    const field = document.createElement('label');
    field.className = 'field';
    const text = document.createElement('span');
    text.textContent = label;
    const select = document.createElement('select');
    select.name = name;
    select.append(new Option(all, ''));
    for (const [value, title] of options[name]) {
      select.append(new Option(title, value));
    }

    field.append(text, select);
    form.append(field);
  }

  const reset = document.createElement('button');
  reset.type = 'reset';
  reset.className = 'button-quiet';
  reset.textContent = 'Clear filters';
  form.append(reset);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', () => {
    writeFilters(form, false);
    onChange();
  });
  form.addEventListener('reset', (event) => {
    event.preventDefault();
    writeFilters(form, true);
    onChange();
  });
  syncFilterForm(form);
  return form;
}

/**
 * Sets each select to the value in the URL, or "any" when the URL names an unknown value.
 *
 * @param form Filter form.
 */
export function syncFilterForm(form: HTMLFormElement): void {
  const params = new URLSearchParams(location.search);
  for (const select of form.querySelectorAll('select')) {
    const value = params.get(select.name) ?? '';
    select.value = [...select.options].some((option) => option.value === value) ? value : '';
  }
}

/**
 * Writes the form's filters to the URL so the search can be shared.
 *
 * @param form Filter form.
 * @param clear Whether to remove every filter.
 */
function writeFilters(form: HTMLFormElement, clear: boolean): void {
  const url = new URL(location.href);
  const data = new FormData(form);
  for (const name of NAMES) {
    const value = clear ? '' : data.get(name);
    if (typeof value === 'string' && value) {
      url.searchParams.set(name, value);
    } else {
      url.searchParams.delete(name);
    }
  }

  url.searchParams.set('search', FILTERS_OPEN);
  history.replaceState(null, '', url);
  syncFilterForm(form);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}
