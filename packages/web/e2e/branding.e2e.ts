import type { Browser } from '@e2e-dev/web';
import type { Locator } from 'e2e';

import { test } from '@e2e-dev/web';
import { ATLAS_URL } from '@roadmark/test-fixtures';
import { expect } from 'e2e';
import { appendFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serveCopy } from './support/cli.ts';

/**
 * The base path every branded copy of Atlas is published under.
 */
const BASE = '/product/roadmap/';

/**
 * A dark palette: light text on dark surfaces, which every reading surface must keep legible.
 */
const DARK_BRAND = `schema_version: 1
colors:
  background: '#111a23'
  surface: '#182533'
  text: '#e8f1f7'
  muted: '#a9bfd3'
  accent: '#96d9fc'
  inverse_background: '#09141f'
  inverse_text: '#f2f8ff'
`;

/**
 * Inline code and a table appended to an item brief, so their colors are checked too.
 */
const MARKDOWN = [
  '',
  'Check the `setup` flag.',
  '',
  '| Input | Result |',
  '| --- | --- |',
  '| Start | Ready |',
  '',
].join('\n');

/**
 * The WCAG AA contrast ratio for normal-size text.
 */
const MINIMUM_TEXT_CONTRAST = 4.5;

/**
 * The docs/branding.md example, with families only (no font files) and the Atlas mark standing in
 * for its logo and background image.
 */
const DOCS_BRAND = `schema_version: 1
colors:
  background: '#eef3f8'
  surface: '#fbfdff'
  text: '#10243b'
  accent: '#07548c'
typography:
  body:
    font:
      family: Inter Tight
    tracking: 0.012
    line_height: 1.55
  display:
    font:
      family: Bricolage Grotesque
    tracking: -0.035
  header:
    font:
      family: Bricolage Grotesque
header:
  background: '#102b48'
  text: '#edf6ff'
  muted: '#c3daee'
  accent: '#a6dcfc'
  logo:
    file: brand/atlas-mark.png
    height: 34
    aspect: 1
background:
  image: brand/atlas-mark.png
  fit: contain
  position: top right
`;

/**
 * A 6:1 wordmark, wider than the narrow-screen cap, at 40px.
 */
const WORDMARK_BRAND = `schema_version: 1
header:
  logo:
    file: brand/atlas-mark.png
    height: 40
    aspect: 6
`;

/**
 * A 2:1 logo at 40px with the workspace name set in Georgia, tracked out by 0.08em.
 */
const HEADER_TYPE_BRAND = `schema_version: 1
header:
  logo:
    file: brand/atlas-mark.png
    height: 40
    aspect: 2
typography:
  header:
    font:
      family: Georgia
    tracking: 0.08
`;

