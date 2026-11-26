import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atlasFile, installDom, loadPage, query } from './test-dom.ts';

/**
 * The rendered timeline page, whose filter bar holds chips before they upgrade.
 */
const page = await atlasFile('timeline/index.html');
installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { showChoice } = await import('./chip-text.ts');

void describe('showChoice', () => {
  void it('shows the choice and names the button after the chip label before the upgrade', () => {
    loadPage(page, '/timeline/');
    const chip = query('ui-select[data-filter="status"]', HTMLElement);
    showChoice(chip, 'In progress');
    assert.equal(query('.chip-pending', HTMLElement, chip).textContent, 'In progress');
    assert.equal(
      query('ui-select-trigger button', HTMLElement, chip).getAttribute('aria-label'),
      `${chip.dataset['label'] ?? ''}: In progress`,
    );
  });

  void it('tolerates a chip without pending text or a button', () => {
    loadPage('<ui-select data-label="Team"></ui-select>');
    assert.doesNotThrow(() => showChoice(query('ui-select', HTMLElement), 'Growth'));
  });

  void it('leaves the button name to the select once it has upgraded', () => {
    loadPage(page, '/timeline/');
    const chip = query('ui-select[data-filter="team"]', HTMLElement);
    const button = query('ui-select-trigger button', HTMLElement, chip);
    const before = button.getAttribute('aria-label');
    customElements.define('ui-select', class extends HTMLElement {});
    showChoice(chip, 'Growth');
    assert.equal(query('.chip-pending', HTMLElement, chip).textContent, 'Growth');
    assert.equal(button.getAttribute('aria-label'), before);
  });
});
