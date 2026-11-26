import type { Browser } from '@e2e-dev/web';
import type { Locator, Screen } from 'e2e';

/**
 * The fixtures that act on the page holding the chips.
 */
export type Page = {
  /**
   * Screen holding the chip, for role queries.
   */
  screen: Screen;

  /**
   * Browser showing the page, for CSS scopes and hovering.
   */
  browser: Browser;
};

/**
 * Picks a value in a filter chip the way a reader does: reach for the chip (which loads the
 * select), open it and press the option.
 *
 * @param page Screen and browser showing the page.
 * @param label Chip label, such as "Status".
 * @param option Visible option text.
 * @param scope Optional selector of the region holding the chip, such as `#roadmap-items`.
 */
export async function choose(
  { screen, browser }: Page,
  label: string,
  option: string,
  scope = 'body',
): Promise<void> {
  const chip = await chipTrigger(browser, label, scope);
  await chip.click();
  await screen.getByRole('option', { name: option, exact: true }).click();
  await screen.getByRole('listbox').waitFor({ state: 'hidden' });
}

/**
 * Returns a chip's upgraded combobox, upgrading the chips first.
 *
 * @param browser Browser showing the page.
 * @param label Chip label.
 * @param scope Selector of the region holding the chip.
 * @returns The combobox.
 */
export async function chipTrigger(
  browser: Browser,
  label: string,
  scope = 'body',
): Promise<Locator> {
  await browser
    .locator(`${scope} >> xpath=descendant-or-self::*[@data-filter-bar or @data-timeline-tools]`)
    .first()
    .hover();
  const trigger = browser.locator(scope).getByRole('combobox', { name: label, exact: true });
  await trigger.waitFor();
  return trigger;
}
