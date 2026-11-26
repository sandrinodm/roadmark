import type { ChildProcess } from 'node:child_process';

import { bundleClient } from '@roadmark/web/client-bundle';
import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/**
 * Module specifiers in bundled output: `from"…"`, `import"…"` and `import("…")`.
 */
const MODULE_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

/**
 * What the tarball may contain, as paths inside the package: the manifest, README, license, the
 * built `lib/` and the two published starter templates.
 */
const PUBLISHED =
  /^(?:package\.json|README\.md|LICENSE|lib\/.+|templates\/(?:blank|ai-sandbox)\/.+)$/;

/**
 * What must never ship even under an allowed directory: tests and their helpers, source maps,
 * fixtures, mockups and TypeScript sources.
 */
const UNPUBLISHABLE = [
  /\.test\./,
  /test-dom/,
  /test-support/,
  /\.map$/,
  /fixtures?\//,
  /mockups?/,
  /(?<!\.d)\.[cm]?tsx?$/,
];

/**
 * Packages that must not be installed at any depth: the Node platform package the build bundles,
 * and the Redis clients it would drag in.
 */
const FORBIDDEN_PACKAGE = /^(?:@effect\/platform-node|redis|@redis\/.+|ioredis)$/;

/**
 * The line `roadmark dev` and `roadmark preview` print once they listen, with the site URL.
 */
const READY = /Roadmap available at (http:\/\/\S+)/;

/**
 * Reads the part of `help --json` this smoke test checks.
 */
const decodeManual = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      /**
       * The authoring guide embedded in the manual.
       */
      guide: Schema.String,
    }),
  ),
);

/**
 * Reads the part of `schema item` this smoke test checks.
 */
const decodeItemSchema = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      /**
       * The item frontmatter fields.
       */
      properties: Schema.Struct({
        /**
         * The item ID field.
         */
        id: Schema.Unknown,
      }),
    }),
  ),
);

/**
 * Reads the installed tree npm recorded in `package-lock.json`.
 */
const decodeLock = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      /**
       * Every installed package by its `node_modules/…` path, nested ones included.
       */
      packages: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
);

/**
 * The roadmark package directory, packed and installed by this test.
 */
const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Isolated consumer directory for testing the packed CLI.
 */
const temp = await mkdtemp(path.join(tmpdir(), 'roadmap-installed-'));
try {
  run('pnpm', ['pack', '--pack-destination', temp], root);
  const archive = (await readdir(temp)).find((entry) => entry.endsWith('.tgz'));
  assert.ok(archive);
  checkPublishedFiles(run('tar', ['-tzf', archive], temp));
  await writeFile(path.join(temp, 'package.json'), '{"name":"roadmap-smoke","private":true}');
  run('npm', ['install', '--no-audit', '--no-fund', './' + archive], temp);
  // npm installs required peers, so this catches a dependency that drags in Redis again.
  await checkInstalledTree(temp);

  const cli = path.join(temp, 'node_modules/.bin/roadmark');
  assert.match(run(cli, ['--help'], temp), /roadmark/);
  assert.match(run(cli, ['--version'], temp), /^\d+\.\d+\.\d+/);
  // Decoding fails unless the printed JSON Schema describes the item's id field.
  decodeItemSchema(run(cli, ['schema', 'item'], temp));
  const manual = decodeManual(run(cli, ['help', '--json'], temp));
  assert.match(manual.guide, /depends_on/);
  assert.match(run(cli, ['guide'], temp), /# Roadmark authoring guide/);

  // The blank template: the default init, extended with every `new` command.
  run(cli, ['init', 'blank'], temp);
  const blank = path.join(temp, 'blank');
  assert.match(await readFile(path.join(blank, 'AGENTS.md'), 'utf8'), /roadmark guide/);
  run(cli, ['new', 'set', 'set-billing', '--title', 'Billing'], blank);
  run(cli, ['new', 'release', 'rel-beta', '--title', 'Beta'], blank);
  run(
    cli,
    ['new', 'item', 'item-retry', '--set', 'set-getting-started', '--release', 'rel-beta'],
    blank,
  );
  run(cli, ['lint', '--strict'], blank);
  run(cli, ['build', '--out', 'site'], blank);
  await serveDev(cli, blank);

  // The ai-sandbox template, built under a subpath and served by the installed preview.
  run(cli, ['init', 'pilot', '--template', 'ai-sandbox'], temp);
  const pilot = path.join(temp, 'pilot');
  run(
    cli,
    [
      'new',
      'item',
      'item-retry',
      '--set',
      'runtime',
      '--title',
      'Retry a connection',
      '--format',
      'mdx',
    ],
    pilot,
  );
  run(cli, ['lint', '--strict'], pilot);
  run(cli, ['build', '--out', 'site', '--base', '/product/'], pilot);
  await matchesSourceBundle(path.join(pilot, 'site'));
  await serveInstalled(cli, pilot);
  console.log(
    'Installed tarball passed the file contract, dependency tree, help, guide, schema, both templates, new, strict lint, dev server, subpath build, HTTP preview and client modules.',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

/**
 * Runs a child command and returns stdout, promoting a nonzero exit to a test failure.
 */
function run(cmd: string, args: Array<string>, cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) {
    throw result.error ?? new Error([cmd, ...args, result.stderr, result.stdout].join(' '));
  }

  return result.stdout;
}

/**
 * Asserts the published-file contract on the tarball's member list (`tar -tzf` output, every path
 * under `package/`): only the allowed files, and none that are test, source or design material.
 *
 * @param listing One member path per line.
 */
function checkPublishedFiles(listing: string): void {
  const members = listing
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));
  assert.ok(members.includes('package.json') && members.includes('lib/main.js'), listing);
  const unexpected = members.filter(
    (member) => !PUBLISHED.test(member) || UNPUBLISHABLE.some((pattern) => pattern.test(member)),
  );
  assert.deepEqual(unexpected, [], 'files outside the published-file contract');
}

