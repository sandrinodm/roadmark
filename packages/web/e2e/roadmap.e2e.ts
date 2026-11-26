import { describe } from '@e2e-dev/web';
import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import { expect } from 'e2e';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { axeViolations, loadAxe } from './support/axe.ts';
import { chipTrigger, choose } from './support/filter-chips.ts';
import { test } from './support/fixtures.ts';
import {
  blockScripts,
  emulatePrint,
  expectFocusedNow,
  freezeTime,
  inNewTab,
  recordRequests,
  settled,
  shownRows,
} from './support/page.ts';

/**
 * The Atlas workspace, for the files a test serves in place of a third-party response.
 */
const root = ATLAS_DIRECTORY;

describe('the published reader experience', () => {
  test('renders resource favicons and falls back to the globe without JavaScript', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await blockScripts(browser);
    // A RegExp, since `?` in a route glob is a wildcard.
    const iconUrl = /^https:\/\/www\.google\.com\/s2\/favicons\?domain=github\.com&sz=32$/;
    const url = atlasSite.url + 'sets/set-onboarding/';
    // The link the role query finds, by CSS, for the reads that run in the page.
    const resource = 'a.resource-link[href="https://github.com/github/docs"]';
    const portrait = await readFile(path.join(root, 'avatars/maya.png'));
    await browser.route(iconUrl, async (route) => {
      expect(route.request.headers['referer']).toBeUndefined();
      await route.fulfill({ body: portrait, contentType: 'image/png' });
    });
    await browser.goto(url);
    const link = screen.getByRole('link', { name: /GitHub documentation repository/ });
    await link.scrollIntoView();
    expect(await link.getAttribute('href')).toBe('https://github.com/github/docs');
    const size = await browser.evaluate(async (selector: string) => {
      const nodes = document.querySelectorAll(selector);
      const node = nodes[0];
      if (nodes.length !== 1 || !(node instanceof HTMLImageElement)) {
        throw new Error('Expected a favicon image.');
      }

      await node.decode();
      return node.getBoundingClientRect().width;
    }, `${resource} img`);
    expect(size > 0 && size <= 24).toBe(true);
    const initialTile = await browser.locator(`${resource} .resource-icon`).boundingBox();

    await browser.unroute(iconUrl);
    await browser.route(iconUrl, async (route) => route.abort());
    await browser.reload();
    await link.scrollIntoView();
    await browser.locator(`${resource} img`).waitFor({ state: 'hidden' });
    expect(await browser.locator(`${resource} svg`).isVisible()).toBe(true);
    expect((await browser.locator(`${resource} .resource-icon`).boundingBox())?.width).toBe(
      initialTile?.width,
    );
    expect(await link.getAttribute('href')).toBe('https://github.com/github/docs');
  });

  test('finds both records for a Jira issue and shares a filtered view', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    const requests = await recordRequests(browser);
    await browser.goto(atlasSite.url + 'items/', { waitUntil: 'networkidle' });
    expect(requests.some((url) => url.endsWith('search-index.json'))).toBe(false);
    await browser.keyboard.press('/');
    await browser.keyboard.type('PLAT-88');
    const rows = browser.locator('#browse [data-filter-entry]:visible');
    await shownRows(browser, 2);
    expect((await rows.getByRole('link').allTextContents()).toSorted()).toEqual([
      'Guided workspace setup',
      'Setup completion events',
    ]);
    expect(requests.some((url) => url.endsWith('search-index.json'))).toBe(true);
    await choose({ screen, browser }, 'Release', 'Spring onboarding launch');
    await choose({ screen, browser }, 'Team', 'Platform Engineering');
    expect(await browser.url()).toMatch(/team=platform/);
    await inNewTab(browser, await browser.url(), async () => {
      const visible = browser.locator('#browse [data-filter-entry]:visible');
      await visible.first().waitFor();
      expect(await visible.count()).toBe(1);
      expect(await visible.textContent()).toMatch(/Guided workspace setup/);
    });
  });

  test('restores search and facet selections from a shared collection URL', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    for (const [route, collection, facet, value, query, title] of [
      ['', 'releases', 'Status', 'Planned', 'billing', 'Summer billing release'],
      ['sets/', 'feature sets', 'Team', 'Growth Engineering', 'onboarding', 'Customer onboarding'],
    ] as const) {
      await browser.goto(atlasSite.url + route);
      const search = `role=group[name="Filter ${collection}"]`;
      const input = browser.locator(search).getByRole('searchbox');
      await choose({ screen, browser }, facet, value, search);
      await input.fill(query);
      await browser.reload();
      const visible = browser.locator('[data-filter-group] [data-filter-entry]:visible');
      await visible.getByRole('link', { name: title, exact: true }).waitFor();
      expect(await visible.count()).toBe(1);
      expect(await input.inputValue()).toBe(query);
      expect(await (await chipTrigger(browser, facet, search)).textContent()).toMatch(
        new RegExp(value),
      );
      await input.fill('no matching record');
      await browser.locator('[data-filter-empty]').waitFor();
      expect(await visible.count()).toBe(0);
    }
  });

  test('hides emptied release banners and counts what each still shows', async ({
    browser,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + '?collection-status=planned', { waitUntil: 'networkidle' });
    const banners = browser.locator('[data-filter-group]:visible .catalogue-group-label');
    await settled(browser, '[data-filter-group]', 1);
    expect(
      (await banners.allTextContents()).map((text) => text.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['Q3 2027 1 release']);
    await browser.goto(atlasSite.url, { waitUntil: 'networkidle' });
    await settled(browser, '[data-filter-group]', 3);
    expect(
      (await banners.allTextContents()).map((text) => text.replaceAll(/\s+/g, ' ').trim()),
    ).toEqual(['Feb 2027 1 release', 'May 2027 1 release', 'Q3 2027 1 release']);
  });

  test('navigates the three collections and finds items in their feature set without JavaScript', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await blockScripts(browser);
    await browser.setViewport({ width: 390, height: 844 });
    await browser.goto(atlasSite.url + 'releases/');
    await browser.waitForURL(atlasSite.url);
    const picker = browser.locator('[data-collection-picker] summary');
    await picker.press('Enter');
    const nav = screen.getByRole('navigation', { name: 'Primary', exact: false });
    const links = nav.getByRole('link');
    expect((await links.allTextContents()).map((text) => text.trim())).toEqual([
      'Releases',
      'Feature sets',
      'Items',
      'Timeline',
      'People',
      'Teams',
    ]);
    expect(
      await nav.getByRole('link', { name: 'Releases', exact: false }).getAttribute('aria-current'),
    ).toBe('page');
    const releasesBox = await links.nth(0).boundingBox();
    const setsBox = await links.nth(1).boundingBox();
    const itemsBox = await links.nth(2).boundingBox();
    if (!releasesBox || !setsBox || !itemsBox) {
      throw new Error('Expected the first three collection links to be laid out.');
    }

    expect(
      releasesBox.y + releasesBox.height <= setsBox.y && setsBox.y + setsBox.height <= itemsBox.y,
    ).toBe(true);
    const main = screen.getByRole('main');
    await main.getByRole('heading', { name: 'Releases', exact: false, level: 1 }).waitFor();
    await main.getByRole('heading', { name: 'May 2027', exact: false, level: 2 }).waitFor();
    await main.getByRole('link', { name: 'Spring onboarding launch', exact: false }).click();
    await main
      .getByRole('heading', { name: 'Spring onboarding launch', exact: false, level: 1 })
      .waitFor();
    await picker.press('Enter');
    expect(
      await nav.getByRole('link', { name: 'Releases', exact: false }).getAttribute('aria-current'),
    ).toBe('page');
    await nav.getByRole('link', { name: 'Feature sets', exact: false }).click();
    await main.getByRole('heading', { name: 'Feature sets', exact: false, level: 1 }).waitFor();
    await main.getByRole('link', { name: 'Customer onboarding', exact: true }).click();
    await main
      .getByRole('heading', { name: 'Customer onboarding', exact: false, level: 1 })
      .waitFor();
    const tabs = main.getByRole('navigation', {
      name: 'Customer onboarding sections',
      exact: false,
    });
    expect(
      await tabs.getByRole('link', { name: 'Overview', exact: false }).getAttribute('aria-current'),
    ).toBe('page');
    await tabs.getByRole('link', { name: 'Items', exact: false }).click();
    await browser.waitForURL(/\/sets\/set-onboarding\/items\/$/);
    expect(
      await tabs.getByRole('link', { name: 'Items', exact: false }).getAttribute('aria-current'),
    ).toBe('page');
    await main.getByRole('link', { name: 'Guided workspace setup', exact: true }).waitFor();
    await picker.press('Enter');
    await nav.getByRole('link', { name: 'Items', exact: true }).click();
    await main.getByRole('heading', { name: 'Items', exact: false, level: 1 }).waitFor();
    const onboarding = browser
      .locator('main [data-work-group]')
      .filter({ has: screen.getByRole('heading', { name: 'Customer onboarding', exact: true }) });
    await onboarding.getByRole('link', { name: 'Guided workspace setup', exact: true }).click();
    await main
      .getByRole('heading', { name: 'Guided workspace setup', exact: false, level: 1 })
      .waitFor();
    await picker.press('Enter');
    expect(
      await nav.getByRole('link', { name: 'Items', exact: true }).getAttribute('aria-current'),
    ).toBe('page');
  });

  test('shows dependencies on the Gantt and the contributing team on the team page', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + 'timeline/');
    await browser.locator('[data-mark="item-guided-setup"]').click();
    const panel = browser.locator('[data-selection="item-guided-setup"]');
    await panel.getByRole('link', { name: 'Setup completion events', exact: false }).waitFor();
    expect(await panel.textContent()).toMatch(/checklist reads completion events/);
    const tools = '[data-timeline-tools]';
    await choose({ screen, browser }, 'Zoom', 'Quarters', tools);
    expect(await browser.locator('[data-gantt]').getAttribute('data-zoom')).toBe('quarter');
    await choose({ screen, browser }, 'Group by', 'Engineering team', tools);
    await browser.locator('[data-lane="platform"]').waitFor();
    await screen.getByRole('radio', { name: 'List', exact: true }).click();
    await browser.locator('[data-timeline-list]').waitFor();
    await browser.goto(atlasSite.url + 'teams/platform/');
    const guided = browser
      .locator('#roadmap-items [data-filter-entry="item-guided-setup"]')
      .first();
    expect(await guided.textContent()).toMatch(/Contributing team/);
  });

  test('follows people and teams through the work they share', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await blockScripts(browser);
    await browser.goto(atlasSite.url + 'people/');
    await screen.getByRole('link', { name: 'Noor Patel', exact: true }).click();
    const guided = screen.getByRole('listitem').filter({
      has: screen.getByRole('link', { name: 'Guided workspace setup', exact: true }),
    });
    expect(await guided.textContent()).toMatch(/Contributor/);
    await guided.getByRole('link', { name: 'Guided workspace setup', exact: true }).click();
    await screen.getByRole('link', { name: 'Growth Engineering', exact: true }).first().click();
    await browser.locator('#members').getByRole('link', { name: 'Maya Chen', exact: true }).click();
    await screen.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
    expect(await browser.locator('main').textContent()).toMatch(
      /Product manager \(from feature set\)/,
    );
  });

  test('opens a profile from its photo or initials without JavaScript', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await blockScripts(browser);
    await browser.goto(atlasSite.url + 'items/item-guided-setup/');
    const facts = screen.getByRole('complementary', { name: 'Facts', exact: false });
    const owner = facts.getByRole('link', { name: 'Maya Chen', exact: true });
    // The owner's portrait, found by CSS for the reads that run in the page.
    const photo = '#record-facts a[aria-label="Maya Chen"] img';
    await owner.waitFor();
    expect(await browser.locator(photo).getAttribute('alt')).toBe('');
    expect(
      (await browser.locator(photo).getAttribute('src'))?.startsWith('/product/roadmap/avatars/'),
    ).toBe(true);
    expect(
      await browser.evaluate(async (selector: string) => {
        const nodes = document.querySelectorAll(selector);
        const node = nodes[0];
        if (nodes.length !== 1 || !(node instanceof HTMLImageElement)) {
          throw new Error('Expected a portrait image.');
        }

        await node.decode();
        return node.naturalWidth;
      }, photo),
    ).toBe(128);
    await owner.click();
    await screen.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
    await browser.back();
    const contributor = facts.getByRole('link', { name: 'NP, Noor Patel', exact: true });
    expect(await contributor.textContent()).toBe('NP');
    expect(await contributor.getAttribute('title')).toBe('Noor Patel');
    await contributor.focus();
    await browser.keyboard.press('Enter');
    await screen.getByRole('heading', { name: 'Noor Patel', exact: true }).waitFor();
  });

  test('shares personal filters between the profile and its timeline', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + 'views/');
    await screen.getByRole('link', { name: /Noor Patel/ }).click();
    const form = 'role=group[name="Item filters"]';
    const rows = browser.locator('#roadmap-items [data-filter-entry]:visible');
    /**
     * The record IDs of the rows shown, in order.
     */
    const shownIds = async (): Promise<Array<string | null>> =>
      Promise.all((await rows.all()).map(async (row) => row.getAttribute('data-filter-entry')));
    await choose({ screen, browser }, 'Involvement', 'Contributor', form);
    expect(await shownIds()).toEqual(['item-guided-setup']);
    await choose({ screen, browser }, 'Release', 'Summer billing release', form);
    await screen.getByText('No items match these filters.', { exact: false }).waitFor();
    await browser.back();
    await settled(browser, '#roadmap-items [data-filter-entry]', 1);
    await screen.getByRole('link', { name: 'View personal timeline', exact: false }).click();
    await browser.waitForURL(/\/timeline\//);
    expect(new URL(await browser.url()).searchParams.get('role')).toBe('contributor');
    await screen.getByRole('heading', { name: 'Noor Patel timeline', exact: false }).waitFor();
    const marks = browser.locator('[data-timeline-id]:visible');
    await settled(browser, '[data-timeline-id]', 1);
    expect(await marks.getAttribute('data-timeline-id')).toBe('item-guided-setup');
    await browser.reload();
    await settled(browser, '[data-timeline-id]', 1);
    await screen.getByRole('link', { name: 'View roadmap items', exact: false }).click();
    await settled(browser, '#roadmap-items [data-filter-entry]', 1);
    await browser.locator(form).getByRole('button', { name: 'Clear', exact: true }).click();
    expect(new URL(await browser.url()).search).toBe('');
    expect(await rows.count()).toBe(3);
    expect(await rows.filter({ hasText: 'Starter templates' }).count()).toBe(0);
    await browser.goto(atlasSite.url + 'people/noor/?release=rel-retired');
    await screen.getByText('No items match these filters.', { exact: false }).waitFor();
    expect(await (await chipTrigger(browser, 'Release', form)).textContent()).toMatch(
      /rel-retired \(no matching items\)/,
    );
    await browser.locator(form).getByRole('button', { name: 'Clear', exact: true }).click();
    expect(await rows.count()).toBe(3);
  });

  test('keeps team involvement in scope and links each planning view to its assigned items', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + 'teams/platform/timeline/?role=contributing-team&view=list');
    const rows = browser.locator('[data-timeline-list] [data-filter-entry]:visible');
    await settled(browser, '[data-timeline-list] [data-filter-entry]', 2);
    const ids = await Promise.all(
      (await rows.all()).map(async (row) => (await row.getAttribute('data-filter-entry')) ?? ''),
    );
    expect(ids.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'item-guided-setup',
      'item-invoice-preview',
    ]);
    await screen.getByRole('link', { name: 'View roadmap items', exact: false }).click();
    await settled(browser, '#roadmap-items [data-filter-entry]', 2);
    await choose({ screen, browser }, 'Involvement', 'Owner');
    expect(
      await browser
        .locator('#roadmap-items [data-filter-entry]:visible')
        .getAttribute('data-filter-entry'),
    ).toBe('item-setup-events');

    await browser.goto(atlasSite.url + 'views/scopes/');
    await screen.getByRole('link', { name: 'Customer onboarding', exact: true }).click();
    await browser.waitForURL(/\/sets\/set-onboarding\/items\/$/);
    expect(await browser.locator('main [data-filter-entry]').count()).toBe(3);

    await browser.goto(atlasSite.url + 'views/scopes/');
    await screen.getByRole('link', { name: 'Spring onboarding launch', exact: true }).click();
    await browser.waitForURL(/\/releases\/rel-spring\//);
    const scope = '#roadmap-items';
    expect(await browser.locator(`${scope} [data-filter-entry]`).count()).toBe(2);
    await choose({ screen, browser }, 'Status', 'In progress', scope);
    expect(
      await browser
        .locator(`${scope} [data-filter-entry]:visible`)
        .getAttribute('data-filter-entry'),
    ).toBe('item-guided-setup');
  });

  test('loads the Atlas logo and local Geist type under the deployment prefix', async ({
    browser,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + 'people/noor/', { waitUntil: 'networkidle' });
    const brand = await browser.evaluate(async () => {
      const header = document.querySelector('body > header');
      const logo = header?.querySelector('img');
      const heading = document.querySelector('h1');
      if (!header || !logo || !heading) {
        throw new Error('Missing branded page elements.');
      }

      await logo.decode();
      await document.fonts.ready;
      return {
        background: getComputedStyle(header).backgroundColor,
        image: getComputedStyle(document.body).backgroundImage,
        logo: logo.currentSrc,
        width: logo.naturalWidth,
        display: getComputedStyle(heading).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
        size: getComputedStyle(document.body).fontSize,
        loadedFonts: [...document.fonts].flatMap((font) =>
          font.status === 'loaded' ? [font.family] : [],
        ),
      };
    });
    expect(brand.background).toBe('rgb(255, 255, 255)');
    expect(brand.logo.startsWith(atlasSite.url + 'media/') && brand.width > 0).toBe(true);
    expect(brand.image).toBe('none');
    expect(brand.display).toMatch(/Geist/);
    expect(brand.body).toMatch(/system-ui/);
    expect(Number.parseFloat(brand.size) >= 16).toBe(true);
    expect(brand.loadedFonts.some((family) => family.includes('Geist'))).toBe(true);
  });

  test('opens the selected item image, moves through its gallery and restores focus', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.emulateMedia({ reducedMotion: 'reduce' });
    await browser.goto(atlasSite.url + 'items/item-starter-templates/');
    const opener = screen.getByRole('link', { name: 'The workspace setup checklist', exact: true });
    await opener.click();
    const dialog = screen.getByRole('dialog', { name: 'Item image gallery', exact: false });
    expect(await dialog.textContent()).toMatch(/Image 2 of 3/);
    await dialog.getByRole('button', { name: 'Next image', exact: false }).click();
    expect(await dialog.textContent()).toMatch(/Image 3 of 3/);
    const galleryImage = browser.locator(
      'role=dialog[name="Item image gallery"] >> .gallery-slide[data-current] img',
    );
    expect((await galleryImage.getAttribute('src')) ?? '').toMatch(/-poster\.png$/);
    await dialog.getByRole('button', { name: 'Play animation', exact: false }).click();
    expect((await galleryImage.getAttribute('src')) ?? '').toMatch(/\.gif$/);
    await browser.keyboard.press('ArrowRight');
    expect(await dialog.textContent()).toMatch(/Image 1 of 3/);
    expect((await galleryImage.getAttribute('src')) ?? '').toMatch(/\.svg$/);
    await browser.keyboard.press('ArrowLeft');
    await browser.keyboard.press('Escape');
    expect(await dialog.count()).toBe(0);
    await expectFocusedNow(opener);

    await browser.goto(atlasSite.url + 'items/item-guided-setup/');
    const thumbnail = browser.locator('[data-item-gallery] figure img').first();
    await thumbnail.click();
    expect(await dialog.textContent()).toMatch(/Image 1 of 1/);
    expect(await dialog.getByRole('button', { name: 'Next image', exact: false }).count()).toBe(0);
    await dialog.getByRole('button', { name: 'Close', exact: false }).click();
    expect(await dialog.count()).toBe(0);
  });

  test('reads highlighted MDX and opens its full-size diagram without client JavaScript', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await blockScripts(browser);
    await browser.goto(atlasSite.url + 'items/item-starter-templates/');
    expect(await browser.locator('.roadmap-callout').textContent()).toMatch(
      /Interview 6 workspace administrators/,
    );
    expect(await browser.locator('pre.shiki').textContent()).toMatch(/verify-events/);
    const diagram = screen.getByRole('link', { name: 'Template pilot decision', exact: true });
    await diagram.click();
    await browser.waitForURL(/\/diagrams\//);
    expect((await browser.url()).startsWith(atlasSite.url + 'diagrams/')).toBe(true);
    // An SVG has no rendered text to read (innerText), so read the drawing's text content.
    const drawing = await browser.evaluate(() => {
      const drawings = document.querySelectorAll('svg');
      if (drawings.length !== 1) {
        throw new Error(`Expected one drawing, found ${drawings.length}.`);
      }

      return drawings[0]?.textContent ?? '';
    });
    expect(drawing).toMatch(/Expand the pilot/);
  });

  test('supports narrow screens, reduced motion, captions and keyboard navigation', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 360, height: 800 });
    await browser.emulateMedia({ reducedMotion: 'reduce' });
    await browser.goto(atlasSite.url + 'timeline/', { waitUntil: 'networkidle' });
    expect(await browser.locator('[data-timeline-list]').isVisible()).toBe(true);
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await browser.goto(atlasSite.url + 'items/item-guided-setup/');
    await browser.keyboard.press('Tab');
    expect(await browser.locator(':focus').textContent()).toMatch(/skip/i);
    const video = browser.locator('video[controls]');
    expect(await video.isVisible()).toBe(false);
    await screen.getByText('Watch the guided setup walkthrough', { exact: true }).press('Enter');
    expect(await video.isVisible()).toBe(true);
    expect(await video.getAttribute('preload')).toBe('none');
    expect(await browser.locator('video[controls] track[srclang="en"]').count()).toBe(1);
    expect(
      await screen
        .getByRole('link', { name: 'Download video', exact: false })
        .getAttribute('download'),
    ).toBe('');
    await browser.goto(atlasSite.url + 'items/item-setup-recovery/');
    // The disclosure holding the animation: details that has a GIF inside.
    const animation = 'details:has(img[src$=".gif"])';
    expect(await browser.locator(animation).getAttribute('open')).toBeNull();
    await browser.locator(`${animation} >> summary`).press('Enter');
    expect(await browser.locator(`${animation} >> img[src$=".gif"]`).isVisible()).toBe(true);
    expect(await screen.getByRole('dialog').count()).toBe(0);
    await browser.locator(`${animation} >> summary`).press('Space');
    expect(await browser.locator(animation).getAttribute('open')).toBeNull();
  });

  test('checks contrast, labels and landmarks on the home, timeline, search and media pages', async ({
    browser,
    atlasSite,
  }) => {
    await loadAxe(browser);
    for (const route of [
      '',
      'items/',
      'sets/',
      'sets/set-onboarding/items/',
      'timeline/?selected=item-guided-setup',
      'people/noor/',
      'teams/growth/',
      'views/',
      'people/noor/timeline/?role=contributor',
      'items/item-guided-setup/',
      '?q=ONB-142',
    ]) {
      await browser.goto(atlasSite.url + route, { waitUntil: 'networkidle' });
      const violations = (await axeViolations(browser)).map((finding) => ({
        rule: finding.id,
        elements: finding.targets,
      }));
      expect(
        violations,
        'Accessibility violations on ' + route + ': ' + JSON.stringify(violations),
      ).toEqual([]);
    }
  });

  test('marks today on the Gantt between the ticks of the current month', async ({
    browser,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 1280, height: 900 });
    await freezeTime(browser, '2027-04-15T12:00:00Z');
    await browser.goto(atlasSite.url + 'timeline/', { waitUntil: 'networkidle' });
    const today = browser.locator('[data-today]');
    await today.waitFor();
    const ticks = browser.locator('[data-axis="month"] span');
    const april = await ticks.filter({ hasText: /^Apr/ }).boundingBox();
    const may = await ticks.filter({ hasText: /^May/ }).boundingBox();
    const marker = await today.boundingBox();
    if (!april || !may || !marker) {
      throw new Error('Expected the April and May ticks and the today marker to be laid out.');
    }

    expect(marker.x > april.x && marker.x < may.x, `today at ${marker.x}`).toBe(true);
  });

  test('prints the timeline as its dated list without the chart or controls', async ({
    browser,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 1280, height: 900 });
    await browser.goto(atlasSite.url + 'timeline/', { waitUntil: 'networkidle' });
    await emulatePrint(browser);
    expect(await browser.locator('[data-timeline-chart]').isVisible()).toBe(false);
    expect(await browser.locator('[data-timeline-tools]').isVisible()).toBe(false);
    expect(await browser.locator('#dated-list').isVisible()).toBe(true);
  });

  test('keeps the Items column headers for screen readers on a phone, with or without JavaScript', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    for (const javaScriptEnabled of [true, false]) {
      if (!javaScriptEnabled) {
        await blockScripts(browser);
      }

      await browser.goto(atlasSite.url + 'items/');
      expect(await screen.getByRole('columnheader').allTextContents()).toEqual([
        'Item',
        'Status',
        'Target',
      ]);
      const header = await browser.locator('.catalogue-table thead').boundingBox();
      expect(
        header !== null && header.width <= 1 && header.height <= 1,
        'the header row is clipped',
      ).toBe(true);
    }
  });

  test('shrinks a Mermaid diagram to fit a phone and links to the full drawing', async ({
    browser,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.goto(atlasSite.url + 'items/item-starter-templates/', {
      waitUntil: 'networkidle',
    });
    const image = browser.locator('.roadmap-diagram img').first();
    await image.scrollIntoView();
    const size = await browser.evaluate(async () => {
      const node = document.querySelector<HTMLImageElement>('.roadmap-diagram img');
      if (!node) {
        throw new Error('Expected a diagram image.');
      }

      await node.decode();
      return {
        natural: Number(node.getAttribute('width')),
        shown: node.getBoundingClientRect().width,
        ratio: node.getBoundingClientRect().width / node.getBoundingClientRect().height,
        drawn: Number(node.getAttribute('width')) / Number(node.getAttribute('height')),
        href: node.closest('a')?.getAttribute('href') ?? null,
        src: node.getAttribute('src'),
      };
    });
    expect(size.shown <= size.natural && size.shown <= 390).toBe(true);
    expect(Math.abs(size.ratio - size.drawn) < 0.02, 'the drawing keeps its aspect ratio').toBe(
      true,
    );
    expect(size.href).toBe(size.src);
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('prints a document page without navigation or controls, facts first', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    await browser.goto(atlasSite.url + 'releases/rel-spring/', { waitUntil: 'networkidle' });
    await emulatePrint(browser);
    expect(await browser.locator('body > header').isVisible()).toBe(false);
    expect(await browser.locator('[data-filter-bar]').first().isVisible()).toBe(false);
    const facts = screen.getByRole('complementary', { name: 'Facts', exact: false });
    expect(await facts.isVisible()).toBe(true);
    // The Facts landmark is `#record-facts`; its computed style is read in the page.
    expect(await facts.getAttribute('id')).toBe('record-facts');
    expect(
      await browser.evaluate(() => {
        const node = document.querySelector('#record-facts');
        return node ? getComputedStyle(node).position : null;
      }),
    ).toBe('static');
    expect(await browser.locator('main').textContent()).toMatch(/Release scope/);
    const factsBox = await facts.boundingBox();
    const brief = await browser.locator('#record-brief').boundingBox();
    expect(factsBox !== null && brief !== null && factsBox.y + factsBox.height <= brief.y).toBe(
      true,
    );
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('fits long release and team names in a zoomed reading viewport', async ({
    browser,
    atlasSite,
  }) => {
    await browser.setViewport({ width: 640, height: 480 });
    for (const route of ['releases/rel-summer/', 'teams/platform/']) {
      await browser.goto(atlasSite.url + route);
      const fits = await browser.evaluate(() => {
        const heading = document.querySelector('h1');
        if (!heading) {
          return false;
        }

        heading.textContent =
          'International Enterprise Workspace Lifecycle and Customer Experience Engineering';
        document.documentElement.style.zoom = '2';
        return (
          document.documentElement.scrollWidth <= window.innerWidth &&
          heading.scrollWidth <= heading.clientWidth
        );
      });
      expect(fits, route).toBe(true);
    }
  });

  test('reads release scope, an authored heading link, and the timeline with JavaScript disabled', async ({
    browser,
    screen,
    atlasSite,
  }) => {
    // The Playwright test also set `timezoneId: 'America/Los_Angeles'`. The web engine sets a time
    // zone per target only, and with no script running nothing on these static pages reads it:
    // dates are rendered at build time.
    await blockScripts(browser);
    await browser.goto(atlasSite.url + 'releases/rel-spring/');
    expect(await browser.locator('main').textContent()).toMatch(/45% to 60%/);
    expect(await browser.locator('main').textContent()).toMatch(/May 2027/);
    await screen.getByRole('link', { name: 'Guided workspace setup', exact: true }).first().click();
    await screen.getByRole('link', { name: 'setup event contract', exact: true }).click();
    expect(await browser.url()).toMatch(/#event-contract$/);
    await browser.goto(atlasSite.url + 'timeline/');
    expect(await browser.locator('#dated-list').textContent()).toMatch(/Guided workspace setup/);
    expect(await browser.locator('main').textContent()).toMatch(/Starter templates/);
    await browser.goto(atlasSite.url + 'teams/platform/timeline/');
    const scoped = browser.locator('#dated-list [data-filter-entry]');
    const itemIds = await Promise.all(
      (await scoped.all()).map(async (row) => (await row.getAttribute('data-filter-entry')) ?? ''),
    );
    const sortedItemIds = itemIds.toSorted((left, right) => left.localeCompare(right));
    expect(sortedItemIds).toEqual([
      'item-guided-setup',
      'item-invoice-preview',
      'item-setup-events',
    ]);
  });
});
