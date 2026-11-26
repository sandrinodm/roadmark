import { test as base } from '@e2e-dev/web';
import { ATLAS_URL } from '@roadmark/test-fixtures';

import type { Site } from './cli.ts';

import { serveCopy } from './cli.ts';

/**
 * A served site the suites open pages on.
 */
export type SiteUrl = {
  /**
   * The site URL at its base path, with a trailing slash.
   */
  url: string;
};

/**
 * The browser `test` with the two Atlas sites the suites read:
 *
 * - `atlasSite`: the runner's app, Atlas published at `/product/roadmap/` (see the config).
 * - `roadmapSite`: Atlas published at `/roadmap/`, built and served through the CLI once per worker
 *   for the suites whose URLs and links assert that base path.
 */
export const test = base.extend<{ atlasSite: SiteUrl }, { roadmapSite: Site }>({
  roadmapSite: [
    // The runner reads what a fixture needs from its destructured first parameter; this one needs
    // nothing. The second parameter is the runner's `use`, named so it does not read as a React hook.
    // oxlint-disable-next-line eslint/no-empty-pattern
    async ({}, provide) => {
      const site = await serveCopy(ATLAS_URL, '/roadmap/', 'roadmap-e2e-');
      await provide(site);
      await site.close();
    },
    { scope: 'worker' },
  ],
  atlasSite: async ({ app }, provide) => {
    await provide({ url: `${app.baseUrl}/` });
  },
});
