import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Slide } from './gallery.ts';

import { assertSameNode, installDom, query, settle } from './test-dom.ts';

installDom();

/**
 * The module under test, loaded once the DOM globals exist. Importing it registers `<ui-dialog>`.
 */
const { openGallery } = await import('./gallery-dialog.ts');

/**
 * Builds a still image slide.
 *
 * @param name File name stem.
 * @param fields Fields that matter to the test.
 * @returns Slide.
 */
function slide(name: string, fields: Partial<Slide> = {}): Slide {
  return {
    source: `https://roadmap.test/media/${name}.png`,
    poster: undefined,
    alt: `${name} alt`,
    caption: `${name} caption`,
    destination: undefined,
    ...fields,
  };
}

/**
 * Three stills, the second linking elsewhere, and an animation.
 */
const SLIDES: ReadonlyArray<Slide> = [
  slide('one'),
  slide('two', { destination: 'https://example.com/spec' }),
  slide('three', {
    source: 'https://roadmap.test/media/three.gif',
    poster: 'https://roadmap.test/media/three-poster.png',
  }),
];

/**
 * Opens the gallery and lets its first frame run.
 *
 * @param index Slide to open.
 * @param slides Slides.
 * @param opener Element that gets focus back.
 * @returns The dialog root.
 */
async function open(
  index: number,
  slides: ReadonlyArray<Slide> = SLIDES,
  opener?: HTMLElement,
): Promise<HTMLElement> {
  await openGallery(slides, index, opener);
  await settle();
  return query('ui-dialog', HTMLElement);
}

/**
 * The position text, such as "Image 2 of 3".
 *
 * @returns Position label.
 */
function position(): string {
  return query('[data-gallery-position]', HTMLElement).textContent;
}

/**
 * Presses a key on the dialog.
 *
 * @param dialog Dialog root.
 * @param key Key name.
 * @returns The key event.
 */
function press(dialog: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  query('[data-gallery-track]', HTMLElement, dialog).dispatchEvent(event);
  return event;
}

void describe('openGallery', () => {
  void it('opens at the pressed slide with every image and caption as text', async () => {
    const dialog = await open(1);
    assert.equal(document.querySelector('ui-dialog')?.open, true);
    assert.equal(position(), 'Image 2 of 3');
    const figures = [...dialog.querySelectorAll<HTMLElement>('.gallery-slide')];
    assert.deepEqual(
      figures.map((figure) => [
        figure.querySelector('img')?.getAttribute('src'),
        figure.querySelector('img')?.alt,
        figure.querySelector('figcaption')?.textContent,
        figure.hasAttribute('data-current'),
      ]),
      [
        ['https://roadmap.test/media/one.png', 'one alt', 'one caption', false],
        ['https://roadmap.test/media/two.png', 'two alt', 'two caption', true],
        ['https://roadmap.test/media/three-poster.png', 'three alt', 'three caption', false],
      ],
    );
  });

  void it('moves with the arrow keys and the buttons, wrapping at both ends', async () => {
    const dialog = await open(0);
    const left = press(dialog, 'ArrowLeft');
    assert.equal(left.defaultPrevented, true);
    assert.equal(position(), 'Image 3 of 3');
    press(dialog, 'ArrowRight');
    assert.equal(position(), 'Image 1 of 3');
    query('[data-gallery-next]', HTMLElement).click();
    assert.equal(position(), 'Image 2 of 3');
    query('[data-gallery-previous]', HTMLElement).click();
    query('[data-gallery-previous]', HTMLElement).click();
    assert.equal(position(), 'Image 3 of 3');
    assert.equal(press(dialog, 'Enter').defaultPrevented, false);
  });

  void it('offers the image’s own link only on slides that have one', async () => {
    const dialog = await open(0);
    const link = query('[data-gallery-destination]', HTMLAnchorElement, dialog);
    assert.equal(link.hidden, true);
    press(dialog, 'ArrowRight');
    assert.equal(link.hidden, false);
    assert.equal(link.href, 'https://example.com/spec');
    press(dialog, 'ArrowRight');
    assert.equal(link.hidden, true);
  });

  void it('plays and pauses an animation, keeping its state when moving away', async () => {
    const dialog = await open(2);
    const play = query('[data-gallery-play]', HTMLButtonElement, dialog);
    const image = query('.gallery-slide[data-current] img', HTMLImageElement, dialog);
    assert.equal(play.hidden, false);
    assert.equal(play.textContent, 'Play animation');
    play.click();
    assert.equal(image.getAttribute('src'), 'https://roadmap.test/media/three.gif');
    assert.equal(play.textContent, 'Pause animation');
    press(dialog, 'ArrowRight');
    assert.equal(play.hidden, true, 'a still has nothing to play');
    press(dialog, 'ArrowLeft');
    assert.equal(play.textContent, 'Pause animation', 'the animation is still playing');
    play.click();
    assert.equal(image.getAttribute('src'), 'https://roadmap.test/media/three-poster.png');
    assert.equal(play.textContent, 'Play animation');
  });

  void it('follows a swipe to the slide scrolled into view', async () => {
    const dialog = await open(0);
    const track = query('[data-gallery-track]', HTMLElement, dialog);
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 400 });
    track.scrollLeft = 800;
    Object.defineProperty(track, 'scrollLeft', { configurable: true, value: 800 });
    track.dispatchEvent(new Event('scrollend'));
    assert.equal(position(), 'Image 3 of 3');
  });

  void it('hides the arrows for a single image', async () => {
    const dialog = await open(0, [slide('only')]);
    assert.equal(position(), 'Image 1 of 1');
    assert.equal(query('[data-gallery-previous]', HTMLElement, dialog).hidden, true);
    assert.equal(query('[data-gallery-next]', HTMLElement, dialog).hidden, true);
  });

  void it('removes itself on close and returns focus to the opener, even if it lacked focus', async () => {
    const opener = document.createElement('a');
    opener.href = '/media/one.png';
    document.body.append(opener);
    // Regression: a press on an image need not focus its link (Safari, touch), and the dialog's
    // own focus restore, which runs after `openchange`, used to send focus back to whatever had
    // it at opening (here a button; in Chromium the body) instead of the opener.
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    const dialog = await open(0, SLIDES, opener);
    query('ui-dialog-close button', HTMLElement, dialog).click();
    await settle();
    assert.equal(dialog.isConnected, false);
    assertSameNode(document.activeElement, opener, 'focus returns to the opener');
  });
});