/**
 * Asserts that no forbidden package was installed anywhere in the consumer's tree, nested
 * dependencies included, by reading every entry npm recorded in its lockfile.
 *
 * @param consumer Directory npm installed the tarball into.
 */
async function checkInstalledTree(consumer: string): Promise<void> {
  const lock = decodeLock(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
  const installed = Object.keys(lock.packages)
    .filter((key) => key.includes('node_modules/'))
    .map((key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));
  assert.ok(
    installed.includes('roadmark') && installed.includes('effect'),
    'lockfile lists the tree',
  );
  const forbidden = installed.filter((name) => FORBIDDEN_PACKAGE.test(name));
  assert.deepEqual(forbidden, [], 'forbidden packages in the installed tree');
}

/**
 * A server the smoke test started.
 */
type Server = {
  /**
   * The site URL the server printed, with a trailing slash.
   */
  base: string;

  /**
   * Stops the server and waits for it to exit.
   */
  stop: () => Promise<void>;
};

/**
 * Starts an installed server command and waits for the URL it prints, failing if it exits or stays
 * silent for 15 seconds.
 *
 * @param cli Installed `roadmark` binary.
 * @param args Server command and flags.
 * @param cwd Workspace directory.
 */
async function startServer(cli: string, args: Array<string>, cwd: string): Promise<Server> {
  const child = spawn(cli, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGTERM'), 15_000);
  try {
    const lines = createInterface({ input: child.stdout });
    const base = await Promise.race([
      (async () => {
        for await (const line of lines) {
          const found = READY.exec(line)?.[1];
          if (found !== undefined) {
            return found;
          }
        }

        return undefined;
      })(),
      exited.then(() => {
        throw new Error(`roadmark ${args.join(' ')} exited before serving the site.`);
      }),
    ]);
    assert.ok(base, `roadmark ${args.join(' ')} printed no URL`);
    // Keep draining both pipes so a chatty server never blocks on a full one.
    child.stdout.resume();
    child.stderr.resume();
    return { base, stop: async () => stopChild(child, exited) };
  } catch (error) {
    await stopChild(child, exited);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stops a server the smoke test started, if it is still running, and waits for it to exit.
 *
 * @param child Server process.
 * @param exited Resolves once the process exits, registered when it was spawned.
 */
async function stopChild(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await exited;
  }
}

/**
 * Starts the installed dev server on a workspace, fetches its home page, and stops it.
 *
 * @param cli Installed `roadmark` binary.
 * @param cwd Workspace directory.
 */
async function serveDev(cli: string, cwd: string): Promise<void> {
  const server = await startServer(cli, ['dev', '--port', '0'], cwd);
  try {
    const home = await fetch(server.base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<html/i);
  } finally {
    await server.stop();
  }
}

/**
 * Starts the installed preview binary, exercises its published URLs, and closes it.
 */
async function serveInstalled(cli: string, cwd: string): Promise<void> {
  const server = await startServer(cli, ['preview', '--dir', 'site', '--port', '0'], cwd);
  try {
    const { base } = server;
    const item = await fetch(base + 'items/item-retry/');
    assert.equal(item.status, 200);
    assert.match(await item.text(), /Retry a connection/);
    for (const route of ['items/', 'people/tomas/', 'teams/runtime/']) {
      const response: Response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), /Fork a running sandbox/);
    }

    const brand = await fetch(base + 'assets/brand.css');
    assert.equal(brand.status, 200);
    assert.match(await brand.text(), /--header-logo-aspect/);
    const sets = await fetch(base + 'sets/');
    assert.equal(sets.status, 200);
    assert.match(await sets.text(), /Sandbox runtime/);
    const font = await fetch(base + 'assets/geist-latin.woff2');
    assert.equal(font.status, 200);
    assert.equal(
      Buffer.from(await font.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      'wOF2',
    );

    const rich = await fetch(base + 'items/item-usage-metering/');
    const brief = await rich.text();
    assert.match(brief, /class="roadmap-callout"/);
    assert.match(brief, /class="shiki/);
    const diagram = brief.match(/href="([^"]+\/diagrams\/[a-f0-9]+\.svg)"/)?.[1];
    assert.ok(diagram);
    assert.match(await (await fetch(new URL(diagram, base))).text(), /<svg/);

    const scripts = await checkModuleScripts(base, [
      '',
      'items/item-retry/',
      'timeline/',
      'people/tomas/',
    ]);
    assert.ok(scripts.some((url) => url.endsWith('/assets/client/boot.js')));
    assert.ok(scripts.some((url) => /\/assets\/client\/chunk-[\w-]+\.js$/.test(url)));
    // The pages' import graph, lazy palette included, reaches every published module.
    const modules = (await readdir(path.join(cwd, 'site/assets/client'))).filter((file) =>
      file.endsWith('.js'),
    );
    assert.deepEqual(
      scripts.map((url) => url.slice(url.lastIndexOf('/') + 1)).toSorted(),
      modules.toSorted(),
    );
    const stylesheet = await fetch(base + 'assets/site.css');
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /@layer ui-sdk/);
    const license = await fetch(base + 'assets/client/ui-sdk-license.txt');
    assert.equal(license.status, 200);
    assert.match(await license.text(), /Apache License/);

    const timeline = await fetch(base + 'timeline/');
    assert.match(await timeline.text(), /Gantt chart/);
    const search = await fetch(base + 'search-index.json');
    assert.match(await search.text(), /item-retry/);
  } finally {
    await server.stop();
  }
}

/**
 * Fetches every module script on the given pages and, recursively, every chunk those modules
 * import, asserting that each one is served as JavaScript under the deployment prefix.
 */
async function checkModuleScripts(base: string, routes: Array<string>): Promise<Array<string>> {
  const pending: Array<string> = [];
  for (const route of routes) {
    const page = await (await fetch(base + route)).text();
    for (const match of page.matchAll(/<script type="module" src="([^"]+)"/g)) {
      pending.push(new URL(match[1] ?? '', base + route).href);
    }
  }

  const seen = new Set<string>();
  for (let url = pending.pop(); url !== undefined; url = pending.pop()) {
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    assert.ok(new URL(url).pathname.startsWith(new URL(base).pathname), url);
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type') ?? '', /javascript/, url);
    const source = await response.text();
    // Every static and dynamic import, whether relative or root-relative, must stay under the base.
    for (const match of source.matchAll(MODULE_SPECIFIER)) {
      pending.push(new URL(match[1] ?? '', url).href);
    }
  }

  return [...seen];
}

/**
 * Checks that the installed package published exactly the browser bundle a source build produces,
 * byte for byte and under the same names, so switching build modes never strands an open page.
 *
 * @param site Built site directory.
 */
async function matchesSourceBundle(site: string): Promise<void> {
  const expected = await bundleClient();
  const directory = path.join(site, 'assets/client');
  const published = (await readdir(directory)).toSorted();
  assert.deepEqual(
    published,
    [...expected.keys()].map((file) => file.replace('assets/client/', '')).toSorted(),
  );
  for (const [file, bytes] of expected) {
    assert.ok(Buffer.from(bytes).equals(await readFile(path.join(site, file))), file);
  }
}
