import { Schema } from 'effect';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { AGENTS_GUIDE } from './manual.ts';
import { runPromise } from './run.ts';
import {
  initWorkspace,
  newDocument,
  ScaffoldError,
  scaffoldDocument,
  scaffoldWorkspace,
} from './scaffold.ts';
import { TEMPLATES } from './templates.ts';

/**
 * Temporary directories removed after each test.
 */
const scratch: Array<string> = [];

/**
 * Directory of the default starter, the source of every blank workspace.
 */
const BLANK = TEMPLATES[0].directory;

/**
 * Today's UTC date, the target of a new release.
 */
const TODAY = new Date().toISOString().slice(0, 10);

afterEach(async () => {
  for (const directory of scratch.splice(0)) {
    await chmod(directory, 0o755).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Creates an empty canonical temporary directory removed after the test.
 */
async function home(): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'roadmap-scaffold-')));
  scratch.push(directory);
  return directory;
}

/**
 * Creates a blank workspace and returns its root.
 */
async function blankWorkspace(): Promise<string> {
  const root = path.join(await home(), 'workspace');
  await initWorkspace(root);
  return root;
}

/**
 * Lists every file beneath a directory as sorted relative paths.
 */
async function filesUnder(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

/**
 * Awaits a scaffold that must fail and returns its author-facing message.
 */
async function failure(promise: Promise<unknown>): Promise<string> {
  const outcome = await promise.then(
    () => 'resolved',
    (error: unknown) => error,
  );
  return scaffoldMessage(outcome);
}

/**
 * Asserts that a value is the scaffold's typed failure and returns its message.
 */
function scaffoldMessage(value: unknown): string {
  assert.ok(isScaffoldError(value), `Expected a ScaffoldError, got ${String(value)}`);
  return value.message;
}

/**
 * Recognizes the scaffold's typed failure.
 */
const isScaffoldError = Schema.is(ScaffoldError);

/**
 * Whether the process can bypass file permissions, which makes the read-only rollback test moot.
 */
const privileged = process.getuid?.() === 0;

void describe('scaffoldWorkspace', () => {
  void it('copies every starter file and the agent guide into a new nested directory', async () => {
    const target = path.join(await home(), 'a', 'b', 'roadmap');
    await initWorkspace(target);
    const starter = await filesUnder(BLANK);
    assert.deepEqual(await filesUnder(target), [...starter, 'AGENTS.md'].toSorted());
    for (const file of starter) {
      assert.equal(
        await readFile(path.join(target, file), 'utf8'),
        await readFile(path.join(BLANK, file), 'utf8'),
        file,
      );
    }

    assert.equal(await readFile(path.join(target, 'AGENTS.md'), 'utf8'), AGENTS_GUIDE);
  });

  void it('initializes an existing empty directory with a named template', async () => {
    const target = await home();
    await runPromise(scaffoldWorkspace(target, 'blank'));
    assert.ok((await readdir(target)).includes('roadmap.yaml'));
  });

  void it('rejects any collision before writing a single file', async () => {
    const target = await home();
    await writeFile(path.join(target, 'teams.yaml'), 'mine: Mine\n');
    assert.equal(
      await failure(initWorkspace(target)),
      `Cannot initialize because ${path.join(target, 'teams.yaml')} already exists.`,
    );
    assert.deepEqual(await readdir(target), ['teams.yaml']);
    assert.equal(await readFile(path.join(target, 'teams.yaml'), 'utf8'), 'mine: Mine\n');

    await rm(path.join(target, 'teams.yaml'));
    await writeFile(path.join(target, 'AGENTS.md'), 'mine');
    assert.match(await failure(initWorkspace(target)), /AGENTS\.md already exists\.$/);
    assert.deepEqual(await readdir(target), ['AGENTS.md']);
  });

  void it('rejects a file where the target or a starter folder must be a directory', async () => {
    const parent = await home();
    const file = path.join(parent, 'roadmap.txt');
    await writeFile(file, '');
    assert.equal(await failure(initWorkspace(file)), `Expected a directory at ${file}.`);
    // A path beneath a file fails on the lookup itself, before anything is written.
    assert.match(await failure(initWorkspace(path.join(file, 'inside'))), /^ENOTDIR\b/);
    assert.deepEqual(await readdir(parent), ['roadmap.txt']);

    const target = path.join(parent, 'workspace');
    await mkdir(target);
    await writeFile(path.join(target, 'feature-sets'), '');
    assert.equal(
      await failure(initWorkspace(target)),
      `Expected a directory at ${path.join(target, 'feature-sets')}.`,
    );
    assert.deepEqual(await readdir(target), ['feature-sets']);
  });

  void it(
    'rolls back copied files and created folders when a copy fails midway',
    { skip: privileged && 'root ignores directory permissions' },
    async () => {
      const parent = await home();
      const target = path.join(parent, 'workspace');
      await mkdir(path.join(target, 'releases'), { recursive: true });
      // Sorted copy order puts feature-sets/ and people.yaml before releases/, so those land first.
      await chmod(path.join(target, 'releases'), 0o555);
      scratch.unshift(path.join(target, 'releases'));
      assert.match(await failure(initWorkspace(target)), /EACCES|permission denied/i);
      assert.deepEqual(await readdir(target), ['releases']);
      assert.deepEqual(await readdir(path.join(target, 'releases')), []);
    },
  );

  void it(
    'leaves nothing behind when the target directory cannot be created',
    {
      skip: privileged && 'root ignores directory permissions',
    },
    async () => {
      const parent = await home();
      await chmod(parent, 0o555);
      assert.match(
        await failure(initWorkspace(path.join(parent, 'new'))),
        /EACCES|permission denied/i,
      );
      await chmod(parent, 0o755);
      assert.deepEqual(await readdir(parent), []);
    },
  );

  void it('copies the named template rather than the default', async () => {
    const target = await home();
    await runPromise(scaffoldWorkspace(target, 'ai-sandbox'));
    const starter = await filesUnder(TEMPLATES[1].directory);
    assert.deepEqual(await filesUnder(target), [...starter, 'AGENTS.md'].toSorted());
  });
});

void describe('scaffoldDocument', () => {
  void it('writes a feature set owned by the first person and team in the registries', async () => {
    const root = await blankWorkspace();
    const file = await newDocument(root, { kind: 'set', slug: 'billing', title: 'Billing: v2' });
    assert.equal(file, 'feature-sets/billing/README.md');
    assert.equal(
      await readFile(path.join(root, file), 'utf8'),
      [
        '---',
        'id: billing',
        'title: "Billing: v2"',
        'description: Describe the problem and why it matters.',
        'outcome: Describe the outcome and how you will measure it.',
        'pm: alex',
        'engineering_team: product',
        '---',
        '',
      ].join('\n'),
    );
  });

  void it('writes an item into a feature set found by ID or folder, scheduled in a release', async () => {
    const root = await blankWorkspace();
    const byId = await newDocument(root, {
      kind: 'item',
      slug: 'one',
      title: 'One',
      set: 'set-getting-started',
      release: 'rel-first-release',
    });
    assert.equal(byId, 'feature-sets/getting-started/items/one.md');
    assert.equal(
      await readFile(path.join(root, byId), 'utf8'),
      [
        '---',
        'id: one',
        'title: One',
        'description: Describe the problem and why it matters.',
        'outcome: Describe the outcome and how you will measure it.',
        'status: proposed',
        'release: rel-first-release',
        '---',
        '',
      ].join('\n'),
    );

    const byFolder = await newDocument(root, {
      kind: 'item',
      slug: 'two',
      title: 'Two',
      set: 'getting-started',
      format: 'mdx',
    });
    assert.equal(byFolder, 'feature-sets/getting-started/items/two.mdx');
    assert.doesNotMatch(await readFile(path.join(root, byFolder), 'utf8'), /release:/);
  });

  void it('writes a planned release targeting today', async () => {
    const root = await blankWorkspace();
    const file = await newDocument(root, { kind: 'release', slug: 'v2', title: 'V2' });
    assert.equal(file, 'releases/v2.md');
    const source = await readFile(path.join(root, file), 'utf8');
    assert.match(source, /\nstatus: planned\n/);
    assert.match(source, new RegExp(`\\ntarget: ${TODAY}\\n`));
  });

  void it('validates the slug and title before touching the workspace', async () => {
    const missing = path.join(await home(), 'missing');
    for (const slug of ['Upper', '../escape', 'a--b', '-a', 'a-', 'a b', '', 'a\n']) {
      assert.equal(
        await failure(newDocument(missing, { kind: 'set', slug, title: 'T' })),
        'Use a lowercase slug made of letters, digits and single hyphens.',
        slug,
      );
    }

    assert.equal(
      await failure(newDocument(missing, { kind: 'set', slug: 'ok', title: ' \t' })),
      'Provide a nonblank title.',
    );
  });

  void it('rejects an ID already used by any document kind', async () => {
    const root = await blankWorkspace();
    assert.equal(
      await failure(newDocument(root, { kind: 'release', slug: 'item-first-item', title: 'X' })),
      'ID "item-first-item" already exists in the workspace.',
    );
    assert.equal(
      await failure(newDocument(root, { kind: 'set', slug: 'rel-first-release', title: 'X' })),
      'ID "rel-first-release" already exists in the workspace.',
    );
  });

  void it('rejects unknown, ambiguous and colliding parents', async () => {
    const root = await blankWorkspace();
    assert.equal(
      await failure(newDocument(root, { kind: 'item', slug: 'x', title: 'X', set: 'nope' })),
      'Cannot find a feature set with ID or folder "nope".',
    );
    assert.equal(
      await failure(
        newDocument(root, {
          kind: 'item',
          slug: 'x',
          title: 'X',
          set: 'getting-started',
          release: 'rel-missing',
        }),
      ),
      'Cannot find a release with ID "rel-missing".',
    );

    await mkdir(path.join(root, 'feature-sets', 'other'));
    await writeFile(
      path.join(root, 'feature-sets', 'other', 'README.md'),
      [
        '---',
        'id: getting-started',
        'title: Other',
        'description: D.',
        'outcome: O.',
        'pm: alex',
        'engineering_team: product',
        '---',
        '',
      ].join('\n'),
    );
    assert.equal(
      await failure(
        newDocument(root, { kind: 'item', slug: 'x', title: 'X', set: 'getting-started' }),
      ),
      '"getting-started" matches both a feature set ID and a different feature set folder.',
    );
  });

  void it('never overwrites a file that exists under a different ID', async () => {
    const root = await blankWorkspace();
    const existing = path.join(root, 'releases', 'later.md');
    await writeFile(existing, 'notes');
    assert.match(
      await failure(newDocument(root, { kind: 'release', slug: 'later', title: 'Later' })),
      /EEXIST/,
    );
    assert.equal(await readFile(existing, 'utf8'), 'notes');
  });

  void it('never adds a second README to a feature set folder in the other format', async () => {
    const root = await blankWorkspace();
    const folder = path.join(root, 'feature-sets', 'getting-started');
    const original = await readFile(path.join(folder, 'README.md'), 'utf8');
    assert.match(
      await failure(
        newDocument(root, { kind: 'set', slug: 'getting-started', title: 'X', format: 'mdx' }),
      ),
      /feature-sets\/getting-started\/README\.md already exists/,
    );
    await mkdir(path.join(root, 'feature-sets', 'other'));
    await writeFile(path.join(root, 'feature-sets', 'other', 'README.mdx'), 'notes');
    assert.match(
      await failure(newDocument(root, { kind: 'set', slug: 'other', title: 'Other' })),
      /feature-sets\/other\/README\.mdx already exists/,
    );
    assert.deepEqual(await readdir(folder), ['README.md', 'items']);
    assert.equal(await readFile(path.join(folder, 'README.md'), 'utf8'), original);
    assert.deepEqual(await readdir(path.join(root, 'feature-sets', 'other')), ['README.mdx']);
  });

  void it('asks for registry entries before scaffolding a feature set', async () => {
    const root = await home();
    await writeFile(
      path.join(root, 'roadmap.yaml'),
      'schema_version: 1\ntitle: T\npeople: {}\nteams:\n  core: Core\n',
    );
    assert.equal(
      await failure(newDocument(root, { kind: 'set', slug: 'a', title: 'A' })),
      'Add a person entry to the people registry in roadmap.yaml first.',
    );
    await writeFile(
      path.join(root, 'roadmap.yaml'),
      'schema_version: 1\ntitle: T\npeople:\n  sam:\n    name: Sam\nteams: {}\n',
    );
    assert.equal(
      await failure(newDocument(root, { kind: 'set', slug: 'a', title: 'A' })),
      'Add a team entry to the teams registry in roadmap.yaml first.',
    );
    await assert.rejects(stat(path.join(root, 'feature-sets')), { code: 'ENOENT' });
  });

  void it('reports workspace diagnostics instead of writing into an invalid workspace', async () => {
    const root = await home();
    await writeFile(path.join(root, 'roadmap.yaml'), 'schema_version: 99\n');
    const message = await failure(newDocument(root, { kind: 'release', slug: 'a', title: 'A' }));
    assert.match(message, /^roadmap\.yaml:\d+:\d+ error \[/);
    assert.match(message, /\n {2}Fix: /);
    await assert.rejects(stat(path.join(root, 'releases')), { code: 'ENOENT' });
  });

  void it('serializes concurrent scaffolds of the same ID so exactly one succeeds', async () => {
    const root = await blankWorkspace();
    const results = await Promise.allSettled([
      runPromise(scaffoldDocument(root, { kind: 'set', slug: 'shared', title: 'Shared' })),
      runPromise(scaffoldDocument(root, { kind: 'release', slug: 'shared', title: 'Shared' })),
    ]);
    assert.deepEqual(results.map((result) => result.status).toSorted(), ['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected);
    assert.equal(scaffoldMessage(rejected.reason), 'ID "shared" already exists in the workspace.');
    assert.ok(!(await readdir(root)).includes('.roadmap-new-lock'));
  });
});
