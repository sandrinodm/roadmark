import type { UiCommandElement, UiDialogElement } from '@ui-sdk/web';

import type { PreparedEntry, SearchEntry } from './search-rank.ts';

// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-command>.
import '@ui-sdk/web/command';
// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-dialog>.
import '@ui-sdk/web/dialog';

import { iconMarkup } from '../ui/icons.ts';
import {
  activeFilterCount,
  filterForm,
  matchesFilters,
  syncFilterForm,
} from './palette-filters.ts';
import { closePaletteUrl, snapshotFilters, writeOpen, writeQuery } from './palette-url.ts';
import { resultGroups } from './palette-view.ts';
import { prepareEntry, rank } from './search-rank.ts';

/**
 * Most results listed at once.
 */
const MAX_RESULTS = 30;

/**
 * Message shown before anything is typed.
 */
const HINT = 'Search items, releases, people, teams and Jira keys.';

/**
 * Static palette markup. Author content is added later as text nodes only.
 */
const TEMPLATE = `<ui-dialog-backdrop class="palette-backdrop" hidden></ui-dialog-backdrop>
<ui-dialog-content class="palette" hidden>
  <ui-dialog-title class="visually-hidden">Search the roadmap</ui-dialog-title>
  <ui-command filter="false">
    <div class="palette-field">
      ${iconMarkup('search')}
      <ui-command-input><input aria-label="Search the roadmap" placeholder="Search titles, people, teams or Jira keys" autocomplete="off" spellcheck="false" autofocus></ui-command-input>
      <ui-dialog-close><button type="button" class="palette-close"><span aria-hidden="true">Esc</span><span class="visually-hidden">Close search</span></button></ui-dialog-close>
    </div>
    <details class="palette-filters"><summary>Filters<span class="palette-filter-count"></span></summary><p class="palette-message" data-filter-message>Loading filters…</p></details>
    <p class="palette-message" data-message role="status">${HINT}</p>
    <ui-command-list class="palette-list"></ui-command-list>
  </ui-command>
</ui-dialog-content>`;

/**
 * Elements of the mounted palette.
 */
type Palette = {
  /**
   * Dialog root.
   */
  dialog: UiDialogElement;

  /**
   * Command root.
   */
  command: UiCommandElement;

  /**
   * Result list.
   */
  list: HTMLElement;

  /**
   * Live result count or hint.
   */
  message: HTMLElement;

  /**
   * Filters disclosure.
   */
  filters: HTMLDetailsElement;

  /**
   * Active filter count in the disclosure summary.
   */
  count: HTMLElement;
};

/**
 * The mounted palette, created on first open.
 */
let palette: Palette | undefined;

/**
 * The prepared search index, fetched on first open.
 */
let index: Promise<Array<PreparedEntry>> | undefined;

/**
 * Filter parameters when the palette last opened, or undefined while it is closed.
 */
let filtersBefore: Map<string, string> | undefined;

/**
 * Counts searches so a slow index load never overwrites newer results.
 */
let version = 0;

/**
 * Fetches and prepares the search index once.
 *
 * @param url Index URL.
 * @returns Prepared records.
 */
function loadIndex(url: string): Promise<Array<PreparedEntry>> {
  index ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Search index unavailable');
      }

      const entries: unknown = await response.json();
      if (!isSearchIndex(entries)) {
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
 * Checks the downloaded index enough to render it: an array of records with links and titles.
 *
 * @param value Parsed JSON.
 * @returns Whether the value looks like the search index.
 */
function isSearchIndex(value: unknown): value is Array<SearchEntry> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'href' in entry &&
        typeof entry.href === 'string' &&
        'title' in entry &&
        typeof entry.title === 'string',
    )
  );
}

/**
 * Asserts that a palette part exists.
 *
 * @param node Queried element.
 * @param name Part name for the error message.
 * @returns The element.
 */
function required<T extends Element>(node: T | null, name: string): T {
  if (!node) {
    throw new Error(`Search palette is missing ${name}`);
  }

  return node;
}

/**
 * Creates the palette and connects its events.
 *
 * @param url Index URL.
 * @returns The mounted palette.
 */
