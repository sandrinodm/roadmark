import type { Browser } from '@e2e-dev/web';
import type { Screen } from 'e2e';

import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { axeViolations, loadAxe } from './support/axe.ts';
import { test } from './support/fixtures.ts';
import { expectFocusedNow, nextFrames, trackNetwork } from './support/page.ts';
import { ATLAS_SITE_DIRECTORY } from './support/sites.ts';

/**
 * Every route an earlier release published, one per line; none may disappear.
 */
const inventory = new URL('fixtures/url-inventory.txt', import.meta.url);

/**
 * The favicon service resource links use, the one third-party origin a page may ask for.
 */
const FAVICON_SERVICE = 'https://www.google.com/s2/favicons';

/**
 * Most gzipped JavaScript a page may load before the reader does anything.
 */
const FIRST_LOAD_BUDGET = 30 * 1024;

/**
 * Most gzipped JavaScript a page may load with search and every control open.
 */
const PALETTE_BUDGET = 110 * 1024;

/**
 * A phone-sized viewport no page may scroll sideways in.
 */
const NARROW = {
  /**
   * A phone's CSS width.
   */
  width: 390,

  /**
   * A phone's CSS height.
   */
  height: 844,
} as const;

/**
 * Records the JavaScript a page loads and any request that leaves the preview server.
 */
type Traffic = {
  /**
   * Every script URL the page requested from the preview server, once each.
   */
  scripts: Set<string>;

  /**
   * URLs requested from origins other than the preview server and the documented favicon service.
   */
  foreign: Array<string>;

  /**
   * Favicon service URLs the page asked for, each aborted before it reached the network.
   */
  aborted: Array<string>;

  /**
   * Every URL the network tracker fetched for real, in order.
   */
  fetched: Array<string>;

  /**
   * Waits until no request has been in flight for 500 ms.
   */
  idle: () => Promise<void>;
};

/**
 * Starts recording a page's scripts and third-party requests. The web engine has no request or
 * response events, so a route sees every request and hands it on: the favicon service is aborted,
 * and everything else is fetched and fulfilled unchanged. Routes run newest first, and the network
 * tracker fulfils every request it sees without falling back, so it is registered first (runs last)
 * and the favicon abort after it: an aborted favicon never reaches the tracker's fetch. A script is
 * a request for a `.js` file on the preview server: the engine's routes carry no resource type, and
 * the site loads all of its code as `.js` modules from `assets/client/`.
 */
async function watch(browser: Browser, origin: string): Promise<Traffic> {
  const network = await trackNetwork(browser);
  const aborted: Array<string> = [];
  await browser.route(FAVICON_SERVICE + '**', async (route) => {
    aborted.push(route.request.url);
    await route.abort();
  });
  const traffic: Traffic = {
    scripts: new Set(),
    foreign: [],
    aborted,
    fetched: network.requests,
    idle: network.idle,
  };
  await browser.route('**/*', async (route) => {
    const url = route.request.url;
    const local = url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:');
    if (!local && !url.startsWith(FAVICON_SERVICE)) {
      traffic.foreign.push(url);
    }

    if (url.startsWith(origin) && new URL(url).pathname.endsWith('.js')) {
      traffic.scripts.add(url);
    }

    await route.fallback();
  });
  return traffic;
}

/**
 * Sums the gzipped size of every script a page loaded: each recorded script is fetched again from
 * the preview server, which serves the same static file, and gzipped at level 9.
 */
