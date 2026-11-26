import { test } from '@e2e-dev/web';
import { ATLAS_URL } from '@roadmark/test-fixtures';
import { expect } from 'e2e';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { axeViolations, loadAxe } from './support/axe.ts';
import { serveCopy } from './support/cli.ts';

/**
 * The base path the suite's own site is published under.
 */
const BASE = '/roadmap/';

/**
 * Releases added to Atlas so the Release chip holds a long, searchable list.
 */
const EXTRA_RELEASES = 8;

test('searches a long chip list and picks from it by keyboard', async ({ browser, screen }) => {
  const site = await serveCopy(ATLAS_URL, BASE, 'roadmap-chips-', async (workspace) => {
    for (let index = 1; index <= EXTRA_RELEASES; index += 1) {
      await writeFile(
        join(workspace, `releases/wave-${index}.md`),
        [
          '---',
          `id: rel-wave-${index}`,
          `title: Wave ${index} release`,
          'description: A later delivery wave.',
          'outcome: Teams get the next wave.',
          'status: planned',
          `target: "2028-0${index}"`,
          '---',
          '',
        ].join('\n'),
      );
    }
  });
  try {
    await loadAxe(browser);
    await browser.goto(site.url + 'items/', { waitUntil: 'networkidle' });
    await screen.getByRole('button', { name: /^Release/ }).focus();
    const trigger = screen.getByRole('combobox', { name: 'Release', exact: true });
    await trigger.waitFor();
    await trigger.focus();
    await browser.keyboard.press('Enter');
    const search = screen.getByRole('combobox', { name: 'Search Release', exact: false });
    await search.waitFor();
    await browser.keyboard.type('wave 5');
    const options = screen.getByRole('option');
    await screen
      .getByRole('option', { name: 'Wave 4 release', exact: false })
      .waitFor({ state: 'detached' });
    expect(await options.allTextContents()).toEqual(['Wave 5 release']);
    const violations = await axeViolations(browser);
    expect(violations.map(({ id }) => id)).toEqual([]);
    await browser.keyboard.press('ArrowDown');
    await browser.keyboard.press('Enter');
    await browser.waitForURL(/release=rel-wave-5/);
    expect(await trigger.textContent()).toMatch(/Wave 5 release/);
  } finally {
    await site.close();
  }
});
