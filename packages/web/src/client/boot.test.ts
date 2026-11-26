import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  assertSameNode,
  atlasFile,
  installDom,
  loadPage,
  params,
  query,
  runModule,
  serve,
  settle,
} from './test-dom.ts';

/**
 * Rendered pages that each wire up something different on load.
 */
const [sets, items, home, timeline, item, index] = await Promise.all([
  atlasFile('sets/index.html'),
  atlasFile('items/index.html'),
  atlasFile('index.html'),
  atlasFile('timeline/index.html'),
  atlasFile('items/item-starter-templates/index.html'),
  atlasFile('search-index.json'),
]);
installDom();

/**
 * Shows a page and runs the boot script on it, as the page load does. The modules it imports
 * (filters, palette, timeline, gallery) load once per test file and are shared between runs.
 *
 * @param html Page.
 * @param path Path and query.
 */
async function boot(html: string, path: string): Promise<void> {
  loadPage(html, path);
  serve({ '/search-index.json': index });
  await runModule('boot.ts');
}

/**
 * Presses a key on an element.
 *
 * @param key Key value.
 * @param init Modifier keys.
 * @param target Element pressed on; the body by default.
 * @returns The key event.
 */
function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Element = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * The palette dialog, kept from the first open: the palette mounts once per test file.
 */
let palette: HTMLElementTagNameMap['ui-dialog'] | undefined;

/**
 * Closes the palette with Escape, so the next page opens it afresh.
 */
async function closePalette(): Promise<void> {
  palette ??= document.querySelector('ui-dialog') ?? undefined;
  assert.ok(palette, 'the palette has mounted');
  palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
}

/**
 * Waits until the palette dialog is open, and reports what the URL says.
 *
 * @returns Whether the URL records the palette as open.
 */
async function paletteOpened(): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    palette ??= document.querySelector('ui-dialog') ?? undefined;
    if (palette?.open) {
      break;
    }

    await settle();
  }

  return params().get('search') === 'palette';
}

/**
 * What the palette's search field holds, once the palette has mounted.
 *
 * @returns The field's text, or undefined before the palette exists.
 */
function searchText(): string | undefined {
  return document.querySelector<HTMLInputElement>('ui-dialog ui-command-input input')?.value;
}

