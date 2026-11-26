import { bundleClient, CLIENT_DIRECTORY, PREBUILT_DIRECTORY } from '@roadmark/web/client-bundle';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The roadmark package directory, which receives `lib`.
 */
const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * The internal workspace packages compiled into the published tree. Each one's sources land in
 * `lib/<directory>`, and imports of `@roadmark/<directory>/<module>` become relative paths to them,
 * so the installed package never depends on them. Assets the renderer reads beside its own modules
 * keep the same relative layout.
 */
const INTERNAL = [
  { name: '@roadmark/compiler', directory: 'compiler', exclude: [] },
  // The browser client is bundled by esbuild below, and type-checks only with the DOM library.
  { name: '@roadmark/web', directory: 'web', exclude: ['client'] },
] as const;

// Importing this file (as its test does) only defines the helpers; running it builds the package.
if (import.meta.main) {
  await packageCli();
}

/**
 * Compiles every source tree into a temporary package tree and promotes it to lib once TypeScript
 * and the static assets are ready.
 */
async function packageCli(): Promise<void> {
  const staging = await mkdtemp(path.join(root, '.roadmark-package-'));
  try {
    await emit(path.join(root, 'src'), staging);
    for (const { name, directory, exclude } of INTERNAL) {
      await emit(
        await realpath(path.join(root, 'node_modules', name, 'src')),
        path.join(staging, directory),
        exclude,
      );
    }

    await linkInternal(staging);
    const web = path.join(staging, 'web');
    const webSources = await realpath(path.join(root, 'node_modules/@roadmark/web/src'));
    for (const entry of await readdir(webSources, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(js|css|mjs|svg|webp|woff2|txt)$/.test(entry.name)) {
        const source = path.join(entry.parentPath, entry.name);
        await cp(source, path.join(web, path.relative(webSources, source)), {
          force: false,
          errorOnExist: true,
        });
      }
    }

    // The browser bundle is built from the TypeScript sources here, once, so an installed package
    // publishes the same files under the same names as a source checkout. tsc's own output for the
    // client folder is not needed at runtime.
    await rm(path.join(web, 'client'), { recursive: true, force: true });
    for (const [file, bytes] of await bundleClient()) {
      const target = path.join(web, PREBUILT_DIRECTORY, file.slice(CLIENT_DIRECTORY.length));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }

    await bundlePlatform(path.join(staging, 'compiler'));
    await chmod(path.join(staging, 'main.js'), 0o755);
    await rm(path.join(root, 'lib'), { recursive: true, force: true });
    await rename(staging, path.join(root, 'lib'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Compiles one package's `src` folder, without its tests and the excluded folders, into `output`
 * with the package's own compiler options. The emitting build never reuses the type-check cache: a
 * stale .tsbuildinfo can make tsc skip emitting files whose outputs were deleted.
 */
async function emit(
  sources: string,
  output: string,
  exclude: ReadonlyArray<string> = [],
): Promise<void> {
  const config = output + '.tsconfig.json';
  await writeFile(
    config,
    JSON.stringify({
      extends: path.join(sources, '../tsconfig.json'),
      compilerOptions: { noEmit: false, outDir: output, rootDir: sources, incremental: false },
      include: [sources],
      exclude: ['**/*.test.ts', ...exclude].map((pattern) => path.join(sources, pattern)),
    }),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', config],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`TypeScript compilation of ${sources} failed.`);
    }
  } finally {
    await rm(config);
  }
}

/**
 * Rewrites every `@roadmark/<package>/<module>` specifier in the compiled tree to a relative path
 * to that module's compiled file, and fails if any other reference to an internal package remains.
 */
async function linkInternal(output: string): Promise<void> {
  const specifier = /(["'])@roadmark\/([\w-]+)\/([\w./-]+)\1/g;
  for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    const file = path.join(entry.parentPath, entry.name);
    const source = await readFile(file, 'utf8');
    const linked = source.replaceAll(
      specifier,
      (match, quote: string, name: string, module: string) => {
        const internal = INTERNAL.find((candidate) => candidate.directory === name);
        if (!internal) {
          return match;
        }

        const target = path.join(output, internal.directory, module);
        return quote + relativeSpecifier(entry.parentPath, target) + quote;
      },
    );
    if (linked.includes('@roadmark/')) {
      throw new Error(`${file} still refers to an internal package.`);
    }

    await writeFile(file, linked);
  }
}

/**
 * The relative import specifier from a compiled file's directory to a module's compiled file.
 * `path.relative` uses backslashes on Windows, which are not separators in an import specifier, so
 * the result always uses forward slashes.
 *
 * @param directory Directory of the importing file.
 * @param module Module path without its `.js` extension.
 * @param paths Path implementation, `path.win32` or `path.posix`; defaults to the host's.
 * @returns A `./` or `../` specifier ending in `.js`.
 */
export function relativeSpecifier(
  directory: string,
  module: string,
  paths: Pick<typeof path, 'relative' | 'sep'> = path,
): string {
  const target = paths.relative(directory, module).split(paths.sep).join('/');
  return (target.startsWith('.') ? target : './' + target) + '.js';
}

/**
 * Replaces the compiled platform module of @roadmark/compiler with a bundle of the Node platform
 * modules it re-exports. `@effect/platform-node` lists the Redis client as a required peer
 * dependency, so depending on it would make npm install Redis for every user. Effect itself stays
 * external: a second copy would break service identity. The licences of the bundled packages ship
 * beside the bundle.
 */
async function bundlePlatform(output: string): Promise<void> {
  const target = path.join(output, 'platform.js');
  const result = await build({
    entryPoints: [fileURLToPath(import.meta.resolve('@roadmark/compiler/platform'))],
    absWorkingDir: root,
    outfile: target,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node26',
    external: ['effect', 'effect/*'],
    // Bundled CommonJS (ws) calls require() for Node built-ins, which ESM lacks.
    banner: {
      js: "import { createRequire as roadmarkRequire } from 'node:module';\nconst require = roadmarkRequire(import.meta.url);",
    },
    legalComments: 'none',
    metafile: true,
    allowOverwrite: true,
    logLevel: 'warning',
  });
  // Each bundled package's directory, read from the input paths (the greedy match takes the innermost
  // node_modules, so pnpm's nested layout resolves to the package itself).
  const packages = new Map<string, string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
    if (match?.[1] && match[2]) {
      packages.set(match[2], path.resolve(root, match[1]));
    }
  }

  const notices: Array<string> = [];
  for (const [name, directory] of [...packages].toSorted(([a], [b]) => a.localeCompare(b))) {
    const licence = await readFile(path.join(directory, 'LICENSE'), 'utf8');
    notices.push(`${name}\n${'='.repeat(name.length)}\n\n${licence.trim()}\n`);
  }

  await writeFile(path.join(output, 'platform-licenses.txt'), notices.join('\n'), { flag: 'wx' });
}
