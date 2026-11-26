import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertSameNode,
  atlasFile,
  installDom,
  loadPage,
  query,
  runModule,
  settle,
} from './test-dom.ts';

/**
 * The rendered Starter templates item: a linked diagram, a linked screenshot and an animated GIF.
 */
const page = await atlasFile('items/item-starter-templates/index.html');
installDom();

/**
 * Shows a page and runs the gallery module on it, as the page load does.
 *
 * @param html Page or fragment.
 */
async function open(html: string): Promise<void> {
  loadPage(html, '/items/item-starter-templates/');
  await runModule('gallery.ts');
}

/**
 * Clicks an element as a pointer would.
 *
 * @param target Element.
 * @param init Modifier keys and button.
 * @returns The click event, to check whether it was handled.
 */
function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * Waits for the lazily loaded dialog to open.
 *
 * @returns The dialog, or null when none opened.
 */
async function dialog(): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = document.querySelector<HTMLElement>('ui-dialog');
    if (found?.querySelector('[data-gallery-position]')?.textContent) {
      return found;
    }

    await settle();
  }

  return null;
}

/**
 * Reads the slides of an open gallery.
 *
 * @param root Dialog.
 * @returns Image source and caption per slide.
 */
function slides(root: HTMLElement): Array<[string, string]> {
  return [...root.querySelectorAll('.gallery-slide')].map((figure) => [
    figure.querySelector('img')?.getAttribute('src') ?? '',
    figure.querySelector('figcaption')?.textContent ?? '',
  ]);
}

/**
 * The brief's images in document order.
 *
 * @returns Images.
 */
function images(): Array<HTMLImageElement> {
  return [...document.querySelectorAll<HTMLImageElement>('[data-item-gallery] img')];
}

void describe('item gallery', () => {
  void it('opens every authored image as a slide at the one pressed', async () => {
    await open(page);
    const [, screenshot] = images();
    assert.ok(screenshot);
    // A cancelled click keeps the browser on the page. (happy-dom follows a link before ancestors'
    // listeners run, so the test checks the cancellation rather than the URL.)
    const event = click(screenshot);
    assert.equal(event.defaultPrevented, true);
    const opened = await dialog();
    assert.ok(opened, 'the gallery opened');
    assert.equal(query('[data-gallery-position]', HTMLElement, opened).textContent, 'Image 2 of 3');
    const [diagram, still, animation] = slides(opened);
    assert.match(diagram?.[0] ?? '', /^https:\/\/roadmap\.test\/diagrams\/.+\.svg$/);
    assert.equal(diagram?.[1], 'Template pilot decision');
    assert.deepEqual(still, [
      'https://roadmap.test/media/cb1c1a881dc3ce56.png',
      'Checklist preview',
    ]);
    assert.deepEqual(animation, [
      'https://roadmap.test/media/8d75492bd102f01b-poster.png',
      'Setup interaction',
    ]);
    assert.equal(query('[data-gallery-destination]', HTMLElement, opened).hidden, true);
  });

  void it('opens from a link that holds only the image, instead of following it', async () => {
    await open(page);
    const link = images()[0]?.closest('a');
    assert.ok(link);
    assert.equal(click(link).defaultPrevented, true);
    const opened = await dialog();
    assert.ok(opened);
    assert.equal(query('[data-gallery-position]', HTMLElement, opened).textContent, 'Image 1 of 3');
  });

  void it('lets modified and secondary clicks follow the image link', async () => {
    await open(page);
    const [diagram] = images();
    assert.ok(diagram);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      assert.equal(click(diagram, init).defaultPrevented, false);
    }

    await settle();
    assertSameNode(document.querySelector('ui-dialog'), null);
  });

  void it('leaves an animation’s poster to play in place', async () => {
    await open(page);
    const poster = document.querySelector('details.gif summary img');
    assert.ok(poster);
    assert.equal(click(poster).defaultPrevented, false);
  });

  void it('captions from the title or alt text, and keeps a link to elsewhere', async () => {
    await open(`<div data-item-gallery>
      <p><a href="/specs/billing/"><img src="/media/a.png" alt="Spec diagram" title="The spec"></a></p>
      <p><img src="/media/b.png" alt="Bare image"></p>
      <p><a href="/media/c.gif"><img src="/media/c-poster.png" alt="Animated"></a></p>
    </div>`);
    const [first] = images();
    assert.ok(first);
    click(first);
    const opened = await dialog();
    assert.ok(opened);
    assert.deepEqual(slides(opened), [
      ['https://roadmap.test/media/a.png', 'The spec'],
      ['https://roadmap.test/media/b.png', 'Bare image'],
      ['https://roadmap.test/media/c-poster.png', 'Animated'],
    ]);
    const destination = query('[data-gallery-destination]', HTMLAnchorElement, opened);
    assert.equal(destination.hidden, false);
    assert.equal(destination.href, 'https://roadmap.test/specs/billing/');
    assert.equal(query('[data-gallery-play]', HTMLElement, opened).hidden, true);
    query('[data-gallery-next]', HTMLElement, opened).click();
    query('[data-gallery-next]', HTMLElement, opened).click();
    assert.equal(
      query('[data-gallery-play]', HTMLElement, opened).hidden,
      false,
      'a poster linking to its GIF plays it',
    );
  });

  void it('does nothing on a page without authored images', async () => {
    await open('<div data-item-gallery><p>No images.</p></div>');
    click(query('[data-item-gallery] p', HTMLElement));
    await settle();
    assertSameNode(document.querySelector('ui-dialog'), null);
  });
});
