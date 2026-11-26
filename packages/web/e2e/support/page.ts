import type { Browser, WebRoute } from '@e2e-dev/web';
import type { Locator } from 'e2e';

import { expect } from 'e2e';
import { EventEmitter, once } from 'node:events';

/**
 * How long a page condition may take to come true, matching the browser steps' own budget.
 */
const WAIT_MS = 30_000;

/**
 * How long the network must stay quiet to count as idle, as Playwright's `networkidle` defines it.
 */
const QUIET_MS = 500;

/**
 * Response headers that describe the upstream encoding of a body the routes hand on decoded.
 */
const HOP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/**
 * Waits until a function evaluated in the page returns true (Playwright's `waitForFunction`). A
 * read that throws, such as one cut off by a navigation, counts as false and polls again.
 *
 * @param browser Browser showing the page.
 * @param condition Runs in the page; serialized, so it must not close over anything.
 * @param arg JSON argument passed to the condition.
 */
export async function until<Arg extends string | number | boolean | null>(
  browser: Browser,
  condition: (arg: Arg) => boolean,
  arg: Arg,
): Promise<void> {
  await expect.poll(async () => browser.evaluate(condition, arg), { timeout: WAIT_MS }).toBe(true);
}

/**
 * Waits until the Items search leaves exactly `count` rows of the table shown.
 *
 * @param browser Browser showing the Items page.
 * @param count Expected number of rows.
 */
export async function shownRows(browser: Browser, count: number): Promise<void> {
  await until(
    browser,
    (expected) =>
      document.querySelectorAll('#browse [data-filter-entry]:not([hidden])').length === expected,
    count,
  );
}

/**
 * Waits until the filters leave exactly `count` matching elements shown, instead of reading the
 * count before the page has applied its filters.
 *
 * @param browser Browser showing the page.
 * @param selector Elements to count.
 * @param count Expected number of shown elements.
 */
export async function settled(browser: Browser, selector: string, count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        browser.evaluate(
          (target: string) =>
            [...document.querySelectorAll<HTMLElement>(target)].filter(
              (node) => !node.hidden && node.offsetParent !== null,
            ).length,
          selector,
        ),
      { timeout: WAIT_MS },
    )
    .toBe(count);
}

/**
 * How long a focus check may take: enough for the matcher to complete a read of the page (it reads
 * at 0, 20 and 50 ms), too short for a later focus change to count.
 */
const FOCUS_READ_MS = 50;

/**
 * Asserts the element has focus now, as reading `node === document.activeElement` once did. The web
 * engine runs no code on a locator's element, so this is the focus matcher with a budget that only
 * covers reading the page, not the default five seconds of retries.
 *
 * @param locator The element that should have focus.
 */
export async function expectFocusedNow(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused({ timeout: FOCUS_READ_MS });
}

/**
 * Lets the page render two frames, so resize observers and media-query listeners have run.
 *
 * @param browser Browser showing the page.
 */
export async function nextFrames(browser: Browser): Promise<void> {
  await browser.evaluate(
    async () =>
      new Promise<null>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve(null);
          }),
        );
      }),
  );
}

/**
 * Applies the page's print styles on screen. The web engine cannot emulate the print media type
 * (Playwright's `emulateMedia({ media: 'print' })`), so this adds `screen` to every `@media print`
 * rule of the page's stylesheets, which then apply exactly as they would on paper. The site's
 * stylesheets have no `@media screen` rules to switch off and its scripts never read the print
 * media type, so the page renders what print emulation rendered. Fails when no rule was found, so
 * the workaround cannot silently do nothing.
 *
 * @param browser Browser showing the page.
 */
export async function emulatePrint(browser: Browser): Promise<void> {
  const applied = await browser.evaluate(() => {
    let count = 0;
    /**
     * Whether a rule nests other rules (`@media`, `@supports`, `@layer`, ...).
     */
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: `evaluate` serializes the function, so its helpers live inside it.
    function isGroup(rule: CSSRule): rule is CSSGroupingRule {
      return 'cssRules' in rule;
    }

    /**
     * Whether a rule is an `@media` rule: a group with a media list (`@import` has a media list but
     * nests no rules).
     */
    function isMedia(rule: CSSRule): rule is CSSMediaRule {
      return isGroup(rule) && 'media' in rule;
    }

    /**
     * Adds `screen` to the print rules in a rule list and in the groups it nests.
     */
    function visit(rules: CSSRuleList): void {
      for (const rule of rules) {
        if (isMedia(rule) && [...rule.media].includes('print')) {
          rule.media.appendMedium('screen');
          count += 1;
        }

        if (isGroup(rule)) {
          visit(rule.cssRules);
        }
      }
    }

    for (const sheet of document.styleSheets) {
      visit(sheet.cssRules);
    }

    return count;
  });
  expect(applied, 'print rules applied on screen').toBeGreaterThan(0);
}