function mount(url: string): Palette {
  const dialog = document.createElement('ui-dialog');
  dialog.innerHTML = TEMPLATE;
  document.body.append(dialog);
  const command = required(dialog.querySelector('ui-command'), 'ui-command');
  const filters = required(dialog.querySelector('details'), 'filters');
  const mounted: Palette = {
    dialog,
    command,
    filters,
    list: required(dialog.querySelector('ui-command-list'), 'ui-command-list'),
    message: required(dialog.querySelector<HTMLElement>('[data-message]'), 'message'),
    count: required(filters.querySelector('span'), 'filter count'),
  };
  command.addEventListener('querychange', (event) => {
    if (filtersBefore) {
      writeQuery(event.detail.value);
    }

    void search(mounted, url, event.detail.value);
  });
  filters.addEventListener('toggle', () => {
    if (filtersBefore) {
      writeOpen(filters.open);
    }

    void showFilters(mounted, url);
  });
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && dialog.open) {
        event.preventDefault();
        event.stopPropagation();
        // Setting `open` does not emit `openchange`, so forget the search here as well.
        dialog.open = false;
        forget(mounted);
      }
    },
    { capture: true },
  );
  dialog.addEventListener('openchange', (event) => {
    if (!event.detail.value) {
      forget(mounted);
    }
  });
  return mounted;
}

/**
 * Forgets the search when the palette closes and removes its state from the URL (see
 * palette-url.ts). Runs once per open, whether Escape or the dialog closed it.
 *
 * @param mounted Palette elements.
 */
function forget(mounted: Palette): void {
  const before = filtersBefore;
  if (!before) {
    return;
  }

  filtersBefore = undefined;
  version += 1;
  if (mounted.command.query) {
    mounted.command.api.setQuery('');
  }

  mounted.list.replaceChildren();
  mounted.message.textContent = HINT;
  closePaletteUrl(before);
}

/**
 * Loads the filter controls when the disclosure first opens.
 *
 * @param mounted Palette elements.
 * @param url Index URL.
 */
async function showFilters(mounted: Palette, url: string): Promise<void> {
  const { filters } = mounted;
  const existing = filters.querySelector('form');
  if (existing) {
    syncFilterForm(existing);
    return;
  }

  if (!filters.open) {
    return;
  }

  const message = required(filters.querySelector<HTMLElement>('[data-filter-message]'), 'message');
  try {
    const entries = (await loadIndex(url)).map(({ entry }) => entry);
    message.replaceWith(
      filterForm(entries, () => void search(mounted, url, mounted.command.query)),
    );
  } catch {
    message.textContent = 'Filters are unavailable. Reopen them to retry.';
  }
}

/**
 * Ranks the index for the current text and filters and shows the results.
 *
 * @param mounted Palette elements.
 * @param url Index URL.
 * @param query Search text.
 */
async function search(mounted: Palette, url: string, query: string): Promise<void> {
  const current = (version += 1);
  const params = new URLSearchParams(location.search);
  const filtered = activeFilterCount(params);
  mounted.count.textContent = filtered > 0 ? ` (${filtered} active)` : '';
  if (!query.trim() && filtered === 0) {
    mounted.list.replaceChildren();
    mounted.message.textContent = HINT;
    return;
  }

  try {
    const prepared = await loadIndex(url);
    if (current !== version) {
      return;
    }

    const results = rank(
      prepared.filter(({ entry }) => matchesFilters(entry, params)),
      query,
    );
    const shown = results.slice(0, MAX_RESULTS);
    mounted.list.replaceChildren(...resultGroups(shown));
    mounted.message.textContent = summary(results.length, shown.length, query);
  } catch {
    if (current === version) {
      mounted.message.textContent = 'Search is unavailable. Close and reopen search to retry.';
    }
  }
}

/**
 * Describes how many results are listed.
 *
 * @param total Matching records.
 * @param shown Records listed.
 * @param query Search text.
 * @returns Visible and announced summary.
 */
function summary(total: number, shown: number, query: string): string {
  if (total === 0) {
    return query.trim()
      ? 'No results. Try a different title, name, ID or Jira key.'
      : 'No results. Clear a filter and try again.';
  }

  const label = total === 1 ? '1 result' : `${total} results`;
  return total > shown ? `${label}, showing ${shown}` : label;
}

/**
 * Opens the palette, optionally with search text and the filters disclosure open.
 *
 * @param url Index URL.
 * @param query Initial search text.
 * @param showFilterPanel Whether to open the filters disclosure.
 */
export async function openPalette(
  url: string,
  query: string,
  showFilterPanel: boolean,
): Promise<void> {
  palette ??= mount(url);
  await Promise.all([
    customElements.whenDefined('ui-dialog'),
    customElements.whenDefined('ui-command'),
  ]);
  const mounted = palette;
  if (!filtersBefore) {
    filtersBefore = snapshotFilters();
    writeOpen(showFilterPanel || mounted.filters.open);
  }

  mounted.dialog.open = true;
  if (showFilterPanel) {
    mounted.filters.open = true;
  }

  // An already open disclosure fires no toggle, so bring its selects back in line with the URL.
  const form = mounted.filters.querySelector('form');
  if (form) {
    syncFilterForm(form);
  }

  if (query && mounted.command.query !== query) {
    mounted.command.api.setQuery(query);
  } else {
    await search(mounted, url, mounted.command.query);
  }
}
