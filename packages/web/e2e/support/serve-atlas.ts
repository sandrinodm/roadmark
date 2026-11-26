/**
 * The e2e runner's app command: builds the Atlas workspace with the CLI and serves it with
 * `roadmark preview` until the runner stops it.
 *
 * Usage: node e2e/support/serve-atlas.ts <out dir> <base path> <port>
 */

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import { resolve } from 'node:path';

import { build, preview } from './cli.ts';

/**
 * Where to build the site, the base path to publish it under and the port to serve it on.
 */
const [out, base, port] = process.argv.slice(2);
if (out === undefined || base === undefined || port === undefined) {
  throw new Error('Usage: node e2e/support/serve-atlas.ts <out dir> <base path> <port>');
}

await build(ATLAS_DIRECTORY, resolve(out), base);
/**
 * The preview server, stopped when the runner stops this process.
 */
const server = await preview(resolve(out), Number(port), true);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
