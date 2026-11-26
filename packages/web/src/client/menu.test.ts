import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSameNode, atlasFile, installDom, loadPage, query } from './test-dom.ts';

/**
 * The rendered Feature sets page, whose header holds the narrow-screen menu.
 */
const page = await atlasFile('sets/index.html');
installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { connectMenu } = await import('./menu.ts');

/**
 * Shows the page, connects the menu and opens it.
 *
 * @returns The menu disclosure.
 */
function openMenu(): HTMLDetailsElement {
  loadPage(page, '/sets/');
  connectMenu();
  const menu = query('details[data-collection-picker]', HTMLDetailsElement);
  menu.open = true;
  return menu;
}

/**
 * The links inside the menu.
 *
 * @param menu Menu disclosure.
 * @returns First and second link.
 */
function links(menu: HTMLDetailsElement): [HTMLAnchorElement, HTMLAnchorElement] {
  const [first, second] = menu.querySelectorAll('a');
  assert.ok(first && second, 'the rendered menu lists at least two links');
  return [first, second];
}

void describe('connectMenu', () => {
  void it('does nothing on a page without the menu', () => {
    loadPage('<main><p>No menu here.</p></main>');
    assert.doesNotThrow(() => connectMenu());
  });

  void it('closes on a press outside the menu but not inside it', () => {
    const menu = openMenu();
    query('summary', HTMLElement, menu).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    assert.equal(menu.open, true);
    query('main', HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(menu.open, false);
  });

  void it('closes on Escape and returns focus to its summary', () => {
    const menu = openMenu();
    const [link] = links(menu);
    link.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    link.dispatchEvent(escape);
    assert.equal(menu.open, false);
    assert.equal(escape.defaultPrevented, true);
    assertSameNode(document.activeElement, query('summary', HTMLElement, menu));
  });

  void it('ignores other keys, and Escape while closed', () => {
    const menu = openMenu();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(menu.open, true);
    menu.open = false;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, false);
  });

  void it('closes when focus moves outside, not within it or out of the window', () => {
    const menu = openMenu();
    const [first, second] = links(menu);
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: second }));
    assert.equal(menu.open, true);
    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    assert.equal(menu.open, true);
    first.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: query('main', HTMLElement) }),
    );
    assert.equal(menu.open, false);
  });
});
