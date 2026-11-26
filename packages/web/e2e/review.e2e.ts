import type { Browser } from '@e2e-dev/web';

import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from './support/fixtures.ts';
import {
  emulatePrint,
  hold,
  inNewTab,
  recordRequests,
  shownRows,
  trackNetwork,
  until,
} from './support/page.ts';

/**
 * The search palette's dialog, as a selector for the parts of it that have no role.
 */
const PALETTE = 'role=dialog[name="Search the roadmap"]';

/**
 * Counts the Items rows the filters leave visible.
 */
async function visibleRows(browser: Browser): Promise<number> {
  return browser.locator('#browse [data-filter-entry]:visible').count();
}

/**
 * Reloads the page and waits until its network is idle (Playwright's `reload({ waitUntil:
 * 'networkidle' })`; the engine's `reload` waits for `load` only), by opening the current URL
 * again.
 */
async function reloadIdle(browser: Browser): Promise<void> {
  await browser.goto(await browser.url(), { waitUntil: 'networkidle' });
}

describe('review regressions', () => {
  test('puts the item table back when the type or the search text is cleared', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/?type=release', { waitUntil: 'networkidle' });
    await browser.locator('[data-inline-results]').waitFor();
    await screen.getByRole('button', { name: 'Clear', exact: true }).click();
    await browser.locator('[data-inline-results]').waitFor({ state: 'hidden' });
    expect(await visibleRows(browser)).toBe(5);

    const fresh = await browser.newTab();
    await browser.goto(roadmapSite.url + 'items/', { waitUntil: 'networkidle' });
    const network = await trackNetwork(browser);
    const index = await hold(browser, '**/search-index.json');
    const field = screen.getByRole('searchbox');
    await field.fill('PLAT-88');
    await index.requested;
    await field.fill('');
    index.release();
    // Wait for the held index to arrive and the page to settle, so a stale search could land.
    await network.idle();
    expect(await visibleRows(browser)).toBe(5);
    await fresh.close();
  });

  test('keeps the Items search in the URL when the palette closes untouched', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/?q=PLAT-88', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    await screen.getByRole('dialog', { name: 'Search the roadmap', exact: false }).waitFor();
    await browser.keyboard.press('Escape');
    expect(new URL(await browser.url()).searchParams.get('q')).toBe('PLAT-88');
  });

  test('keeps the narrow timeline on the list and switches to the chart on the first press', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.goto(roadmapSite.url + 'timeline/', { waitUntil: 'networkidle' });
    await browser.locator('[data-timeline]').hover();
    const list = screen.getByRole('radio', { name: 'List', exact: false });
    await until(browser, () => customElements.get('ui-segmented-control') !== undefined, null);
    // Playwright's waitForTimeout: give a late re-render the chance to flip the view.
    await delay(100);
    expect(await list.getAttribute('aria-checked')).toBe('true');
    await screen.getByRole('radio', { name: 'Gantt', exact: false }).click();
    await browser.locator('[data-timeline-chart]').waitFor();
    expect(await browser.locator('#dated-list').isVisible()).toBe(false);
  });

  test('never lets the header links run into the search button', async ({
    browser,
    roadmapSite,
  }) => {
    for (let width = 900; width <= 1440; width += 20) {
      await browser.setViewport({ width, height: 800 });
      await browser.goto(roadmapSite.url + 'items/');
      const clash = await browser.evaluate(() => {
        const search = document.querySelector('.app-search')?.getBoundingClientRect();
        const links = [...document.querySelectorAll('.app-nav a')].map((link) =>
          link.getBoundingClientRect(),
        );
        return links.some(
          (link) =>
            search !== undefined &&
            link.width > 0 &&
            link.right > search.left &&
            link.left < search.right,
        );
      });
      expect(clash, `links overlap the search button at ${width}px`).toBe(false);
    }
  });

  test('shows cleared page filters in the palette when it reopens', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'timeline/', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await browser.locator(`${PALETTE} >> summary`).click();
    const status = dialog.getByRole('combobox', { name: 'Status', exact: true });
    await status.selectOption({ value: 'done' });
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await screen.getByRole('button', { name: 'Clear', exact: true }).first().click();
    expect(new URL(await browser.url()).searchParams.get('status')).toBeNull();
    await browser.locator('[data-search-open]').click();
    await dialog.waitFor();
    expect(await status.inputValue()).toBe('');
  });

  test('reopens a home-page palette search from its URL instead of forwarding it', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url, { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    await browser.keyboard.type('Noor Patel');
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await dialog.getByRole('option', { name: /Noor Patel/ }).waitFor();
    await inNewTab(
      browser,
      await browser.url(),
      async () => {
        expect(new URL(await browser.url()).pathname).toBe('/roadmap/');
        await screen
          .getByRole('dialog', { name: 'Search the roadmap', exact: false })
          .getByRole('option', { name: /Noor Patel/ })
          .waitFor();
      },
      'networkidle',
    );
  });

  test('keeps every type value between the Items chip and the palette', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/?type=item', { waitUntil: 'networkidle' });
    expect(await browser.locator('[data-filter="type"]').textContent()).toMatch(/Items/);
    expect(await browser.locator('[data-filter="type"]').textContent()).not.toMatch(/no matching/);
    await browser.goto(roadmapSite.url + 'items/?type=all&q=setup', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await browser.locator(`${PALETTE} >> summary`).click();
    await dialog
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption({ value: 'planned' });
    expect(new URL(await browser.url()).searchParams.get('type')).toBe('all');
  });

  test('opens a chip on the first press while its code is still loading', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'timeline/', { waitUntil: 'networkidle' });
    await pressWhileHeld(browser, '[data-setting="zoom"] .chip-trigger');
    await screen.getByRole('option', { name: 'Quarters', exact: false }).waitFor();

    await browser.unrouteAll();
    await browser.goto(roadmapSite.url + 'items/', { waitUntil: 'networkidle' });
    await pressWhileHeld(browser, '[data-filter="status"] .chip-trigger');
    await screen.getByRole('option', { name: 'In progress', exact: false }).waitFor();
  });

  test('labels the playback button for the animation state of the slide in view', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/item-starter-templates/');
    await screen.getByRole('link', { name: 'The workspace setup checklist', exact: true }).click();
    const dialog = screen.getByRole('dialog', { name: 'Item image gallery', exact: false });
    await dialog.getByRole('button', { name: 'Next image', exact: false }).click();
    await dialog.getByRole('button', { name: 'Play animation', exact: false }).click();
    await dialog.getByRole('button', { name: 'Previous image', exact: false }).click();
    await dialog.getByRole('button', { name: 'Next image', exact: false }).click();
    await dialog.getByRole('button', { name: 'Pause animation', exact: false }).waitFor();
  });

  test('prints a selected timeline without its close button', async ({ browser, roadmapSite }) => {
    await browser.setViewport({ width: 1280, height: 900 });
    await browser.goto(roadmapSite.url + 'timeline/?selected=item-guided-setup', {
      waitUntil: 'networkidle',
    });
    await emulatePrint(browser);
    expect(await browser.locator('[data-clear-selection]:visible').count()).toBe(0);
  });

  test('reloads once when a republish removed the palette chunk, then explains', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    const loaded = await recordRequests(browser);
    await browser.goto(roadmapSite.url, { waitUntil: 'networkidle' });
    const initial = new Set(loaded);
    // Chunks the page has not loaded yet are "gone", as after a republish with new hashes.
    let missing = true;
    await browser.route('**/assets/client/chunk-*.js', async (route) => {
      if (missing && !initial.has(route.request.url)) {
        await route.fulfill({ status: 404, body: '' });
      } else {
        await route.fallback();
      }
    });
    // Playwright's waitForEvent('load'): a marker on this document's window is gone, and the next
    // document has loaded, once the press made the page reload itself.
    await browser.evaluate(() => {
      Reflect.set(window, '__beforeReload', true);
      return null;
    });
    await browser.locator('[data-search-open]').click();
    await expect
      .poll(
        async () =>
          browser.evaluate(
            () => !Reflect.has(window, '__beforeReload') && document.readyState === 'complete',
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await browser.locator('[data-search-open]').click();
    await screen
      .getByRole('alert')
      .getByText(/out of date/)
      .waitFor();

    missing = false;
    await reloadIdle(browser);
    await browser.locator('[data-search-open]').click();
    await screen.getByRole('dialog', { name: 'Search the roadmap', exact: false }).waitFor();
  });

  test('keeps palette and Items searches apart on the Items page', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/?q=PLAT-88', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await browser.keyboard.type('Noor Patel');
    await dialog.getByRole('option', { name: /Noor Patel/ }).waitFor();
    await inNewTab(
      browser,
      await browser.url(),
      async () => {
        await screen
          .getByRole('dialog', { name: 'Search the roadmap', exact: false })
          .getByRole('option', { name: /Noor Patel/ })
          .waitFor();
      },
      'networkidle',
    );
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const url = new URL(await browser.url());
    expect(url.searchParams.get('q')).toBe('PLAT-88');
    expect(url.searchParams.get('search')).toBeNull();
    await shownRows(browser, 2);
  });

  test('lists Items search matches in rank order and restores the catalogue order', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    /**
     * Visible item titles in DOM order.
     */
    const titles = async (): Promise<Array<string>> =>
      browser
        .locator('#browse [data-filter-entry]:visible .catalogue-item-title > a')
        .allTextContents();
    await browser.goto(roadmapSite.url + 'items/?q=setup', { waitUntil: 'networkidle' });
    await shownRows(browser, 4);
    // Within Customer onboarding, the title match outranks a body match.
    expect(await titles()).toEqual([
      'Guided workspace setup',
      'Connection recovery',
      'Starter templates',
      'Setup completion events',
    ]);
    await screen.getByRole('searchbox').fill('PLAT');
    await until(
      browser,
      (expected) =>
        document.querySelector('#browse [data-filter-entry]:not([hidden]) a')?.textContent ===
        expected,
      'Guided workspace setup',
    );
    const plat = await titles();
    expect(plat.includes('Upcoming invoice preview'), plat.join(' | ')).toBe(true);
    expect(plat.at(-1)).toBe('Upcoming invoice preview');
    await screen.getByRole('searchbox').fill('');
    await shownRows(browser, 5);
    expect(await titles()).toEqual([
      'Upcoming invoice preview',
      'Connection recovery',
      'Guided workspace setup',
      'Starter templates',
      'Setup completion events',
    ]);
  });

  test('reloads the page at most once when a lazy chunk stays missing', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    const page = roadmapSite.url + 'items/?type=person&search=filters';
    const network = await trackNetwork(browser);
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    // The Items search chunk is gone; the palette's chunks still load.
    await browser.route('**/assets/client/chunk-*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('data-search-results')) {
        await route.fallback();
        return;
      }

      // Fail only after the palette has loaded (and cleared its own reload marker).
      await dialog.waitFor();
      await route.fulfill({ status: 404, body: '' });
    });
    await browser.goto(page);
    await screen
      .getByRole('alert')
      .getByText(/out of date/)
      .waitFor();
    await network.idle();
    // Every document load is a request for the page itself: the first load and any reload.
    const documents = network.requests.filter((url) => url === page).length;
    expect(documents <= 2, `${documents} document loads`).toBe(true);
  });

  test('forwards old home fragments after in-page navigation and survives bad fragments', async ({
    browser,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url, { waitUntil: 'networkidle' });
    await browser.evaluate(() => {
      location.hash = '#queue-set-set-onboarding';
      return null;
    });
    await browser.waitForURL(/\/items\/#queue-set-set-onboarding$/);
    await browser.goto(roadmapSite.url + 'items/#50%', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').waitFor();
    await browser.goto(roadmapSite.url + '#50%', { waitUntil: 'networkidle' });
    expect(new URL(await browser.url()).pathname).toBe('/roadmap/');
    await browser.locator('[data-search-open]').waitFor();
  });

  test('hands an old home search with search=1 to the Items search, not the palette', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    const network = await trackNetwork(browser);
    await browser.goto(roadmapSite.url + '?q=PLAT-88&search=1#browse');
    await browser.waitForURL(/\/items\/\?q=PLAT-88#browse$/);
    await network.idle();
    expect(await screen.getByRole('searchbox').inputValue()).toBe('PLAT-88');
    expect(
      await screen.getByRole('dialog', { name: 'Search the roadmap', exact: false }).count(),
    ).toBe(0);
  });

  test('shares palette filters without taking the Items query and tracks the disclosure', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'items/?q=PLAT-88', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await browser.locator(`${PALETTE} >> summary`).click();
    await dialog
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ value: 'person' });
    const message = browser.locator(`${PALETTE} >> [data-message]`);
    await message.getByText(/result/).waitFor();
    const shown = (await message.textContent()) ?? '';
    await inNewTab(
      browser,
      await browser.url(),
      async () => {
        await browser
          .locator(`${PALETTE} >> [data-message]`)
          .getByText(shown, { exact: false })
          .waitFor();
      },
      'networkidle',
    );
    await browser.locator(`${PALETTE} >> summary`).click();
    await expect
      .poll(async () => new URL(await browser.url()).searchParams.get('search'), {
        timeout: 30_000,
      })
      .toBe('palette');
    expect(new URL(await browser.url()).searchParams.get('q')).toBe('PLAT-88');
  });

  test('leaves no palette state behind on pages that do not read it', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'sets/?q=spring', { waitUntil: 'networkidle' });
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await dialog.waitFor();
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(new URL(await browser.url()).search).toBe('');
    await reloadIdle(browser);
    expect(await dialog.count()).toBe(0);

    await browser.goto(roadmapSite.url, { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    await browser.locator(`${PALETTE} >> summary`).click();
    await dialog
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ value: 'release' });
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(new URL(await browser.url()).search).toBe('');
    await reloadIdle(browser);
    expect(new URL(await browser.url()).pathname).toBe('/roadmap/');

    await browser.goto(roadmapSite.url + 'items/?q=PLAT-88', { waitUntil: 'networkidle' });
    await browser.locator('[data-search-open]').click();
    await browser.keyboard.type('spring');
    await dialog.getByRole('button', { name: 'Close search', exact: false }).focus();
    await browser.keyboard.press('ControlOrMeta+k');
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(new URL(await browser.url()).searchParams.get('q')).toBe('PLAT-88');
  });
});

