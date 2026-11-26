import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { publish } from './publish.ts';

const example = ATLAS_DIRECTORY;
const scratch: Array<string> = [];
const decodeSearchIndex = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ id: Schema.String, release: Schema.Array(Schema.String) })),
  ),
);

afterEach(async () => {
  for (const directory of scratch.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function workspace() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'roadmap-publish-test-'));
  scratch.push(home);
  const root = path.join(home, 'workspace');
  const out = path.join(home, 'site');
  await cp(example, root, { recursive: true });
  return { root, out, home };
}

async function digest(folder: string): Promise<string> {
  const hash = createHash('sha256');
  const names = (await readdir(folder, { recursive: true })).toSorted();
  for (const name of names) {
    const entries = await readdir(path.dirname(path.join(folder, name)), { withFileTypes: true });
    if (entries.find((file) => file.name === path.basename(name))?.isFile()) {
      hash.update(name).update(await readFile(path.join(folder, name)));
    }
  }

  return hash.digest('hex');
}

void describe('publishing a roadmap', () => {
  void it('produces byte-identical sites at different locations, including GIF posters and captions', async () => {
    const first = await workspace();
    const second = await workspace();
    const base = '/product/roadmap/';
    const model = await publish(first.root, first.out, base, true);
    assert.deepEqual(model.diagnostics, []);
    assert.ok(model.assets.some((asset) => asset.poster));
    const item = await readFile(path.join(first.out, 'items/item-guided-setup/index.html'), 'utf8');
    assert.match(item, /<video\b/);
    assert.match(item, /<track\b/);
    assert.match(item, /\/product\/roadmap\/items\/item-setup-events\/#event-contract/);
    await publish(second.root, second.out, base, true);
    assert.equal(await digest(first.out), await digest(second.out));
  });

  void it('keeps the last good build after invalid edits and removes stale pages on recovery', async () => {
    const { root, out } = await workspace();
    await publish(root, out, '/');
    const before = await digest(out);
    const source = path.join(root, 'feature-sets/onboarding/items/guided-setup.md');
    const original = await readFile(source, 'utf8');
    await writeFile(
      source,
      original.replace('release: rel-spring', 'release: rel-summer\nmilestone: ms-beta'),
    );
    const invalid = await publish(root, out, '/');
    assert.ok(
      invalid.diagnostics.some(
        (finding) => finding.severity === 'error' && finding.rule === 'removed-field',
      ),
    );
    assert.equal(await digest(out), before);
    await writeFile(source, original.replace('release: rel-spring', 'release: rel-summer'));
    await rm(path.join(root, 'feature-sets/onboarding/items/starter-templates.mdx'));
    const updated = await publish(root, out, '/');
    assert.ok(!updated.diagnostics.some((finding) => finding.severity === 'error'));
    const summer = await readFile(path.join(out, 'releases/rel-summer/index.html'), 'utf8');
    const spring = await readFile(path.join(out, 'releases/rel-spring/index.html'), 'utf8');
    assert.match(summer, /Guided workspace setup/);
    assert.doesNotMatch(spring, /Guided workspace setup/);
    const index = decodeSearchIndex(await readFile(path.join(out, 'search-index.json'), 'utf8'));
    assert.deepEqual(index.find((entry) => entry.id === 'item-guided-setup')?.release, [
      'rel-summer',
    ]);
    assert.ok(!index.some((entry) => entry.id === 'item-starter-templates'));
    const timeline = await readFile(path.join(out, 'timeline/index.html'), 'utf8');
    assert.match(timeline, /data-timeline-id="item-guided-setup"\s+data-zoom-release="rel-summer"/);
    const platform = await readFile(path.join(out, 'teams/platform/index.html'), 'utf8');
    assert.match(platform, /Summer billing release/);
    assert.doesNotMatch(platform, /Spring onboarding launch/);
    await assert.rejects(readFile(path.join(out, 'items/item-starter-templates/index.html')), {
      code: 'ENOENT',
    });
  });

  void it('restores the interrupted swap before reporting errors from a new build', async () => {
    const { root, out } = await workspace();
    await publish(root, out, '/');
    const canonical = await realpath(out);
    const before = await digest(out);
    const transaction = canonical + '.roadmap-transaction';
    await mkdir(transaction);
    await writeFile(path.join(transaction, 'owner'), canonical);
    await rename(out, path.join(transaction, 'previous'));
    await writeFile(path.join(root, 'roadmap.yaml'), 'broken: true');
    const result = await publish(root, out, '/');
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
    assert.equal(await digest(out), before);
  });

  void it('protects author files, source trees, aliases, and unrelated output directories', async () => {
    const { root, out, home } = await workspace();
    await mkdir(out);
    await writeFile(path.join(out, 'keep.txt'), 'keep');
    await assert.rejects(publish(root, out, '/'), /another source/);
    assert.equal(await readFile(path.join(out, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(publish(root, root, '/'), /overlaps/);
    await assert.rejects(publish(root, home, '/'), /overlaps/);
    const alias = path.join(home, 'alias');
    await symlink(path.join(root, 'feature-sets'), alias);
    await assert.rejects(
      publish(root, path.join(alias, 'onboarding', 'generated'), '/'),
      /overlaps/,
    );
  });

  void it('replaces an output only when its marker is a regular file naming roadmark', async () => {
    const { root, out, home } = await workspace();
    const valid = path.join(home, 'valid-marker.json');
    await writeFile(valid, '{"generator":"roadmark","version":1,"base":"/"}');
    const markers: ReadonlyArray<[string, (file: string) => Promise<void>]> = [
      ['another generator', (file) => writeFile(file, '{"generator":"other-tool","version":1}')],
      ['invalid JSON', (file) => writeFile(file, '{"generator":"roadmark"')],
      ['a symbolic link to a valid marker', (file) => symlink(valid, file)],
    ];
    for (const [label, write] of markers) {
      await rm(out, { recursive: true, force: true });
      await mkdir(out);
      await writeFile(path.join(out, 'keep.txt'), 'keep');
      await write(path.join(out, '.roadmark-site.json'));
      const linked = (await lstat(path.join(out, '.roadmark-site.json'))).isSymbolicLink();
      const before = await readFile(path.join(out, '.roadmark-site.json'), 'utf8');
      await assert.rejects(publish(root, out, '/'), /another source/, label);
      assert.deepEqual((await readdir(out)).toSorted(), ['.roadmark-site.json', 'keep.txt'], label);
      assert.equal(await readFile(path.join(out, 'keep.txt'), 'utf8'), 'keep', label);
      assert.equal(await readFile(path.join(out, '.roadmark-site.json'), 'utf8'), before, label);
      assert.equal(
        (await lstat(path.join(out, '.roadmark-site.json'))).isSymbolicLink(),
        linked,
        label,
      );
    }

    assert.equal(await readFile(valid, 'utf8'), '{"generator":"roadmark","version":1,"base":"/"}');
    // The same directory with a genuine marker is roadmark's own output and is replaced.
    await rm(path.join(out, '.roadmark-site.json'));
    await cp(valid, path.join(out, '.roadmark-site.json'));
    await publish(root, out, '/');
    await assert.rejects(readFile(path.join(out, 'keep.txt')), { code: 'ENOENT' });
  });
});
