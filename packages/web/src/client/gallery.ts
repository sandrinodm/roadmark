/**
 * Opens an item's images in a gallery. Each authored image is a slide; an animated GIF's poster and
 * its animation share one. The dialog loads on the first press of an image.
 */

import { loadModule } from './stale.ts';

/**
 * One gallery slide.
 */
export type Slide = {
  /**
   * Image shown, or the animation for an animated GIF.
   */
  source: string;

  /**
   * Still poster of an animation.
   */
  poster: string | undefined;

  /**
   * Alternative text.
   */
  alt: string;

  /**
   * Caption, title or alternative text.
   */
  caption: string;

  /**
   * Where the authored image linked, when that is not the image itself.
   */
  destination: string | undefined;
};

/**
 * A brief's slides and the elements that open them.
 */
type Collected = {
  /**
   * Slides in order.
   */
  slides: Array<Slide>;

  /**
   * Images and image-only links, with the slide each opens.
   */
  openers: Map<Element, number>;
};

/**
 * Reads the slides of a brief and which elements open which slide.
 *
 * @param container Brief with the authored images.
 * @returns Slides and their openers.
 */
function collect(container: Element): Collected {
  const slides: Array<Slide> = [];
  const openers = new Map<Element, number>();
  for (const image of container.querySelectorAll('img')) {
    const animation = image.closest('details.gif');
    if (animation && !image.closest('summary')) {
      continue;
    }

    const link = image.closest('a');
    // An animation's poster sits in the summary of a native disclosure, which plays it inline.
    if (!animation) {
      openers.set(image, slides.length);
    }

    if (!animation && link?.children.length === 1 && !link.textContent.trim()) {
      openers.set(link, slides.length);
    }

    slides.push(slideFor(image, link, animation));
  }

  return { slides, openers };
}

/**
 * Describes one image as a slide.
 *
 * @param image Authored image or animation poster.
 * @param link Link around the image, if any.
 * @param animation Disclosure holding an animated GIF, if any.
 * @returns Slide.
 */
function slideFor(
  image: HTMLImageElement,
  link: HTMLAnchorElement | null,
  animation: Element | null,
): Slide {
  const animationSource = animationOf(image, link, animation);
  const source = animationSource ?? image.src;
  const caption = image.closest('figure')?.querySelector('figcaption')?.textContent ?? '';
  return {
    source,
    poster: animationSource ? image.src : undefined,
    alt: image.alt,
    caption: caption || image.title || image.alt,
    destination: link && link.href !== source ? link.href : undefined,
  };
}

/**
 * Finds the animation behind a still: the GIF in its disclosure, or the GIF its poster links to.
 *
 * @param image Image or poster.
 * @param link Link around it, if any.
 * @param animation Disclosure holding an animated GIF, if any.
 * @returns Animation URL, or undefined for a still image.
 */
function animationOf(
  image: HTMLImageElement,
  link: HTMLAnchorElement | null,
  animation: Element | null,
): string | undefined {
  const animated = animation?.querySelector<HTMLImageElement>(':scope > img');
  if (animated) {
    return animated.src;
  }

  const poster =
    link !== null && link.pathname.endsWith('.gif') && image.src.endsWith('-poster.png');
  return poster ? link.href : undefined;
}

/**
 * Opens the gallery when an image or an image-only link is pressed without modifier keys.
 *
 * @param container Brief with the authored images.
 */
function connect(container: HTMLElement): void {
  const { slides, openers } = collect(container);
  if (openers.size === 0) {
    return;
  }

  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('img, a') : null;
    const index = target ? openers.get(target) : undefined;
    const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    if (!target || index === undefined || modified || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const opener =
      target.closest<HTMLElement>('a, summary') ??
      target.closest('details')?.querySelector<HTMLElement>('summary') ??
      undefined;
    void loadModule('gallery-dialog', async () => import('./gallery-dialog.ts')).then(
      async (module) => module?.openGallery(slides, index, opener),
    );
  });
}

/**
 * The brief whose images form the gallery, if any.
 */
const container = document.querySelector<HTMLElement>('[data-item-gallery]');
if (container) {
  connect(container);
}