test('keeps the collections, timeline and Markdown readable with the default and a dark brand', async ({
  browser,
  screen,
}) => {
  for (const variant of ['default', 'dark'] as const) {
    const site = await serveCopy(ATLAS_URL, BASE, 'roadmap-palette-', async (workspace) => {
      const brand = join(workspace, 'brand.yaml');
      await rm(brand);
      await appendFile(join(workspace, 'feature-sets/onboarding/items/guided-setup.md'), MARKDOWN);
      if (variant === 'dark') {
        await writeFile(brand, DARK_BRAND);
      }
    });
    try {
      await browser.goto(site.url + 'items/');
      await browser.locator('[data-collection-picker] summary').press('Enter');
      const primary = screen.getByRole('navigation', { name: 'Primary', exact: false });
      await readable(
        browser,
        primary.getByRole('link', { name: 'Items', exact: false }),
        { selector: 'nav[aria-label="Primary"] a', text: 'Items', visible: true },
        `${variant} current collection`,
      );
      await readable(
        browser,
        primary.getByRole('link', { name: 'Releases', exact: false }),
        { selector: 'nav[aria-label="Primary"] a', text: 'Releases', visible: true },
        `${variant} navigation`,
      );
      const entry = '[data-filter-entry="item-guided-setup"]';
      await readable(
        browser,
        browser.locator(entry).getByRole('link', { name: 'Guided workspace setup', exact: false }),
        { selector: `${entry} a`, text: 'Guided workspace setup', visible: true },
        `${variant} item title`,
      );
      await readable(
        browser,
        browser.locator(`${entry} .pill`),
        { selector: `${entry} .pill` },
        `${variant} item status`,
      );
      await readable(
        browser,
        browser.locator(`${entry} time`),
        { selector: `${entry} time` },
        `${variant} item target`,
      );

      await browser.goto(site.url + 'timeline/');
      await readable(
        browser,
        browser.locator('.gantt-corner'),
        { selector: '.gantt-corner' },
        `${variant} timeline axis`,
      );
      await readable(
        browser,
        browser.locator('.gantt-group:visible').first(),
        { selector: '.gantt-group', visible: true, first: true },
        `${variant} timeline group`,
      );
      await readable(
        browser,
        browser.locator('.gantt-row:nth-of-type(2n + 1):visible .gantt-label').first(),
        { within: '.gantt-row:nth-of-type(2n + 1)', selector: '.gantt-label', first: true },
        `${variant} striped timeline row`,
      );
      const chart = '.segmented [aria-checked="true"]';
      await readable(
        browser,
        browser.locator(chart),
        { selector: chart },
        `${variant} active timeline view`,
      );

      await browser.locator('[data-mark="item-guided-setup"]').click();
      const selected = '.gantt-row.is-connected .gantt-label';
      await readable(
        browser,
        browser.locator(selected).first(),
        { selector: selected, first: true },
        `${variant} selected timeline row`,
      );

      await browser.goto(site.url + 'items/item-guided-setup/');
      await readable(
        browser,
        browser.locator('.prose code').first(),
        { selector: '.prose code', first: true },
        `${variant} inline code`,
      );
      await readable(
        browser,
        screen.getByRole('columnheader', { name: 'Input', exact: false }),
        { selector: 'th', text: 'Input', visible: true },
        `${variant} table heading`,
      );
    } finally {
      await site.close();
    }
  }
});

test('sizes the logo from brand.yaml and sets the workspace name in the header type', async ({
  browser,
}) => {
  for (const [variant, size, font] of [
    ['atlas', { width: 28, height: 28 }, undefined],
    ['wordmark', { width: 240, height: 40 }, undefined],
    ['header type', { width: 80, height: 40 }, { family: 'Georgia', tracking: '0.08em' }],
  ] as const) {
    const site = await serveCopy(ATLAS_URL, BASE, 'roadmap-logo-', async (workspace) => {
      if (variant === 'wordmark') {
        await writeFile(join(workspace, 'brand.yaml'), WORDMARK_BRAND);
      }

      if (variant === 'header type') {
        await writeFile(join(workspace, 'brand.yaml'), HEADER_TYPE_BRAND);
      }
    });
    try {
      await browser.goto(site.url, { waitUntil: 'networkidle' });
      const logo = await browser.locator('.app-brand img').boundingBox();
      expect(
        { width: Math.round(logo?.width ?? 0), height: Math.round(logo?.height ?? 0) },
        variant,
      ).toEqual(size);
      const name = await browser.evaluate(() => {
        const nodes = document.querySelectorAll('.app-brand span');
        const node = nodes[0];
        if (nodes.length !== 1 || node === undefined) {
          throw new Error(`Expected one .app-brand span, found ${nodes.length}.`);
        }

        const style = getComputedStyle(node);
        return {
          family: style.fontFamily,
          spacing: style.letterSpacing,
          fontSize: Number.parseFloat(style.fontSize),
        };
      });
      if (font === undefined) {
        expect(name.family, variant).toMatch(/Geist/);
      } else {
        expect(name.family, variant).toMatch(new RegExp(font.family));
        expect(Number.parseFloat(name.spacing), variant).toBe(0.08 * name.fontSize);
      }
    } finally {
      await site.close();
    }
  }
});

