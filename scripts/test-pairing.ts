// Every source module in the workspace's packages and apps has a colocated `<name>.test.ts` that
// declares at least one test and loads the module it is named after. Modules with no behaviour of
// their own, and test helpers named like tests, are listed below with the reason.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Workspace root, which the paths below are relative to.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Modules without a test of their own, and why none is needed.
 */
const EXEMPT = new Map<string, string>([
  ['packages/compiler/src/model.ts', 'Type declarations only; no runtime code.'],
  [
    'packages/compiler/src/platform.ts',
    'Re-exports @effect/platform-node; the package build bundles it.',
  ],
  ['apps/cli/src/run.ts', 'Re-exports the compiler runner, which run.test.ts covers there.'],
  ['packages/web/src/client/events.ts', 'One event-name constant shared by the browser modules.'],
  ['packages/web/src/client/test-dom.ts', 'The DOM helper the browser-client tests run on.'],
]);

/**
 * Shared test code named `*.test.ts` so the lint rules and the package build treat it as test-only.
 * It declares no tests and pairs with no module: a source file of the same base name still needs a
 * real test.
 */
const HELPERS = new Map<string, string>([
  ['packages/web/src/test-support.test.ts', 'Fixtures and HTML queries for the renderer tests.'],
]);

/**
 * A `describe`-free test declaration: `it(`, `test(` or one of their `.only`, `.skip` and `.todo`
 * forms. A syntax check, not a parse: it only has to tell a test file from an empty one.
 */
const DECLARES_TEST = /(?<![\w.$])(?:it|test)(?:\.(?:only|skip|todo))?\s*\(/;

/**
 * Lists the directories a `pnpm-workspace.yaml` package glob matches. Supports what workspaces use
 * here: a literal directory, or one ending in `/*` for every directory directly inside it.
 */
async function expand(glob: string): Promise<Array<string>> {
  // Anything else (`**`, a negation, a wildcard mid-path) would silently drop packages from the
  // guard, so refuse it until this function learns the pattern.
  if (/[*?![\]{}]/.test(glob.replace(/\/\*$/, ''))) {
    throw new Error(`scripts/test-pairing.ts cannot expand the workspace glob "${glob}".`);
  }

  if (!glob.endsWith('/*')) {
    return existsSync(path.join(ROOT, glob)) ? [glob] : [];
  }

  const parent = glob.slice(0, -2);
  if (!existsSync(path.join(ROOT, parent))) {
    return [];
  }

  const entries = await readdir(path.join(ROOT, parent), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `${parent}/${entry.name}`);
}

/**
 * Reads the package globs from `pnpm-workspace.yaml`: the `- <glob>` lines under `packages:`.
 */
async function workspaceGlobs(): Promise<Array<string>> {
  const yaml = await readFile(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs: Array<string> = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:');
    } else if (inPackages) {
      const glob = /^\s+-\s+['"]?([^'"#\s]+)['"]?/.exec(line)?.[1];
      if (glob !== undefined) {
        globs.push(glob.replace(/\/$/, ''));
      }
    }
  }

  if (globs.length === 0) {
    throw new Error('pnpm-workspace.yaml lists no packages.');
  }

  return globs;
}

/**
 * Every workspace package's `src` directory, relative to the workspace root.
 */
async function sourceDirectories(): Promise<Array<string>> {
  const packages = (await Promise.all((await workspaceGlobs()).map(expand))).flat();
  return packages
    .filter((directory) => existsSync(path.join(ROOT, directory, 'package.json')))
    .map((directory) => `${directory}/src`)
    .filter((directory) => existsSync(path.join(ROOT, directory)))
    .toSorted();
}

/**
 * Lists the TypeScript files under a directory, recursively, relative to the workspace root.
 */
async function sourceFiles(directory: string): Promise<Array<string>> {
  const entries = await readdir(path.join(ROOT, directory), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) =>
      path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    );
}

/**
 * Whether a test's source loads the module it is named after: a static or dynamic import of
 * `./<name>.ts`, or `runModule('<name>.ts')`, which the browser-client tests use to run a module's
 * top-level code against the test DOM (see `packages/web/src/client/test-dom.ts`).
 */
function referencesModule(source: string, name: string): boolean {
  const file = name.replaceAll('.', String.raw`\.`) + String.raw`\.ts`;
  return new RegExp(
    String.raw`['"\x60]\./${file}['"\x60]|runModule\(\s*['"\x60]${file}['"\x60]`,
  ).test(source);
}

/**
 * Every workspace package's source directory.
 */
const sources = await sourceDirectories();

/**
 * Every TypeScript file in the source directories.
 */
const files = new Set((await Promise.all(sources.map(sourceFiles))).flat());

/**
 * One line per missing or hollow test, misplaced helper or stale entry.
 */
const problems: Array<string> = [];
for (const file of [...files].toSorted()) {
  if (file.endsWith('.test.ts')) {
    const pairs = files.has(file.replace(/\.test\.ts$/, '.ts'));
    if (!pairs && !HELPERS.has(file)) {
      const source = await readFile(path.join(ROOT, file), 'utf8');
      if (!DECLARES_TEST.test(source)) {
        problems.push(`${file} declares no test; add one or list it in HELPERS.`);
      }
    }

    continue;
  }

  const test = file.replace(/\.ts$/, '.test.ts');
  const name = path.basename(file, '.ts');
  if (EXEMPT.has(file)) {
    if (files.has(test) && !HELPERS.has(test)) {
      problems.push(`${file} has ${test}; remove it from EXEMPT in scripts/test-pairing.ts.`);
    }
  } else if (!files.has(test)) {
    problems.push(`${file} has no ${path.basename(test)} beside it.`);
  } else if (HELPERS.has(test)) {
    problems.push(`${file} has no test: ${path.basename(test)} is a shared helper, not its test.`);
  } else {
    const source = await readFile(path.join(ROOT, test), 'utf8');
    if (!DECLARES_TEST.test(source)) {
      problems.push(`${test} declares no test (no it() or test() call).`);
    }

    if (!referencesModule(source, name)) {
      problems.push(`${test} never loads ./${name}.ts (by import or runModule('${name}.ts')).`);
    }
  }
}

for (const file of EXEMPT.keys()) {
  if (!files.has(file)) {
    problems.push(`${file} is listed in EXEMPT but no longer exists.`);
  }
}

for (const file of HELPERS.keys()) {
  if (!files.has(file)) {
    problems.push(`${file} is listed in HELPERS but no longer exists.`);
  } else if (DECLARES_TEST.test(await readFile(path.join(ROOT, file), 'utf8'))) {
    problems.push(`${file} declares tests; remove it from HELPERS in scripts/test-pairing.ts.`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Every source module in ${sources.join(', ')} has a colocated test ` +
      `(${EXEMPT.size} exempt, ${HELPERS.size} helper).`,
  );
}
