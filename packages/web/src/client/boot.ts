/**
 * Loaded on every page. Keeps first-load JavaScript tiny: the search palette and its UI SDK
 * components load with `import()` the first time someone presses `/`, ⌘K or the Search button.
 */

import type { openPalette } from './palette.ts';

// oxlint-disable-next-line import/no-unassigned-import -- applies the URL's filters to the page.
import './filters.ts';
import { forwardLegacyItemsLinks } from './legacy-home.ts';
import { connectMenu } from './menu.ts';
import { adoptLegacyQuery, readPaletteState } from './palette-url.ts';
import { loadModule } from './stale.ts';

/**
 * Header button that opens search; hidden in the markup until this script runs.
 */
const trigger = document.querySelector<HTMLButtonElement>('[data-search-open]');

/**
 * The palette module, once requested.
 */
let palette: Promise<{ openPalette: typeof openPalette } | undefined> | undefined;

/**
 * Text typed while the palette module was still loading, replayed into its search field.
 */
let typedAhead = '';

/**
 * Keeps printable keys pressed before the palette exists, so fast typing after `/` is not lost.
 *
 * @param event Key press.
 */
function bufferKey(event: KeyboardEvent): void {
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    typedAhead += event.key;
  }
}

/**
 * Loads the palette on first use and opens it.
 *
 * @param url Search index URL.
 * @param query Initial search text.
 * @param showFilters Whether to open the filters disclosure.
 */
async function open(url: string, query = '', showFilters = false): Promise<void> {
  const loading = palette === undefined;
  palette ??= loadModule('palette', async () => import('./palette.ts'));
  if (loading) {
    document.addEventListener('keydown', bufferKey);
  }

  const module = await palette;
  document.removeEventListener('keydown', bufferKey);
  if (!module) {
    palette = undefined;
    return;
  }

  const text = query + typedAhead;
  typedAhead = '';
  await module.openPalette(url, text, showFilters);
}

/**
 * Whether a key press happened while the reader was typing.
 *
 * @param target Event target.
 * @returns True inside text fields, selects and editable content.
 */
function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  );
}

/**
 * Opens search on `/` or ⌘K / Ctrl+K, except while typing.
 *
 * @param url Search index URL.
 * @param event Key press.
 */
function shortcut(url: string, event: KeyboardEvent): void {
  if (event.defaultPrevented || isEditing(event.target)) {
    return;
  }

  // Match the character typed, not the keys: on German QWERTZ "/" is Shift+7, and other layouts
  // need AltGr. Only Ctrl and ⌘ turn the key into something else.
  const slash = event.key === '/' && !event.ctrlKey && !event.metaKey;
  const command =
    event.key.toLowerCase() === 'k' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey;
  if (slash || command) {
    event.preventDefault();
    const field = document.querySelector<HTMLInputElement>('[data-filter-text="index"]');
    if (slash && field) {
      field.focus();
    } else {
      void open(url);
    }
  }
}

connectMenu();
if (document.querySelector('[data-timeline]')) {
  void loadModule('timeline', async () => import('./timeline.ts'));
}

if (document.querySelector('[data-item-gallery] img')) {
  void loadModule('gallery', async () => import('./gallery.ts'));
}

if (!forwardLegacyItemsLinks() && trigger?.dataset['index'] !== undefined) {
  const url = trigger.dataset['index'];
  trigger.hidden = false;
  trigger.addEventListener('click', () => void open(url));
  document.addEventListener('keydown', (event) => shortcut(url, event));
  // The Items page's `q` is its own search; elsewhere an older palette `q` moves to `pq`.
  const inline = document.querySelector('[data-filter-text="index"]') !== null;
  const state = inline
    ? readPaletteState(new URLSearchParams(location.search))
    : adoptLegacyQuery();
  if (state.open) {
    void open(url, state.query, state.filters);
  }
}
