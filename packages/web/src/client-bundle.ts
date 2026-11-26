import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the UI SDK licence relative to the installed roadmap package.
 */
const require = createRequire(import.meta.url);

/**
 * Browser entry points. Each becomes `assets/client/<name>.js`; code they load with `import()`
 * becomes a shared chunk.
 */
const ENTRIES = ['boot'];

/**
 * Output directory of the client modules, relative to the site root.
 */
export const CLIENT_DIRECTORY = 'assets/client/';

/**
 * Whether this module runs from `src` (TypeScript), where it bundles the client sources. The
 * compiled `lib` package instead serves the bundle `apps/cli/scripts/package.ts` built from the
 * same sources, so both modes publish byte-identical files under the same names.
 */
const FROM_SOURCE = path.extname(import.meta.filename) === '.ts';

/**
 * Directory of the prebuilt bundle inside the compiled package.
 */
export const PREBUILT_DIRECTORY = 'client-dist/';

/**
 * The latest bundle and the source state it was built from. The output does not depend on the
 * workspace or the deployment base, only on the client sources, so a rebuild in source mode reuses
 * it until a client file changes. The installed package's prebuilt bundle never changes.
 */
let bundle: { key: string; files: Promise<Map<string, Uint8Array>> } | undefined;

/**
 * Source folders the browser bundle is built from.
 */
const SOURCE_DIRECTORIES = ['client/', 'ui/'];

/**
 * Bundles the browser modules with code splitting and returns them with the UI SDK licence, or
 * reads the installed package's prebuilt bundle.
 *
 * @returns Output paths relative to the site root, paired with file bytes.
 * @throws If esbuild fails or the licence cannot be read.
 */
export async function clientAssets(): Promise<Map<string, Uint8Array>> {
  const key = FROM_SOURCE ? await sourceKey() : 'prebuilt';
  if (bundle?.key !== key) {
    const files = (FROM_SOURCE ? bundleClient() : readPrebuilt()).catch((error: unknown) => {
      bundle = undefined;
      throw error;
    });
    bundle = { key, files };
  }

  return bundle.files;
}

/**
 * Fingerprints the client sources by content, so a rebuild in source mode picks up any change to
 * them. `roadmark dev` watches the workspace, not `packages/web/src`: an edited client file shows
 * up on the next rebuild the workspace triggers.
 *
 * @returns Cache key.
 */
async function sourceKey(): Promise<string> {
  return sourceDigest(
    SOURCE_DIRECTORIES.map((folder) => fileURLToPath(new URL(folder, import.meta.url))),
  );
}

/**
 * Hashes the paths and bytes of every file under some directories.
 *
 * @param directories Absolute directories.
 * @returns Hex SHA-256 digest.
 */
export async function sourceDigest(directories: ReadonlyArray<string>): Promise<string> {
  const lists = await Promise.all(
    directories.map(async (directory) => {
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name));
    }),
  );
  const files = lists.flat().toSorted();
  const contents = await Promise.all(files.map(async (file) => readFile(file)));
  const hash = createHash('sha256');
  for (const [index, file] of files.entries()) {
    hash
      .update(file)
      .update('\0')
      .update(contents[index] ?? new Uint8Array())
      .update('\0');
  }

  return hash.digest('hex');
}

/**
 * Reads the bundle that packaging wrote next to this module.
 *
 * @returns Bundled files keyed by their output path.
 */
async function readPrebuilt(): Promise<Map<string, Uint8Array>> {
  const directory = fileURLToPath(new URL(PREBUILT_DIRECTORY, import.meta.url));
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  const contents = await Promise.all(files.map(async (file) => readFile(file)));
  return new Map(
    files.map((file, index): [string, Uint8Array] => [
      CLIENT_DIRECTORY + path.relative(directory, file).split(path.sep).join('/'),
      contents[index] ?? new Uint8Array(),
    ]),
  );
}

/**
 * Runs esbuild over the TypeScript client entries in `src`. Packaging calls it too, so the
 * published bundle never depends on how `tsc` emitted the sources.
 *
 * @returns Bundled files keyed by their output path, including the UI SDK licence.
 */
export async function bundleClient(): Promise<Map<string, Uint8Array>> {
  // Loaded on demand: the installed package reads its prebuilt bundle and never runs esbuild here.
  const { build } = await import('esbuild');
  const directory = fileURLToPath(new URL('client/', import.meta.url));
  const result = await build({
    entryPoints: ENTRIES.map((name) => path.join(directory, `${name}.ts`)),
    absWorkingDir: directory,
    outdir: directory,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    minify: true,
    legalComments: 'none',
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    write: false,
    logLevel: 'silent',
  });
  const files = new Map<string, Uint8Array>();
  for (const file of result.outputFiles) {
    files.set(CLIENT_DIRECTORY + path.relative(directory, file.path), file.contents);
  }

  const licence = await readFile(
    require.resolve('@ui-sdk/web/package.json').replace(/package\.json$/, 'LICENSE'),
  );
  files.set(CLIENT_DIRECTORY + 'ui-sdk-license.txt', licence);
  return files;
}
