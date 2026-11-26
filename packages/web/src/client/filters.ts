/**
 * Applies the filters in the URL to the page's list, chart or catalogue, keeps counts, empty states
 * and filter-preserving links in step, and loads the chip controls the first time someone reaches
 * for a chip. Plain DOM only: the select component loads on demand.
 */

import { showChoice } from './chip-text.ts';
import { FILTERS_CHANGED } from './events.ts';
import { loadModule } from './stale.ts';

/**
 * Parameters carried across to the timeline and the profile lists by `data-preserve-filters`.
 */
const SHARED = ['type', 'release', 'status', 'set', 'team', 'role'];

/**
 * Record types a timeline link can carry.
 */
const TIMELINE_TYPES = new Set(['item', 'release']);

/**
 * Removes combining marks after canonical decomposition.
 */
const DIACRITICS = /\p{Diacritic}/gu;

/**
 * Splits text into search terms.
 */
const SPACE = /\s+/;

/**
 * IDs the Items search matched, or undefined while no search is active.
 */
let textMatches: ReadonlySet<string> | undefined;

/**
 * Whether the Items search has run on this page.
 */
let searched = false;

/**
 * The chip module, once requested.
 */
let chips: Promise<unknown> | undefined;

/**
 * Original links that keep the page's filters, before any were added.
 */
const preserved = [...document.querySelectorAll<HTMLAnchorElement>('[data-preserve-filters]')].map(
  (link) => ({ link, href: link.getAttribute('href') ?? '' }),
);

/**
 * Lowercases text and removes diacritics, as the search does, so "resume" finds "Résumé". Kept here
 * so the first page load does not pull in the search module.
 *
 * @param value Text.
 * @returns Comparable text.
 */
function normalize(value: string): string {
  return value.normalize('NFKD').replaceAll(DIACRITICS, '').toLowerCase();
}

/**
 * Lets the Items search restrict the rows to the records it matched.
 *
 * @param ids Matched record IDs, or undefined to show every row that passes the chips.
 */
function setTextMatches(ids: ReadonlySet<string> | undefined): void {
  textMatches = ids;
  applyFilters();
}

/**
 * Reads the active chip values from the URL for the chips on this page.
 *
 * @param bar Filter bar.
 * @param params URL parameters.
 * @returns Row data attribute and value pairs.
 */
function activeFilters(bar: Element | null, params: URLSearchParams): Array<[string, string]> {
  return [...(bar?.querySelectorAll<HTMLElement>('[data-filter]') ?? [])].flatMap((chip) => {
    const value = params.get(chip.dataset['filter'] ?? '');
    return value ? [[chip.dataset['field'] ?? '', value] as [string, string]] : [];
  });
}

/**
 * Whether a row passes every chip and the text filter.
 *
 * @param entry Row.
 * @param filters Active chips.
 * @param terms Normalized text terms for a `contains` search.
 * @returns Whether to show the row.
 */
function matches(
  entry: HTMLElement,
  filters: ReadonlyArray<[string, string]>,
  terms: ReadonlyArray<string>,
): boolean {
  const passes = filters.every(([field, value]) =>
    (entry.getAttribute(`data-${field}`) ?? '').split(' ').includes(value),
  );
  const text = normalize(entry.textContent);
  const found = terms.every((term) => text.includes(term));
  const ranked = textMatches?.has(entry.dataset['filterEntry'] ?? '') ?? true;
  return passes && found && ranked;
}

/**
 * Formats a count with its unit.
 *
 * @param count Number shown.
 * @param unit Singular unit; "entry" pluralizes to "entries".
 * @returns Count label.
 */
function countLabel(count: number, unit: string): string {
  if (count === 1) {
    return `1 ${unit}`;
  }

  return `${count} ${unit === 'entry' ? 'entries' : `${unit}s`}`;
}

/**
 * Shows the rows that pass the filters and updates groups, counts and the empty state.
 */
function applyFilters(): void {
  const params = new URLSearchParams(location.search);
  syncLinks(params);
  const scope = document.querySelector('[data-filter-scope]');
  if (!scope) {
    return;
  }

  const bar = scope.querySelector('[data-filter-bar]');
  const text = bar?.querySelector<HTMLInputElement>('[data-filter-text="contains"]');
  const terms = normalize(params.get(text?.name ?? '') ?? '')
    .split(SPACE)
    .filter(Boolean);
  const filters = activeFilters(bar, params);
  const visible = new Set<string>();
  for (const entry of scope.querySelectorAll<HTMLElement>('[data-filter-entry]')) {
    entry.hidden = !matches(entry, filters, terms);
    if (!entry.hidden) {
      visible.add(entry.dataset['filterEntry'] ?? '');
    }
  }

  showCounts(scope, visible.size);

  syncBar(bar, params, filters.length + terms.length);
  document.dispatchEvent(new Event('roadmap:filters'));
}

/**
 * Shows each chip's choice and whether anything can be cleared, before and after the chips upgrade.
 *
 * @param bar Filter bar.
 * @param params URL parameters.
 * @param active Number of active filters.
 */
function syncBar(bar: Element | null, params: URLSearchParams, active: number): void {
  if (!bar) {
    return;
  }

  for (const chip of bar.querySelectorAll<HTMLElement>('[data-filter]')) {
    const value = params.get(chip.dataset['filter'] ?? '');
    chip.toggleAttribute('data-active', Boolean(value));
    if (value) {
      ensureOption(chip, value);
    }

    showPending(chip, value);
  }

  for (const input of bar.querySelectorAll<HTMLInputElement>('[data-filter-text]')) {
    if (document.activeElement !== input) {
      input.value = params.get(input.name) ?? '';
    }
  }

  const clear = bar.querySelector<HTMLElement>('[data-filter-clear]');
  if (clear) {
    clear.hidden =
      active === 0 && !bar.querySelector<HTMLInputElement>('[data-filter-text]')?.value;
  }
}

