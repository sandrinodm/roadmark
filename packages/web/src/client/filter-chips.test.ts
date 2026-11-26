import type { UiSelectElement } from '@ui-sdk/web';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atlasFile, installDom, loadPage, params, query, setUrl } from './test-dom.ts';

/**
 * The rendered timeline page: five filter chips and two view setting chips.
 */
const page = await atlasFile('timeline/index.html');
installDom();

/**
 * The module under test, loaded once the DOM globals exist. Importing it registers `<ui-select>`.
 */
const { connectChips, labelChip } = await import('./filter-chips.ts');

/**
 * The event every list on the page listens to.
 */
const { FILTERS_CHANGED } = await import('./events.ts');

/**
 * Finds an upgraded chip.
 *
 * @param selector Attribute selector, such as `[data-filter="team"]`.
 * @returns The select element.
 */
function chip(selector: string): UiSelectElement {
  const node = document.querySelector<UiSelectElement>(`ui-select${selector}`);
  assert.ok(node && customElements.get('ui-select'), `ui-select${selector} has upgraded`);
  return node;
}

/**
 * Shows the timeline at a URL and connects its chips.
 *
 * @param path Path and query.
 */
async function open(path: string): Promise<void> {
  loadPage(page, path);
  await connectChips();
}

/**
 * Reports a choice from a chip as the select component does.
 *
 * @param target Chip.
 * @param value Chosen value: a string, or null when cleared.
 */
function choose(target: UiSelectElement, value: unknown): void {
  target.dispatchEvent(new CustomEvent('valuechange', { detail: { value } }));
}

/**
 * Counts `FILTERS_CHANGED` events while a function runs.
 *
 * @param run Code that may dispatch the event.
 * @returns Number of events.
 */
function countChanges(run: () => void): number {
  let changes = 0;
  /**
   * Counts one event.
   */
  const listener = (): void => {
    changes += 1;
  };
  document.addEventListener(FILTERS_CHANGED, listener);
  run();
  document.removeEventListener(FILTERS_CHANGED, listener);
  return changes;
}

void describe('filter chips', () => {
  void it('sets every filter chip to the URL and leaves the view settings alone', async () => {
    await open('/timeline/?status=planned&team=growth&group=set');
    assert.equal(chip('[data-filter="status"]').value, 'planned');
    assert.equal(chip('[data-filter="team"]').value, 'growth');
    assert.equal(chip('[data-filter="release"]').value ?? '', '');
    assert.notEqual(chip('[data-setting="group"]').value, 'set');
  });

  void it('names each upgraded chip by its label alone', async () => {
    await open('/timeline/');
    const status = chip('[data-filter="status"]');
    const label = query('ui-select-label', HTMLElement, status);
    const button = query('ui-select-trigger button', HTMLElement, status);
    assert.notEqual(label.id, '');
    assert.equal(button.hasAttribute('aria-label'), false);
    assert.equal(button.getAttribute('aria-labelledby'), label.id);
  });

  void it('leaves a chip without a label id or button as it is', () => {
    loadPage('<ui-select><ui-select-label>Team</ui-select-label></ui-select>');
    assert.doesNotThrow(() => labelChip(chip('')));
  });

  void it('writes a choice to the URL as a new history entry and refilters the page', async () => {
    await open('/timeline/?zoom=quarter');
    const before = history.length;
    const changes = countChanges(() => choose(chip('[data-filter="team"]'), 'billing'));
    assert.equal(location.search, '?zoom=quarter&team=billing');
    assert.equal(history.length, before + 1);
    assert.equal(changes, 1);
  });

  void it('removes a cleared chip from the URL and ignores a choice the URL already has', async () => {
    await open('/timeline/?team=billing&status=done');
    const before = history.length;
    const unchanged = countChanges(() => choose(chip('[data-filter="team"]'), 'billing'));
    assert.equal(unchanged, 0);
    assert.equal(history.length, before);
    choose(chip('[data-filter="team"]'), null);
    assert.equal(location.search, '?status=done');
    choose(chip('[data-filter="status"]'), { not: 'a string' });
    assert.equal(params().has('status'), false, 'a non-string value counts as cleared');
  });

  void it('follows the URL on history navigation and when another control changes it', async () => {
    await open('/timeline/');
    setUrl('/timeline/?set=set-billing');
    dispatchEvent(new PopStateEvent('popstate'));
    assert.equal(chip('[data-filter="set"]').value, 'set-billing');
    setUrl('/timeline/');
    document.dispatchEvent(new Event(FILTERS_CHANGED));
    assert.equal(chip('[data-filter="set"]').value ?? '', '');
  });
});
