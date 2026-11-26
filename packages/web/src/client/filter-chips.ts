/**
 * Upgrades the filter chips to UI SDK selects and keeps them in step with the URL. Loaded the first
 * time someone reaches for a chip.
 */

import type { UiSelectElement } from '@ui-sdk/web';

// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-select>.
import '@ui-sdk/web/select';

import { FILTERS_CHANGED } from './events.ts';

/**
 * Reads a chip's value as the URL stores it.
 *
 * @param value Select value.
 * @returns The value, or empty for nothing chosen.
 */
function asParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Writes a chip's new value to the URL and tells the page to refilter.
 *
 * @param chip Chip that changed.
 * @param value New value.
 */
function write(chip: UiSelectElement, value: unknown): void {
  const name = chip.dataset['filter'] ?? '';
  const url = new URL(location.href);
  const next = asParam(value);
  if ((url.searchParams.get(name) ?? '') === next) {
    return;
  }

  if (next) {
    url.searchParams.set(name, next);
  } else {
    url.searchParams.delete(name);
  }

  history.pushState(null, '', url);
  document.dispatchEvent(new Event(FILTERS_CHANGED));
}

/**
 * Sets every chip to the value in the URL.
 *
 * @param list Chips on the page.
 */
function sync(list: ReadonlyArray<UiSelectElement>): void {
  const params = new URLSearchParams(location.search);
  for (const chip of list) {
    const value = params.get(chip.dataset['filter'] ?? '');
    if (asParam(chip.value) !== (value ?? '')) {
      chip.value = value;
    }
  }
}

/**
 * Names an upgraded chip by its label alone. Before the upgrade the button named itself with the
 * label and its placeholder text; as a combobox it announces the value itself.
 *
 * @param chip Upgraded chip.
 */
export function labelChip(chip: UiSelectElement): void {
  const label = chip.querySelector('ui-select-label');
  const button = chip.querySelector('ui-select-trigger button');
  if (label?.id && button) {
    button.removeAttribute('aria-label');
    button.setAttribute('aria-labelledby', label.id);
  }
}

/**
 * Connects every chip on the page once the select element is defined.
 */
export async function connectChips(): Promise<void> {
  await customElements.whenDefined('ui-select');
  const list = [...document.querySelectorAll('ui-select')].filter((chip) =>
    chip.hasAttribute('data-filter'),
  );
  sync(list);
  for (const chip of list) {
    labelChip(chip);
    chip.addEventListener('valuechange', (event) => write(chip, event.detail.value));
  }

  addEventListener('popstate', () => sync(list));
  document.addEventListener(FILTERS_CHANGED, () => sync(list));
}
