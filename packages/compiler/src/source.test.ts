import type { TestContext } from 'node:test';

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import type { Diagnostic } from './model.ts';

import { nodeServices } from './platform.ts';
import { schemaFor } from './schemas.ts';
import { compareNames, discover, fileExists, readSource, safeFile } from './source.ts';

const example = ATLAS_DIRECTORY;

/**
 * Creates an empty temporary workspace removed after the test.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Writes a file, creating its parent directories.
 */
async function put(root: string, file: string, content = ''): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

/**
 * Runs discovery with the Node platform services.
 */
async function discoverIn(root: string) {
  const diagnostics: Array<Diagnostic> = [];
  const files = await Effect.runPromise(
    discover(root, diagnostics).pipe(Effect.provide(nodeServices)),
  );
  return { files, diagnostics };
}

void describe('discover', () => {
  void it('returns a fresh result each time the same effect runs', async () => {
    const files = discover(example, []).pipe(Effect.provide(nodeServices));
    const first = await Effect.runPromise(files);
    const count = first.length;
    const second = await Effect.runPromise(files);
    assert.ok(count > 0);
    assert.equal(second.length, count);
    assert.equal(first.length, count);
    assert.notEqual(first, second);
  });

  void it('classifies the authoring layout in name order and warns about misplaced Markdown', async (t) => {
    const root = await workspace(t);
    for (const file of [
      'feature-sets/billing/README.md',
      'feature-sets/billing/explainer.md',
      'feature-sets/billing/items/invoices.md',
      'feature-sets/billing/items/LOUD.MD',
      'feature-sets/billing/items/notes.txt',
      'feature-sets/billing/items/.draft.md',
      'feature-sets/billing/items/nested/deep.md',
      'feature-sets/Bad_Set/README.mdx',
      'releases/summer.md',
      'releases/2027/old.md',
      'elsewhere/ignored.md',
    ]) {
      await put(root, file);
    }

    await symlink(join(root, 'releases/summer.md'), join(root, 'releases/link.md'));
    const { files, diagnostics } = await discoverIn(root);
    assert.deepEqual(files, [
      { file: 'feature-sets/Bad_Set/README.mdx', kind: 'set', setDirectory: 'Bad_Set' },
      { file: 'feature-sets/billing/README.md', kind: 'set', setDirectory: 'billing' },
      { file: 'feature-sets/billing/items/invoices.md', kind: 'item', setDirectory: 'billing' },
      { file: 'releases/summer.md', kind: 'release' },
    ]);
    assert.deepEqual(
      diagnostics.map(({ severity, rule, file, line, column }) => [
        severity,
        rule,
        file,
        line,
        column,
      ]),
      [
        ['warning', 'misplaced-markdown', 'feature-sets/billing/explainer.md', 1, 1],
        ['warning', 'misplaced-markdown', 'feature-sets/billing/items/LOUD.MD', 1, 1],
        ['warning', 'misplaced-markdown', 'feature-sets/billing/items/nested/deep.md', 1, 1],
        ['warning', 'misplaced-markdown', 'releases/2027/old.md', 1, 1],
        ['error', 'unsafe-path', 'releases/link.md', 1, 1],
      ],
    );
  });

  void it('is silent about missing content folders and rejects folders that are not directories', async (t) => {
    const root = await workspace(t);
    assert.deepEqual(await discoverIn(root), { files: [], diagnostics: [] });

    await put(root, 'feature-sets');
    await mkdir(join(root, 'elsewhere'));
    await symlink(join(root, 'elsewhere'), join(root, 'releases'));
    const { diagnostics } = await discoverIn(root);
    assert.deepEqual(
      diagnostics.map(({ rule, file }) => [rule, file]),
      [
        ['unsafe-path', 'feature-sets'],
        ['unsafe-path', 'releases'],
      ],
    );
  });

  void it('fails a workspace that still has a milestones folder, even an empty one', async (t) => {
    const root = await workspace(t);
    await mkdir(join(root, 'milestones'));
    const { diagnostics } = await discoverIn(root);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.rule, 'removed-milestones');
    assert.equal(diagnostics[0].file, 'milestones');
    assert.match(diagnostics[0].fix, /Delete the milestones\/ folder/);
  });
});