void describe('boot', () => {
  void it('opens search on / and replays keys typed while the palette loads', async () => {
    await boot(sets, '/sets/');
    const trigger = query('[data-search-open]', HTMLButtonElement);
    assert.equal(trigger.hidden, false, 'the Search button appears once the script runs');
    assert.equal(press('/').defaultPrevented, true);
    press('b');
    press('i');
    assert.equal(await paletteOpened(), true);
    await settle();
    assert.equal(params().get('pq'), 'bi');
    assert.equal(document.querySelector('ui-dialog')?.open, true);
    await closePalette();
    assert.equal(location.search, '');
  });

  void it('opens search from the button and with ⌘K or Ctrl+K', async () => {
    await boot(sets, '/sets/');
    query('[data-search-open]', HTMLButtonElement).click();
    assert.equal(await paletteOpened(), true);
    await closePalette();

    await boot(sets, '/sets/');
    assert.equal(press('k', { metaKey: true }).defaultPrevented, true);
    assert.equal(await paletteOpened(), true);
    await closePalette();

    await boot(sets, '/sets/');
    assert.equal(press('K', { ctrlKey: true }).defaultPrevented, true);
    assert.equal(await paletteOpened(), true);
    await closePalette();
  });

  void it('leaves other shortcuts and keys typed into fields alone', async () => {
    await boot(sets, '/sets/');
    const field = query('input[data-filter-text]', HTMLInputElement);
    assert.equal(press('/', {}, field).defaultPrevented, false);
    assert.equal(press('k', { ctrlKey: true, shiftKey: true }).defaultPrevented, false);
    assert.equal(press('k', { metaKey: true, altKey: true }).defaultPrevented, false);
    assert.equal(press('/', { ctrlKey: true }).defaultPrevented, false);
    const handled = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    await settle();
    assert.equal(params().has('search'), false);
  });

  void it('moves an older palette link’s q to pq and opens the palette', async () => {
    await boot(sets, '/sets/?q=billing');
    assert.equal(await paletteOpened(), true);
    assert.equal(params().get('pq'), 'billing');
    assert.equal(params().has('q'), false);
    await closePalette();
  });

  void it('on the Items page, focuses its own search on / and keeps its q', async () => {
    await boot(items, '/items/?q=setup');
    assert.equal(params().get('q'), 'setup');
    assert.equal(params().has('search'), false, 'the Items search owns q');
    const field = query('[data-filter-text="index"]', HTMLInputElement);
    assert.equal(press('/').defaultPrevented, true);
    assertSameNode(document.activeElement, field, 'the inline field has focus');
    assert.equal(params().has('search'), false);
    press('k', { metaKey: true });
    assert.equal(await paletteOpened(), true);
    assert.equal(params().get('q'), 'setup');
    await closePalette();
  });

  void it('reopens the palette a shared URL asks for, with its filters', async () => {
    loadPage(items, '/items/?search=filters&pq=invoice');
    serve({ '/search-index.json': index });
    // The palette mounts once per test file. When an earlier test mounted it, put it on this page
    // closed, collapsed and empty, as a fresh page load would have it, so only boot can open it.
    palette ??= document.querySelector('ui-dialog') ?? undefined;
    if (palette) {
      assert.equal(palette.open, false);
      assert.equal(query('details', HTMLDetailsElement, palette).open, false);
      assert.equal(query('ui-command-input input', HTMLInputElement, palette).value, '');
      document.body.append(palette);
    }

    await runModule('boot.ts');
    for (let attempt = 0; attempt < 50 && searchText() !== 'invoice'; attempt += 1) {
      await settle();
    }

    await settle();
    const dialog = document.querySelector('ui-dialog');
    assert.ok(dialog, 'the palette is on the page');
    assert.equal(dialog.isConnected, true);
    assert.equal(dialog.open, true, 'boot opened the palette');
    const filters = query('details', HTMLDetailsElement, dialog);
    assert.equal(filters.open, true, 'the Filters disclosure is expanded');
    assert.equal(query('ui-command-input input', HTMLInputElement, dialog).value, 'invoice');
    assert.equal(params().get('search'), 'filters');
    assert.equal(params().get('pq'), 'invoice');
    // Later tests open the shared palette expecting Filters collapsed.
    filters.open = false;
    await settle();
    await closePalette();
  });

  void it('forwards an old Items link on the home page instead of offering search', async () => {
    const forwarded: Array<string> = [];
    mock.method(location, 'replace', (url: string | URL) => {
      forwarded.push(String(url));
    });
    await boot(home, '/?q=setup');
    assert.deepEqual(forwarded, ['/items/?q=setup']);
    assert.equal(query('[data-search-open]', HTMLButtonElement).hidden, true);
  });

  void it('loads the timeline module on a page that has a timeline', async () => {
    await boot(timeline, '/timeline/');
    const tools = query('[data-timeline-tools]', HTMLElement);
    for (let attempt = 0; attempt < 50 && !tools.hasAttribute('data-ready'); attempt += 1) {
      await settle();
    }

    assert.equal(tools.hasAttribute('data-ready'), true);
  });

  void it('loads the gallery module on an item with images', async () => {
    await boot(item, '/items/item-starter-templates/');
    const image = query('[data-item-gallery] figure img', HTMLImageElement);
    let opened = false;
    for (let attempt = 0; attempt < 50 && !opened; attempt += 1) {
      await settle();
      // dispatchEvent returns false once a listener cancels the click.
      opened = !image.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    }

    assert.equal(opened, true, 'the gallery handles a press on an image');
    for (let attempt = 0; attempt < 50 && !document.querySelector('ui-dialog'); attempt += 1) {
      await settle();
    }

    query('ui-dialog ui-dialog-close button', HTMLElement).click();
    await settle();
    assertSameNode(document.querySelector('ui-dialog'), null);
  });
});