/**
 * How long hovering a chip may take to request its lazily loaded code, in milliseconds.
 */
const CHUNK_REQUEST_MS = 10_000;

/**
 * Whether the UI SDK select is defined, which only the held chunks can do.
 *
 * @param browser Browser showing the page.
 * @returns True once `ui-select` is a defined custom element.
 */
async function upgraded(browser: Browser): Promise<boolean> {
  return browser.evaluate(() => customElements.get('ui-select') !== undefined);
}

/**
 * Presses a chip while its lazily loaded code is held: hovering requests the chunks, the test waits
 * until a chunk is actually held and the select is still the plain markup, presses, checks the
 * press could not have been handled by upgraded code yet, then lets the chunks through.
 *
 * @param browser Browser showing the page.
 * @param selector The chip trigger to press.
 */
async function pressWhileHeld(browser: Browser, selector: string): Promise<void> {
  const chunks = await hold(browser, '**/assets/client/chunk-*.js');
  const trigger = browser.locator(selector);
  await trigger.hover();
  await Promise.race([
    chunks.requested,
    delay(CHUNK_REQUEST_MS).then(() => {
      throw new Error(`Hovering ${selector} requested no chunk within ${CHUNK_REQUEST_MS} ms.`);
    }),
  ]);
  expect(await upgraded(browser), 'the select upgraded before its chunk was released').toBe(false);
  await trigger.click();
  expect(await upgraded(browser), 'the select upgraded before its chunk was released').toBe(false);
  expect(await browser.locator('[role="option"]:visible').count()).toBe(0);
  chunks.release();
}
