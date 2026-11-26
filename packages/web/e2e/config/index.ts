import type { E2EConfig } from 'e2e';

import { web } from '@e2e-dev/web';

import { ATLAS_BASE, ATLAS_SITE } from '../support/sites.ts';

/**
 * How long the app command gets to build the Atlas site and start serving it, in milliseconds.
 */
const STARTUP_TIMEOUT_MS = 120_000;

/**
 * Parallel workers. Files run in parallel and a file's tests in order; every test opens a fresh
 * browser context and the servers only serve static files, so files share nothing but the CPU. Four
 * keeps the timing-sensitive tests (held requests, settled layouts) stable on a 4-core CI runner
 * while cutting the run to a fraction of one worker's time.
 */
const WORKERS = 4;

/**
 * The browser suites: Chromium against the Atlas workspace, built by the CLI and served by
 * `roadmark preview` at `/product/roadmap/` on a free port, which the runner starts before the
 * first test and stops after the last. Suites that need another base path or a changed workspace
 * build and serve their own copy through the CLI (`e2e/support/cli.ts`). Every step is
 * deterministic, so no model is configured.
 */
export default {
  tests: ['e2e/*.e2e.ts'],
  workers: WORKERS,
  // A retry would hide a flaky test; a failure should fail the run, locally and in CI.
  retries: 0,
  reporters: ['list', 'junit'],
  output: '.e2e',
  targets: [
    {
      name: 'chromium',
      engine: web({ browser: 'chromium' }),
      app: {
        url: `http://127.0.0.1:0${ATLAS_BASE}`,
        command: {
          executable: 'node',
          args: ['e2e/support/serve-atlas.ts', ATLAS_SITE, ATLAS_BASE, '{port}'],
          startupTimeout: STARTUP_TIMEOUT_MS,
          log: '.e2e/logs/atlas.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
