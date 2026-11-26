import { fileURLToPath } from 'node:url';

/**
 * The base path the runner's Atlas site is published under.
 */
export const ATLAS_BASE = '/product/roadmap/';

/**
 * Where the runner's app command builds the Atlas site, relative to the package root (inside the
 * ignored e2e output directory, outside the `results/` folder each run clears).
 */
export const ATLAS_SITE = '.e2e/atlas';

/**
 * Absolute path of the runner's built Atlas site, for suites that read the built files.
 */
export const ATLAS_SITE_DIRECTORY = fileURLToPath(new URL(`../../${ATLAS_SITE}/`, import.meta.url));
