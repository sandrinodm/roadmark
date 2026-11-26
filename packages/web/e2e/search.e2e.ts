import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';

import { chipTrigger, choose } from './support/filter-chips.ts';
import { test } from './support/fixtures.ts';
import { inNewTab, recordRequests, shownRows, until } from './support/page.ts';

/**
 * The search index every page fetches when search first needs it.
 */
const INDEX = '**/search-index.json';

/**
 * An item page, where the palette opens on top of a page with no list of its own.
 */
const ITEM_PAGE = 'items/item-guided-setup/';

/**
 * A Korean term that appears nowhere in Atlas until the test writes it into one record's body.
 */
const KOREAN_TERM = '고유한검증문구';

/**
 * The sentence holding {@link KOREAN_TERM}, which a snippet must never quote.
 */
const KOREAN_CONTEXT = `업데이트에 포함된 ${KOREAN_TERM}입니다.`;

/**
 * The search palette's dialog, as a selector for the parts of it that have no role.
 */
const PALETTE = 'role=dialog[name="Search the roadmap"]';

describe('roadmap search', () => {
  test('opens lazy filters on an item page and restores a shared filtered search', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    const fetched = await recordRequests(browser);
    await browser.goto(roadmapSite.url + ITEM_PAGE);
    await browser.locator('[data-search-open]').waitFor();
    await browser.keyboard.press('/');
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    await dialog.getByRole('combobox', { name: 'Search the roadmap', exact: false }).waitFor();
    expect(fetched.some((url) => url.endsWith('search-index.json'))).toBe(false);

    await browser.locator(`${PALETTE} >> summary`).click();
    await dialog
      .getByRole('combobox', { name: 'Type', exact: true })
      .selectOption({ value: 'item' });
    await dialog
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption({ value: 'in-progress' });
    await dialog
      .getByRole('combobox', { name: 'Team', exact: true })
      .selectOption({ value: 'platform' });
    const match = dialog.getByRole('option', { name: /Guided workspace setup/ });
    await match.waitFor();
    expect(await match.getAttribute('href')).toBe('/roadmap/items/item-guided-setup/');
    expect(await browser.locator(`${PALETTE} >> summary`).textContent()).toMatch(/3 active/);
    expect(fetched.some((url) => url.endsWith('search-index.json'))).toBe(true);

    await inNewTab(browser, await browser.url(), async () => {
      const sharedDialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
      await sharedDialog.getByRole('option', { name: /Guided workspace setup/ }).waitFor();
      expect(
        await sharedDialog.getByRole('combobox', { name: 'Status', exact: true }).inputValue(),
      ).toBe('in-progress');
      await sharedDialog
        .getByRole('combobox', { name: 'Status', exact: true })
        .selectOption({ value: 'proposed' });
      await sharedDialog.getByText('No results.', { exact: false }).waitFor();
    });
  });

  test('opens on a shifted slash, forgets closed searches and refreshes the page it filters', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + 'timeline/');
    await browser.locator('[data-search-open]').waitFor();
    const count = browser.locator('[data-filter-count]');
    const initial = await count.textContent();
    // German QWERTZ types "/" as Shift+7.
    await browser.evaluate(() => {
      const init = { key: '/', code: 'Digit7', shiftKey: true, bubbles: true, cancelable: true };
      document.body.dispatchEvent(new KeyboardEvent('keydown', init));
      return null;
    });
    const dialog = screen.getByRole('dialog', { name: 'Search the roadmap', exact: false });
    const input = dialog.getByRole('combobox', { name: 'Search the roadmap', exact: false });
    await input.waitFor();
    await input.fill('PLAT');
    await dialog.getByRole('option').first().waitFor();
    const titles = await dialog.getByRole('option').allTextContents();
    const team = titles.findIndex((text) => text.includes('Platform Engineering'));
    const invoice = titles.findIndex((text) => text.includes('Upcoming invoice preview'));
    expect(team >= 0 && (invoice === -1 || team < invoice), titles.join(' | ')).toBe(true);

    await browser.locator(`${PALETTE} >> summary`).click();
    await dialog
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption({ value: 'done' });
    await browser.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(new URL(await browser.url()).searchParams.get('status')).toBe('done');
    expect(new URL(await browser.url()).searchParams.get('q')).toBeNull();
    await until(
      browser,
      (previous) => document.querySelector('[data-filter-count]')?.textContent !== previous,
      initial,
    );
    expect(await count.textContent()).not.toBe(initial);

    await browser.locator('[data-search-open]').click();
    await input.waitFor();
    expect(await input.inputValue()).toBe('');
  });

  test('forwards Items links from when Items was the home page to the Items page', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.goto(roadmapSite.url + '?q=PLAT-88#browse');
    await browser.waitForURL(/\/items\/\?q=PLAT-88#browse$/);
    await shownRows(browser, 2);
    await browser.goto(roadmapSite.url + '?release=rel-spring&team=platform');
    await browser.waitForURL(/\/items\/\?release=rel-spring&team=platform$/);
    await browser.goto(roadmapSite.url);
    await screen.getByRole('heading', { name: 'Releases', exact: false, level: 1 }).waitFor();
    expect(new URL(await browser.url()).pathname).toBe('/roadmap/');
  });

  test('finds a brief by its resource label or URL and exposes the authored destination', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    for (const [query, title, label, url] of [
      [
        'Accessible forms tutorial',
        'Guided workspace setup',
        'Accessible forms tutorial',
        'https://www.w3.org/WAI/tutorials/forms/',
      ],
      [
        'github.com/github/docs',
        'Customer onboarding',
        'GitHub documentation repository',
        'https://github.com/github/docs',
      ],
    ] as const) {
      await browser.goto(roadmapSite.url + '?' + new URLSearchParams({ q: query, type: 'all' }));
      await browser
        .locator('[data-inline-results]')
        .getByRole('link', { name: new RegExp(title) })
        .click();
      const links = screen.getByRole('region', { name: 'Links', exact: true });
      expect(
        await links.getByRole('link', { name: label, exact: false }).getAttribute('href'),
      ).toBe(url);
    }
  });

  test('narrows a mobile lookup by record type and restores the shared search', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.goto(roadmapSite.url + 'items/');
    await screen.getByRole('searchbox').fill('PLAT-88');
    const rows = browser.locator('#browse [data-filter-entry]:visible');
    await shownRows(browser, 2);
    const groups = browser.locator('#browse [data-filter-group]:visible');
    expect(await groups.getByRole('heading').allTextContents()).toEqual([
      'Customer onboarding',
      'Event infrastructure',
    ]);
    await choose({ screen, browser }, 'Type', 'Releases');
    const results = browser.locator('[data-inline-results]');
    await results.getByText(/No results/).waitFor();
    await browser.reload();
    expect(await (await chipTrigger(browser, 'Type')).textContent()).toMatch(/Releases/);
    expect(await screen.getByRole('searchbox').inputValue()).toBe('PLAT-88');
    await results.getByText(/No results/).waitFor();
    await browser.back();
    await rows.getByRole('link', { name: 'Guided workspace setup', exact: false }).click();
    await screen.getByRole('heading', { name: 'Guided workspace setup', exact: true }).waitFor();
  });

  test('finds a record by decomposed Korean body text and quotes its outcome', async ({
    browser,
    screen,
    roadmapSite,
  }) => {
    await browser.route(INDEX, async (route) => {
      const response = await route.fetch();
      const index: unknown = await response.json();
      if (!Array.isArray(index)) {
        throw new TypeError('Expected the search index to be an array.');
      }

      const item: unknown = index.find(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          'id' in entry &&
          entry.id === 'item-guided-setup',
      );
      if (typeof item !== 'object' || item === null) {
        throw new Error('Expected item-guided-setup in the search index.');
      }

      Reflect.set(
        item,
        'text',
        '워킹 그룹은 초안을 검토하고 합의합니다. '.repeat(30) + KOREAN_CONTEXT,
      );
      await route.fulfill({ status: response.status, json: index });
    });

    // The index holds the composed (NFC) syllables; the reader types decomposed (NFD) jamo, as
    // macOS input and pasted text can, so only normalization makes the two match.
    const decomposed = KOREAN_TERM.normalize('NFD');
    expect(decomposed === KOREAN_TERM).toBe(false);
    expect(KOREAN_CONTEXT === KOREAN_CONTEXT.normalize('NFC')).toBe(true);
    const query = new URLSearchParams({ q: decomposed });
    await browser.goto(`${roadmapSite.url}${ITEM_PAGE}?${query}`);
    const result = screen
      .getByRole('dialog', { name: 'Search the roadmap', exact: false })
      .getByRole('option', { name: /Guided workspace setup/ });
    await result.waitFor();
    // Snippets quote the outcome only; a body match ranks the record but is never quoted.
    const text = (await result.textContent()) ?? '';
    expect(text.includes(KOREAN_CONTEXT)).toBe(false);
    expect(text).toMatch(/Administrators can finish setup without contacting support/);
  });
});
