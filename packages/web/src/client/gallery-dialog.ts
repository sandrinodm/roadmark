/**
 * The gallery dialog: a UI SDK dialog holding every slide on a CSS scroll-snap track. Swiping, the
 * arrow keys and the Previous and Next buttons move between slides.
 */

import type { UiDialogElement } from '@ui-sdk/web';

import type { Slide } from './gallery.ts';

// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-dialog>.
import '@ui-sdk/web/dialog';

/**
 * Static dialog markup; slides are added as elements with text set as text.
 */
const TEMPLATE = `<ui-dialog-backdrop class="gallery-backdrop" hidden></ui-dialog-backdrop>
<ui-dialog-content class="gallery" hidden>
  <ui-dialog-title class="visually-hidden">Item image gallery</ui-dialog-title>
  <div class="gallery-toolbar">
    <span class="num" data-gallery-position aria-live="polite"></span>
    <ui-dialog-close><button type="button" class="button">Close</button></ui-dialog-close>
  </div>
  <div class="gallery-track" data-gallery-track tabindex="0" role="group" aria-label="Images"></div>
  <div class="gallery-controls">
    <button type="button" class="button" data-gallery-previous>Previous image</button>
    <button type="button" class="button" data-gallery-play hidden>Play animation</button>
    <a class="button" data-gallery-destination hidden>Follow image link</a>
    <button type="button" class="button" data-gallery-next>Next image</button>
  </div>
</ui-dialog-content>`;

/**
 * The open gallery.
 */
type Gallery = {
  /**
   * Dialog root.
   */
  dialog: UiDialogElement;

  /**
   * Slides in order.
   */
  slides: ReadonlyArray<Slide>;

  /**
   * Index of the slide in view.
   */
  current: number;
};

/**
 * Builds a slide: the image and its caption.
 *
 * @param slide Slide data.
 * @returns Figure.
 */
function figure(slide: Slide): HTMLElement {
  const node = document.createElement('figure');
  node.className = 'gallery-slide';
  const image = document.createElement('img');
  image.src = slide.poster ?? slide.source;
  image.alt = slide.alt;
  image.decoding = 'async';
  const caption = document.createElement('figcaption');
  caption.textContent = slide.caption;
  node.append(image, caption);
  return node;
}

/**
 * Shows a slide: scrolls the track to it and updates the position, play and link controls.
 *
 * @param gallery Open gallery.
 * @param index Slide to show; wraps around at both ends.
 * @param scroll Whether to scroll the track (false when the reader scrolled it).
 */
function show(gallery: Gallery, index: number, scroll = true): void {
  const { dialog, slides } = gallery;
  gallery.current = (index + slides.length) % slides.length;
  const slide = slides[gallery.current];
  const figures = [...dialog.querySelectorAll<HTMLElement>('.gallery-slide')];
  for (const [position, node] of figures.entries()) {
    node.toggleAttribute('data-current', position === gallery.current);
  }

  if (scroll) {
    figures[gallery.current]?.scrollIntoView({ block: 'nearest', inline: 'start' });
  }

  const play = dialog.querySelector<HTMLButtonElement>('[data-gallery-play]');
  const link = dialog.querySelector<HTMLAnchorElement>('[data-gallery-destination]');
  const position = dialog.querySelector('[data-gallery-position]');
  if (play) {
    labelPlay(play, slide, figures[gallery.current]);
  }

  if (link) {
    link.hidden = !slide?.destination;
    link.href = slide?.destination ?? '';
  }

  if (position) {
    position.textContent = `Image ${gallery.current + 1} of ${slides.length}`;
  }
}

/**
 * Labels the play button for the slide in view. Each slide keeps playing or paused while the reader
 * moves away, so the label follows the slide's image rather than resetting.
 *
 * @param play Play button.
 * @param slide Slide in view.
 * @param node Its figure.
 */
function labelPlay(
  play: HTMLButtonElement,
  slide: Slide | undefined,
  node: HTMLElement | undefined,
): void {
  const playing = slide?.poster !== undefined && node?.querySelector('img')?.src === slide.source;
  play.hidden = slide?.poster === undefined;
  play.textContent = playing ? 'Pause animation' : 'Play animation';
}

/**
 * Switches the slide in view between its poster and its animation.
 *
 * @param gallery Open gallery.
 */
function togglePlay(gallery: Gallery): void {
  const slide = gallery.slides[gallery.current];
  const image = gallery.dialog.querySelector<HTMLImageElement>('.gallery-slide[data-current] img');
  const play = gallery.dialog.querySelector('[data-gallery-play]');
  if (!slide?.poster || !image || !play) {
    return;
  }

  const playing = image.src === slide.source;
  image.src = playing ? slide.poster : slide.source;
  play.textContent = playing ? 'Play animation' : 'Pause animation';
}

/**
 * Creates the dialog for a set of slides and connects its controls.
 *
 * @param slides Slides in order.
 * @param opener Element that gets focus back when the dialog closes.
 * @returns The gallery.
 */
function mount(slides: ReadonlyArray<Slide>, opener: HTMLElement | undefined): Gallery {
  const dialog = document.createElement('ui-dialog');
  dialog.innerHTML = TEMPLATE;
  document.body.append(dialog);
  const gallery: Gallery = { dialog, slides, current: 0 };
  const track = dialog.querySelector<HTMLElement>('[data-gallery-track]');
  track?.append(...slides.map(figure));
  const single = slides.length === 1;
  for (const selector of ['[data-gallery-previous]', '[data-gallery-next]']) {
    const button = dialog.querySelector<HTMLElement>(selector);
    if (button) {
      button.hidden = single;
    }
  }

  dialog
    .querySelector('[data-gallery-previous]')
    ?.addEventListener('click', () => show(gallery, gallery.current - 1));
  dialog
    .querySelector('[data-gallery-next]')
    ?.addEventListener('click', () => show(gallery, gallery.current + 1));
  dialog.querySelector('[data-gallery-play]')?.addEventListener('click', () => togglePlay(gallery));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(gallery, gallery.current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  track?.addEventListener('scrollend', () => {
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (index !== gallery.current) {
      show(gallery, index, false);
    }
  });
  dialog.addEventListener('openchange', (event) => {
    if (!event.detail.value) {
      dialog.remove();
      opener?.focus();
    }
  });
  return gallery;
}

/**
 * Opens the gallery at a slide.
 *
 * @param slides Slides in order.
 * @param index Slide to open.
 * @param opener Element that gets focus back when the dialog closes.
 */
export async function openGallery(
  slides: ReadonlyArray<Slide>,
  index: number,
  opener: HTMLElement | undefined,
): Promise<void> {
  const gallery = mount(slides, opener);
  await customElements.whenDefined('ui-dialog');
  // The dialog gives focus back to whatever had it when it opened, after `openchange`. A press on
  // an image does not always focus its link (Safari, touch, keyboard-less clicks), so focus the
  // opener first or closing would leave focus on the body.
  opener?.focus({ preventScroll: true });
  gallery.dialog.open = true;
  requestAnimationFrame(() => show(gallery, index));
  show(gallery, index, false);
}