/**
 * Hides empty groups and updates group counts, the page count and the empty state.
 *
 * @param scope Filtered region.
 * @param visible Number of distinct records shown.
 */
function showCounts(scope: Element, visible: number): void {
  for (const group of scope.querySelectorAll<HTMLElement>('[data-filter-group]')) {
    const shown = group.querySelectorAll('[data-filter-entry]:not([hidden])').length;
    group.hidden = shown === 0;
    const count = group.querySelector('[data-filter-group-count]');
    if (count) {
      count.textContent = countLabel(shown, count.getAttribute('data-unit') ?? 'item');
    }
  }

  for (const counter of document.querySelectorAll<HTMLElement>('[data-filter-count]')) {
    counter.textContent = countLabel(visible, counter.dataset['unit'] ?? 'entry');
  }

  const empty = scope.querySelector<HTMLElement>('[data-filter-empty]');
  if (empty && scope.querySelector('[data-filter-entry]')) {
    empty.hidden = visible > 0;
  }
}

/**
 * Shows a chip's choice in the text visible before the select upgrades.
 *
 * @param chip Chip.
 * @param value Value from the URL.
 */
function showPending(chip: HTMLElement, value: string | null): void {
  const label = chip.querySelector(`ui-select-item[value="${CSS.escape(value ?? '')}"]`);
  showChoice(chip, label?.getAttribute('label') ?? chip.getAttribute('placeholder') ?? '');
}

/**
 * Adds an option for a shared value this list does not offer, so the chip can show and clear it.
 *
 * @param chip Chip.
 * @param value Value from the URL.
 */
function ensureOption(chip: HTMLElement, value: string): void {
  if (chip.querySelector(`ui-select-item[value="${CSS.escape(value)}"]`)) {
    return;
  }

  const item = document.createElement('ui-select-item');
  item.setAttribute('value', value);
  item.setAttribute('label', `${value} (no matching items)`);
  item.textContent = `${value} (no matching items)`;
  (chip.querySelector('ui-select-list') ?? chip.querySelector('ui-select-content'))?.append(item);
}

/**
 * Copies the page's filters onto links to the matching timeline or list.
 *
 * @param params URL parameters.
 */
function syncLinks(params: URLSearchParams): void {
  for (const { link, href } of preserved) {
    const url = new URL(href, location.href);
    const timeline = url.pathname.endsWith('/timeline/');
    for (const name of SHARED) {
      const value = params.get(name);
      const skip = timeline && name === 'type' && !TIMELINE_TYPES.has(value ?? '');
      if (value && !skip && !url.searchParams.has(name)) {
        url.searchParams.set(name, value);
      }
    }

    link.href = url.href;
  }
}

/**
 * Loads the chip controls, then opens the chip that was pressed before they were ready.
 *
 * @param event Pointer, focus or click on the bar.
 */
function upgrade(event: Event): void {
  chips ??= loadModule('filter-chips', async () => import('./filter-chips.ts')).then(
    async (module) => module?.connectChips(),
  );
  if (event.type !== 'click') {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  const chip = target?.closest<HTMLElement & { open?: boolean }>('ui-select');
  if (chip && !customElements.get('ui-select')) {
    void chips.then(() => {
      chip.open = true;
      return chip;
    });
  }
}

/**
 * Writes a text filter to the URL as the reader types.
 *
 * @param input Search field.
 */
function writeText(input: HTMLInputElement): void {
  const url = new URL(location.href);
  if (input.value.trim()) {
    url.searchParams.set(input.name, input.value.trim());
  } else {
    url.searchParams.delete(input.name);
  }

  history.replaceState(null, '', url);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}

/**
 * Removes every filter in a bar from the URL.
 *
 * @param bar Filter bar.
 */
function clearAll(bar: Element): void {
  const url = new URL(location.href);
  for (const control of bar.querySelectorAll<HTMLElement>('[data-filter], [data-filter-text]')) {
    url.searchParams.delete(control.dataset['filter'] ?? control.getAttribute('name') ?? '');
  }

  history.pushState(null, '', url);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}

for (const bar of document.querySelectorAll<HTMLElement>('[data-filter-bar]')) {
  bar.dataset['ready'] = '';
  for (const type of ['pointerover', 'focusin', 'click']) {
    bar.addEventListener(type, upgrade, { capture: true });
  }

  bar.querySelector('[data-filter-clear]')?.addEventListener('click', () => clearAll(bar));
  for (const input of bar.querySelectorAll<HTMLInputElement>('[data-filter-text]')) {
    input.addEventListener('input', () => writeText(input));
  }
}

/**
 * Refilters the page and, on the Items page, reruns the index search when it is needed.
 */
function refresh(): void {
  applyFilters();
  const params = new URLSearchParams(location.search);
  const indexed = document.querySelector('[data-filter-text="index"]');
  // Once a search has run it must also run for an empty field or a cleared type, so it can put
  // the item table back and outdate a search still waiting for the index.
  searched ||= Boolean(params.get('q') || params.get('type'));
  if (indexed && searched) {
    void loadModule('item-search', async () => import('./item-search.ts')).then(async (module) =>
      module?.searchItems(setTextMatches),
    );
  }
}

addEventListener('popstate', refresh);
document.addEventListener(FILTERS_CHANGED, refresh);
refresh();