void describe('fileExists', () => {
  void it('is false only for a missing entry', async (t) => {
    const root = await workspace(t);
    await put(root, 'roadmap.yaml', 'title: x\n');
    await symlink(join(root, 'nowhere.yaml'), join(root, 'dangling.yaml'));
    assert.equal(await fileExists(root, 'missing.yaml'), false);
    assert.equal(await fileExists(root, 'roadmap.yaml'), true);
    // The reader must diagnose a link or a path through a file, so both count as present.
    assert.equal(await fileExists(root, 'dangling.yaml'), true);
    assert.equal(await fileExists(root, 'roadmap.yaml/child'), true);
  });
});

void describe('safeFile', () => {
  void it('resolves a regular nested file to its absolute path', async (t) => {
    const root = await workspace(t);
    await put(root, 'a/b/c.txt', 'x');
    assert.equal(await safeFile(root, 'a/b/c.txt'), join(root, 'a', 'b', 'c.txt'));
  });

  void it('refuses links anywhere on the path, directories and missing files', async (t) => {
    const root = await workspace(t);
    await put(root, 'real/file.txt', 'x');
    await symlink(join(root, 'real/file.txt'), join(root, 'link.txt'));
    await symlink(join(root, 'real'), join(root, 'linked'));
    await assert.rejects(safeFile(root, 'link.txt'), /without symbolic links/);
    await assert.rejects(safeFile(root, 'linked/file.txt'), /without symbolic links/);
    await assert.rejects(safeFile(root, 'real'), /without symbolic links/);
    await assert.rejects(safeFile(root, 'real/file.txt/more'), /without symbolic links/);
    await assert.rejects(safeFile(root, 'real/absent.txt'), { code: 'ENOENT' });
  });

  void it('refuses paths that are not normalized and relative', async (t) => {
    const root = await workspace(t);
    await put(root, 'real/file.txt', 'x');
    for (const file of [
      '../real/file.txt',
      'real/../real/file.txt',
      './real/file.txt',
      'real//file.txt',
      '/real/file.txt',
      String.raw`real\file.txt`,
      '',
    ]) {
      await assert.rejects(safeFile(root, file), /normalized workspace-relative path/, file);
    }
  });
});

void describe('compareNames', () => {
  void it('orders by UTF-16 code units regardless of locale', () => {
    assert.equal(compareNames('same', 'same'), 0);
    assert.equal(compareNames('B', 'a'), -1);
    assert.equal(compareNames('a', 'B'), 1);
    assert.equal(compareNames('z', 'é'), -1);
    assert.equal(compareNames('item-10', 'item-9'), -1);
    assert.deepEqual(['b', 'A', '_', 'a', '1'].toSorted(compareNames), ['1', 'A', '_', 'a', 'b']);
  });
});

void describe('readSource', () => {
  void it('reads and decodes a regular workspace file', async (t) => {
    const root = await workspace(t);
    await put(root, 'teams.yaml', 'core: Core\n');
    const diagnostics: Array<Diagnostic> = [];
    const source = await Effect.runPromise(
      readSource(root, 'teams.yaml', schemaFor('teams'), { diagnostics, frontMatter: false }),
    );
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(source?.data, { core: 'Core' });
    assert.equal(source.file, 'teams.yaml');
  });

  void it('reports a missing or linked file as unreadable at its first character', async (t) => {
    const root = await workspace(t);
    await put(root, 'real.yaml', 'core: Core\n');
    await symlink(join(root, 'real.yaml'), join(root, 'teams.yaml'));
    for (const file of ['teams.yaml', 'people.yaml']) {
      const diagnostics: Array<Diagnostic> = [];
      const source = await Effect.runPromise(
        readSource(root, file, schemaFor('teams'), { diagnostics, frontMatter: false }),
      );
      assert.equal(source, undefined);
      assert.deepEqual(
        diagnostics.map(({ rule, file: at, line, column, message }) => [
          rule,
          at,
          line,
          column,
          message,
        ]),
        [['unreadable-source', file, 1, 1, `Could not read ${file} as a regular workspace file.`]],
      );
    }
  });

  void it('passes decoding problems through as field diagnostics', async (t) => {
    const root = await workspace(t);
    await put(root, 'items.md', '---\nid: a\n---\n');
    const diagnostics: Array<Diagnostic> = [];
    const source = await Effect.runPromise(
      readSource(root, 'items.md', schemaFor('item'), { diagnostics, frontMatter: true }),
    );
    assert.equal(source, undefined);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ rule }) => rule === 'invalid-field'));
  });
});
