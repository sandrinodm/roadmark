import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { atlasFile, installDom, loadPage, query, runModule, settle } from './test-dom.ts';

/**
 * The rendered timeline: the Gantt/List switch, grouping and zoom chips and bar tooltips.
 */
const page = await atlasFile('timeline/index.html');
installDom();

/**
 * Shows the timeline at a URL, runs the controls module and waits for its components.
 *
 * @param path Path and query.
 */
async function open(path: string): Promise<void> {
  loadPage(page, path);
  await runModule('timeline-controls.ts');
  await Promise.all([
    customElements.whenDefined('ui-segmented-control'),
    customElements.whenDefined('ui-select'),
    customElements.whenDefined('ui-tooltip'),
  ]);
  await settle();
}

/**
 * Reads a component value as text.
 *
 * @param value Component value.
 * @returns The value when it is text, or empty.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the Gantt/List switch's value.
 *
 * @returns The view it shows.
 */
function view(): string {
  return text(document.querySelector('ui-segmented-control')?.value);
}

/**
 * Reads a setting chip's value.
 *
 * @param name `group` or `zoom`.
 * @returns The chosen value.
 */
function setting(name: string): string {
  return text(
    document.querySelector<HTMLElementTagNameMap['ui-select']>(`ui-select[data-setting="${name}"]`)
      ?.value,
  );
}

void describe('timeline controls', () => {
  void it('sets the switch and setting chips to the URL', async () => {
    await open('/timeline/?view=list&group=team&zoom=quarter');
    assert.equal(view(), 'list');
    assert.equal(setting('group'), 'team');
    assert.equal(setting('zoom'), 'quarter');
  });

  void it('falls back to the chart, releases and months, or the list on a narrow screen', async () => {
    await open('/timeline/?view=table');
    assert.equal(view(), 'chart');
    assert.equal(setting('group'), 'release');
    assert.equal(setting('zoom'), 'month');

    mock.method(globalThis, 'matchMedia', (media: string) => ({ media, matches: true }));
    await open('/timeline/');
    assert.equal(view(), 'list');
  });

  void it('names each setting chip by its label', async () => {
    await open('/timeline/');
    for (const name of ['group', 'zoom']) {
      const chip = query(`ui-select[data-setting="${name}"]`, HTMLElement);
      const label = query('ui-select-label', HTMLElement, chip);
      const button = query('ui-select-trigger button', HTMLElement, chip);
      assert.notEqual(label.id, '');
      assert.equal(button.getAttribute('aria-labelledby'), label.id);
    }
  });

  void it('gives every bar its tooltip text and shows it in the shared tooltip', async () => {
    await open('/timeline/');
    const triggers = [...document.querySelectorAll('ui-tooltip-trigger')];
    assert.notEqual(triggers.length, 0);
    for (const trigger of triggers) {
      assert.equal(trigger.payload, trigger.getAttribute('data-tip'));
    }

    const tooltip = query('#timeline-tip', HTMLElement);
    tooltip.dispatchEvent(new CustomEvent('payloadchange', { detail: { value: 'Guided setup' } }));
    assert.equal(query('ui-tooltip-content', HTMLElement, tooltip).textContent, 'Guided setup');
    tooltip.dispatchEvent(new CustomEvent('payloadchange', { detail: { value: null } }));
    assert.equal(query('ui-tooltip-content', HTMLElement, tooltip).textContent, '');
  });

  void it('leaves the bars alone when the page has no shared tooltip', async () => {
    loadPage(page, '/timeline/');
    query('#timeline-tip', HTMLElement).remove();
    await runModule('timeline-controls.ts');
    await settle();
    const triggers = [...document.querySelectorAll('ui-tooltip-trigger')];
    assert.notEqual(triggers.length, 0);
    for (const trigger of triggers) {
      assert.equal(trigger.payload ?? '', '');
    }
  });

  void it('does nothing on a page without a timeline', async () => {
    loadPage('<main></main>', '/');
    await runModule('timeline-controls.ts');
    await settle();
    assert.equal(document.querySelector('main')?.childElementCount, 0);
  });
});