test('applies the documented brand example to the header, titles and page', async ({ browser }) => {
  const site = await serveCopy(ATLAS_URL, BASE, 'roadmap-docs-brand-', async (workspace) => {
    await writeFile(join(workspace, 'brand.yaml'), DOCS_BRAND);
  });
  try {
    await browser.goto(site.url + 'releases/rel-spring/', { waitUntil: 'networkidle' });
    const styles = await browser.evaluate(() => {
      /**
       * The computed style of the first element matching a selector, or of the body.
       */
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: `evaluate` serializes the function, so its helpers live inside it.
      function styleOf(selector: string): CSSStyleDeclaration {
        return getComputedStyle(document.querySelector(selector) ?? document.body);
      }

      const body = styleOf('body');
      return {
        header: styleOf('.app-bar').backgroundColor,
        nav: styleOf('.app-nav a[aria-current="page"]').color,
        name: styleOf('.app-brand span').fontFamily,
        title: styleOf('h1').fontFamily,
        body: body.fontFamily,
        image: body.backgroundImage,
        logo: document.querySelector('.app-brand img')?.getBoundingClientRect().height ?? null,
      };
    });
    expect(styles.header).toBe('rgb(16, 43, 72)');
    expect(styles.nav).toBe('rgb(237, 246, 255)');
    expect(styles.name).toMatch(/Bricolage Grotesque/);
    expect(styles.title).toMatch(/Bricolage Grotesque/);
    expect(styles.body).toMatch(/Inter Tight/);
    expect(styles.image).toMatch(/url\(/);
    expect(Math.round(styles.logo ?? 0)).toBe(34);
    await readable(
      browser,
      browser.locator('.app-nav a[aria-current="page"]'),
      { selector: '.app-nav a[aria-current="page"]' },
      'docs example navigation',
    );
    await readable(
      browser,
      browser.locator('.facts-link'),
      { selector: '.facts-link' },
      'docs example facts link',
    );
  } finally {
    await site.close();
  }
});

/**
 * Finds the element a contrast check reads in the page: the elements matching `selector` (inside
 * the shown elements matching `within`), narrowed to those shown (`visible`) or whose trimmed text
 * is `text`; then the first of them (`first`) or, as a strict locator does, the only one. Shown
 * means what Playwright's `:visible` means: a non-empty box and no `visibility: hidden`.
 */
type Target = {
  /**
   * CSS selector of shown ancestors to look in, such as `.gantt-row:visible` was.
   */
  within?: string;

  /**
   * CSS selector of the candidates.
   */
  selector: string;

  /**
   * Keeps only candidates whose trimmed text is exactly this.
   */
  text?: string;

  /**
   * Keeps only candidates that are rendered.
   */
  visible?: boolean;

  /**
   * Takes the first candidate instead of requiring exactly one.
   */
  first?: boolean;
};

/**
 * Asserts the element has at least 4.5:1 text contrast against the backgrounds it sits on. The web
 * engine runs no code on a locator's element (Playwright's `locator.evaluate`), so the locator is
 * first checked to resolve to exactly one element, keeping its role and name coverage, and the
 * contrast is measured on the same element found by CSS in the page (`target`).
 */
async function readable(
  browser: Browser,
  locator: Locator,
  target: Target,
  label: string,
): Promise<void> {
  await expect(locator, label).toBeAttached();
  const contrast = await browser.evaluate((find: Target) => {
    /**
     * Whether an element is shown: a non-empty box and no `visibility: hidden`.
     */
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: `evaluate` serializes the function, so its helpers live inside it.
    function shown(node: Element): boolean {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    }

    const scopes =
      find.within === undefined
        ? [document.documentElement]
        : [...document.querySelectorAll(find.within)].filter((node) => shown(node));
    const candidates = scopes
      .flatMap((scope) => Array.from(scope.querySelectorAll<HTMLElement>(find.selector)))
      .filter(
        (node) =>
          (find.text === undefined || node.textContent.trim() === find.text) &&
          (find.visible !== true || shown(node)),
      );
    const element = candidates[0];
    if (element === undefined || (find.first !== true && candidates.length > 1)) {
      throw new Error(`Expected one ${find.selector}, found ${candidates.length}.`);
    }

    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('Expected a 2D canvas for normalizing CSS colors.');
    }

    /**
     * Paints the probe pixel in a CSS color, over what is already there.
     */
    const paint = (color: string): void => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    };
    /**
     * The relative luminance of the probe pixel.
     */
    const luminance = (): number => {
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };

    const maxChannelValue = 255;
    /**
     * Converts an 8-bit sRGB channel to linear light.
     */
    function linear(channel: number): number {
      const srgb = channel / maxChannelValue;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    }

    const layers = [];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      layers.push(getComputedStyle(parent).backgroundColor);
    }

    paint('white');
    const backgroundLayers = layers.toReversed();
    backgroundLayers.forEach(paint);
    const background = luminance();
    paint(style.color);
    const foreground = luminance();
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  }, target);
  expect(contrast >= MINIMUM_TEXT_CONTRAST, `${label} has a contrast ratio of ${contrast}`).toBe(
    true,
  );
}