/**
 * Runs the page without its JavaScript. The web engine has no per-test `javaScriptEnabled: false`,
 * so this answers every script request with an empty module instead. Every page loads its code
 * through one external module script (`assets/client/boot.js`, which imports the lazy chunks) and
 * has no inline scripts or event-handler attributes, so no site code runs, as with JavaScript off.
 * The difference: `<noscript>` content stays unrendered (the timeline's "Go to timeline list" skip
 * link, which no test reads) and `Date`/`Intl` still exist, which the static pages never use. Call
 * it before the first navigation.
 *
 * @param browser Browser that should not run the site's scripts.
 */
export async function blockScripts(browser: Browser): Promise<void> {
  await browser.route(/\.m?js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
}

/**
 * Fixes the page clock at one instant (Playwright's `clock.setFixedTime`): `Date.now()` and `new
 * Date()` return it in every document opened afterwards, while timers keep running.
 *
 * @param browser Browser to fix the time in.
 * @param iso The instant, as an ISO 8601 string.
 */
export async function freezeTime(browser: Browser, iso: string): Promise<void> {
  await browser.addInitScript((instant: string) => {
    const fixed = new Date(instant).getTime();
    const RealDate = Date;
    // The real constructor, seen as one that takes any argument list it is handed.
    const make: new (...args: Array<string | number>) => Date = RealDate;
    Date.now = () => fixed;
    const FixedDate = new Proxy(RealDate, {
      construct: (_target, args: Array<string | number>) =>
        args.length === 0 ? new RealDate(fixed) : new make(...args),
      apply: () => new RealDate(fixed).toString(),
    });
    Reflect.set(window, 'Date', FixedDate);
  }, iso);
}

/**
 * Records the URL of every request the browser makes from now on (Playwright's
 * `page.on('request')`), handing each on to the routes registered before this one.
 *
 * @param browser Browser to watch.
 * @returns The requested URLs, filled as requests start.
 */
export async function recordRequests(browser: Browser): Promise<Array<string>> {
  const urls: Array<string> = [];
  await browser.route('**/*', async (route) => {
    urls.push(route.request.url);
    await route.fallback();
  });
  return urls;
}

/**
 * Holds requests matching a pattern until released.
 */
export type Hold = {
  /**
   * Resolves once the first matching request is held (Playwright's `waitForRequest`).
   */
  requested: Promise<void>;

  /**
   * Lets every held and later request through.
   */
  release: () => void;
};

/**
 * Holds every request matching a pattern until `release` is called, so a press can land before
 * lazily loaded code or data arrives. Released requests go on to the routes registered before.
 *
 * @param browser Browser whose requests to hold.
 * @param pattern Route pattern, such as `**\/search-index.json`.
 */
export async function hold(browser: Browser, pattern: string): Promise<Hold> {
  const gate = new EventEmitter();
  let open = false;
  let seen: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await browser.route(pattern, async (route) => {
    seen?.();
    if (!open) {
      await once(gate, 'open');
    }

    await route.fallback();
  });
  return {
    requested,
    release: () => {
      open = true;
      gate.emit('open');
    },
  };
}

/**
 * Network activity the browser routes through the test.
 */
export type Network = {
  /**
   * Every requested URL, in order.
   */
  requests: Array<string>;

  /**
   * Waits until no request has been in flight for 500 ms (Playwright's `networkidle`).
   */
  idle: () => Promise<void>;
};

/**
 * Tracks requests from start to finished response, so a test can wait for the network to go quiet.
 * The web engine has no `waitForLoadState('networkidle')` and no request-finished event, so every
 * request is fetched by the route and fulfilled with the same status, headers and body, which marks
 * when it completes. Register it before any route that should run first (routes run newest first
 * and hand requests on with `fallback`).
 *
 * @param browser Browser to track.
 */
export async function trackNetwork(browser: Browser): Promise<Network> {
  const requests: Array<string> = [];
  let pending = 0;
  let changed = Date.now();
  await browser.route('**/*', async (route: WebRoute) => {
    requests.push(route.request.url);
    pending += 1;
    changed = Date.now();
    try {
      const response = await route.fetch();
      const body = await response.body();
      const headers = Object.fromEntries(
        Object.entries(response.headers).filter(([name]) => !HOP_HEADERS.has(name)),
      );
      await route.fulfill({ status: response.status, headers, body });
    } finally {
      pending -= 1;
      changed = Date.now();
    }
  });
  return {
    requests,
    idle: async () => {
      await expect
        .poll(() => pending === 0 && Date.now() - changed >= QUIET_MS, { timeout: WAIT_MS })
        .toBe(true);
    },
  };
}

/**
 * Opens a URL in a new tab of the same browser for the rest of the callback, then closes it and
 * returns to the previous tab: how the suites open a shared link the way a second reader would.
 * Playwright opened these in a new context; this site keeps no cookies or local storage and the new
 * tab starts with its own session storage, so the second reader starts as fresh.
 *
 * @param browser Browser showing the first page.
 * @param url Absolute URL to open.
 * @param read Reads the shared page.
 */
export async function inNewTab(
  browser: Browser,
  url: string,
  read: () => Promise<void>,
  waitUntil: 'load' | 'networkidle' = 'load',
): Promise<void> {
  const tab = await browser.newTab();
  try {
    await browser.goto(url, { waitUntil });
    await read();
  } finally {
    await tab.close();
  }
}