async function scriptBytes(traffic: Traffic): Promise<number> {
  const sizes = await Promise.all(
    [...traffic.scripts].map(async (url) => {
      const response = await fetch(url);
      expect(response.status, url).toBe(200);
      return gzipSync(Buffer.from(await response.arrayBuffer()), { level: 9 }).length;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

/**
 * Lists every built HTML route relative to the site root.
 */
async function htmlRoutes(output: string): Promise<Array<string>> {
  const files = await readdir(output, { recursive: true });
  return files
    .filter((file) => file.endsWith('index.html') && !file.startsWith('.'))
    .map((file) => file.split(path.sep).join('/'))
    .toSorted();
}

/**
 * Runs axe with the WCAG 2.1 A and AA rules and returns the violations by rule and element.
 */
async function violations(browser: Browser): Promise<Array<{ rule: string; elements: unknown }>> {
  // Measure contrast at rest: an opening palette fades in, and a half-faded option fails contrast.
  await browser.evaluate(async () => {
    await Promise.all(document.getAnimations().map(async ({ finished }) => finished));
    return null;
  });
  const report = await axeViolations(browser);
  return report.map((finding) => ({ rule: finding.id, elements: finding.targets }));
}

describe('every published route', () => {
  test('keeps every baseline URL', async () => {
    const routes = await htmlRoutes(ATLAS_SITE_DIRECTORY);
    const baseline = (await readFile(inventory, 'utf8')).split('\n').filter(Boolean);
    const missing = baseline.filter((route) => !routes.includes(route));
    expect(missing).toEqual([]);
  });

  test('forwards an old home feature-set fragment to the Items page', async ({
    browser,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + '#queue-set-set-onboarding');
    await browser.waitForURL(/\/product\/roadmap\/items\/#queue-set-set-onboarding$/);
    expect(await browser.locator('#queue-set-set-onboarding').isVisible()).toBe(true);
    await browser.goto(atlasSite.url + '#home-now');
    expect(new URL(await browser.url()).pathname).toBe('/product/roadmap/');
  });

  test('passes axe, stays local, fits 390px and loads at most 30 KB of JavaScript', async ({
    browser,
    atlasSite,
  }) => {
    const routes = await htmlRoutes(ATLAS_SITE_DIRECTORY);
    await loadAxe(browser);
    const origin = new URL(atlasSite.url).origin;
    const favicons: Array<string> = [];
    for (const route of routes) {
      const url = atlasSite.url + route.replace(/index\.html$/, '');
      const traffic = await watch(browser, origin);
      await browser.setViewport({ width: 1280, height: 800 });
      await browser.goto(url, { waitUntil: 'networkidle' });
      expect(await violations(browser), `Accessibility violations on ${route}`).toEqual([]);
      await browser.setViewport(NARROW);
      // Let the timeline's resize observer and media-query listeners re-render first.
      await nextFrames(browser);
      const overflow = await browser.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow <= 0, `${route} scrolls sideways by ${overflow}px at 390px`).toBe(true);
      expect(traffic.foreign, `${route} requested a third-party origin`).toEqual([]);
      expect(
        traffic.fetched.filter((fetched) => fetched.startsWith(FAVICON_SERVICE)),
        `${route} fetched a favicon from the network`,
      ).toEqual([]);
      favicons.push(...traffic.aborted);
      const bytes = await scriptBytes(traffic);
      expect(
        bytes <= FIRST_LOAD_BUDGET,
        `${route} loads ${bytes} bytes of gzipped JavaScript`,
      ).toBe(true);
      await browser.unrouteAll();
    }

    // Resource links show favicons, so the abort must have run: proof that the tracker, which
    // fetches whatever reaches it, never saw a favicon request.
    expect(favicons.length > 0, 'no page asked for a favicon, so the abort went untested').toBe(
      true,
    );
  });

  test('searches from the keyboard alone with a lazy, accessible palette', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await loadAxe(browser);
    const traffic = await watch(browser, new URL(atlasSite.url).origin);
    await browser.goto(atlasSite.url, { waitUntil: 'networkidle' });
    const firstLoad = await scriptBytes(traffic);
    // Boot and the lazy modules share a small chunk; the UI SDK must not load until search opens.
    expect(await browser.evaluate(() => !customElements.get('ui-dialog'))).toBe(true);
    expect(await browser.evaluate(() => !customElements.get('ui-select'))).toBe(true);
    expect(firstLoad <= FIRST_LOAD_BUDGET, `first load is ${firstLoad} bytes`).toBe(true);

    // The boot script reveals the button once its shortcut listener is attached.
    await browser.locator('[data-search-open]').waitFor();
    await browser.keyboard.press('/');
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    const input = dialog.getByRole('combobox', { name: 'Search the roadmap', exact: false });
    await input.waitFor();
    await expectFocusedNow(input);
    expect(await input.inputValue()).toBe('');
    await browser.keyboard.type('PLAT');
    const options = dialog.getByRole('option');
    await options.first().waitFor();
    expect(await options.first().textContent()).toMatch(/Guided workspace setup/);
    expect(await options.nth(1).textContent()).toMatch(/Setup completion events/);
    expect(
      await browser
        .locator('role=dialog[name="Search the roadmap"] >> role=option >> nth=0 >> mark >> nth=0')
        .textContent(),
    ).toBe('PLAT');
    expect(await violations(browser), 'Accessibility violations in the palette').toEqual([]);
    const opened = await scriptBytes(traffic);
    expect(opened <= PALETTE_BUDGET, `palette loads ${opened} bytes of gzipped JavaScript`).toBe(
      true,
    );

    await browser.keyboard.press('ArrowDown');
    expect(await options.nth(1).getAttribute('aria-selected')).toBe('true');
    await browser.keyboard.press('Enter');
    await screen
      .getByRole('heading', { name: 'Setup completion events', exact: false, level: 1 })
      .waitFor();
    await browser.locator('[data-search-open]').waitFor();

    await browser.keyboard.press('ControlOrMeta+k');
    await input.waitFor();
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(new URL(await browser.url()).search).toBe('');
    expect(traffic.foreign).toEqual([]);
  });

  test('keeps upgraded chips, timeline controls and the gallery accessible and within budget', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await loadAxe(browser);
    const origin = new URL(atlasSite.url).origin;
    const totals: Array<string> = [];
    for (const [route, open] of [
      ['items/', openChipFromKeyboard],
      ['timeline/', showTimelineTooltip],
      ['items/item-starter-templates/', openGallery],
    ] as const) {
      const traffic = await watch(browser, origin);
      await browser.goto(atlasSite.url + route, { waitUntil: 'networkidle' });
      await open(browser, screen);
      expect(await violations(browser), `Accessibility violations on ${route} open`).toEqual([]);
      await browser.keyboard.press('Escape');
      await browser.keyboard.press('ControlOrMeta+k');
      await screen.getByRole('dialog', { name: 'Search the roadmap', exact: false }).waitFor();
      await traffic.idle();
      const bytes = await scriptBytes(traffic);
      totals.push(`${route}: ${bytes}`);
      expect(bytes <= PALETTE_BUDGET, `${route} loads ${bytes} bytes with everything open`).toBe(
        true,
      );
      await browser.unrouteAll();
    }

    // node:test's t.diagnostic: the runner keeps a test's output with its result.
    process.stdout.write(`Gzipped JavaScript with every control open: ${totals.join(', ')}\n`);
  });
});

/**
 * Tabs to the Status chip, opens it and picks an option with the keyboard alone.
 */
async function openChipFromKeyboard(browser: Browser, screen: Screen): Promise<void> {
  const chip = screen.getByRole('button', { name: /^Status/ });
  await chip.focus();
  const trigger = screen.getByRole('combobox', { name: 'Status', exact: true });
  await trigger.waitFor();
  await trigger.focus();
  await browser.keyboard.press('ArrowDown');
  const option = screen.getByRole('option', { name: 'In progress', exact: true });
  await option.waitFor();
  expect(await violations(browser), 'Accessibility violations with a chip open').toEqual([]);
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('Enter');
  await browser.waitForURL(/status=in-progress/);
  await trigger.focus();
  await browser.keyboard.press('Enter');
  await option.waitFor();
}

/**
 * Upgrades the timeline controls and points at a bar to show its tooltip.
 */
async function showTimelineTooltip(browser: Browser, screen: Screen): Promise<void> {
  await browser.locator('[data-timeline]').hover();
  await screen.getByRole('radio', { name: 'List', exact: false }).waitFor();
  await browser.locator('[data-mark="item-guided-setup"]').hover();
  await screen.getByRole('tooltip').waitFor();
}

/**
 * Opens the item's image gallery.
 */
async function openGallery(browser: Browser, screen: Screen): Promise<void> {
  await browser.locator('[data-item-gallery] figure img').first().click();
  await screen.getByRole('dialog', { name: 'Item image gallery', exact: false }).waitFor();
}
