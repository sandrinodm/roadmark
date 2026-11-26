import { fileURLToPath } from 'node:url';

/**
 * The Atlas test workspace: a complete roadmap exercising every page, relation and diagnostic.
 */
export const ATLAS_URL = new URL('../atlas/', import.meta.url);

/**
 * Filesystem path of the Atlas workspace, with a trailing separator.
 */
export const ATLAS_DIRECTORY = fileURLToPath(ATLAS_URL);
