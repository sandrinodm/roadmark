import type { Browser } from '@e2e-dev/web';

/**
 * Axe-core's browser build, relative to the package root (a direct dev dependency, so pnpm links it
 * into the package's own `node_modules`).
 */
const AXE_SOURCE = 'node_modules/axe-core/axe.min.js';

/**
 * The WCAG 2.1 A and AA rule tags every accessibility check runs.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * The part of axe-core's page API the checks call.
 */
type Axe = {
  /**
   * Runs the rules with the given tags against the document.
   */
  run: (
    context: Document,
    options: { runOnly: { type: 'tag'; values: Array<string> } },
  ) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: Array<unknown> }> }> }>;
};

declare global {
  /**
   * The page's window once axe-core's browser build has run in it.
   */
  interface Window {
    /**
     * Axe-core's global, defined by {@link loadAxe}.
     */
    axe?: Axe;
  }
}

/**
 * One rule an axe run found broken, with the elements that break it.
 */
export type AxeViolation = {
  /**
   * The axe rule ID, such as `color-contrast`.
   */
  id: string;

  /**
   * One CSS selector path per failing element.
   */
  targets: Array<Array<string>>;
};

/**
 * Loads axe-core into every document the test opens from now on. `@axe-core/playwright` injected it
 * into the page it analyzed; the web engine instead adds it as an init script, which only defines
 * `window.axe` and leaves the page untouched until a run. Call it before the first navigation.
 *
 * @param browser Browser to check.
 */
export async function loadAxe(browser: Browser): Promise<void> {
  await browser.addInitScript({ path: AXE_SOURCE });
}

/**
 * Runs axe in the current page with the WCAG 2.1 A and AA rules, as `new AxeBuilder({ page
 * }).withTags([...]).analyze()` did, and returns the violations.
 *
 * @param browser Browser showing the page; {@link loadAxe} must have run before it opened.
 */
export async function axeViolations(browser: Browser): Promise<Array<AxeViolation>> {
  return browser.evaluate(async (tags: Array<string>) => {
    if (window.axe === undefined) {
      throw new Error('axe-core is not loaded in this page.');
    }

    const report = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return report.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target.map(String)),
    }));
  }, WCAG_TAGS);
}
