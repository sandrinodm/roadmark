import type { TestContext } from 'node:test';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Diagnostic } from './model.ts';
import type { Position } from './source.ts';

import { ASSET_FINGERPRINT_LENGTH, MediaCatalog } from './media.ts';

/**
 * Where each test reports finding a link.
 */
const AT: Position = { file: 'items/brief.md', line: 7, column: 3 };

/**
 * Creates a temporary workspace removed after the test.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Writes a file, creating its parent directories.
 */
async function put(root: string, file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

/**
 * Encodes a solid image of the given size and format.
 */
function image(width: number, height: number, format: 'png' | 'gif'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#113366' } })
    .toFormat(format)
    .toBuffer();
}

/**
 * Computes the published fingerprint of some bytes.
 */
function fingerprint(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, ASSET_FINGERPRINT_LENGTH);
}

/**
 * Reduces diagnostics to their severity, rule and location.
 */
function located(diagnostics: Array<Diagnostic>): Array<[string, string, string, number]> {
  return diagnostics.map(({ severity, rule, file, line }) => [severity, rule, file, line]);
}

void describe('MediaCatalog', () => {
  void it('fingerprints an image by its bytes and records its dimensions', async (t) => {
    const root = await workspace(t);
    const bytes = await image(6, 4, 'png');
    await put(root, 'items/preview.PNG', bytes);
    const diagnostics: Array<Diagnostic> = [];
    const catalog = new MediaCatalog(root, diagnostics);
    const media = await catalog.resolve('items/preview.PNG', AT, true);
    assert.deepEqual(diagnostics, []);
    const output = `media/${fingerprint(bytes)}.png`;
    assert.deepEqual(media, {
      kind: 'image',
      asset: { source: 'items/preview.PNG', output },
      captions: [],
      dimensions: { width: 6, height: 4 },
    });
    assert.deepEqual([...catalog.assets.keys()], [output]);
    assert.equal(catalog.assets.get(output), media.asset);
  });

  void it('reuses one entry per source and one asset per fingerprint', async (t) => {
    const root = await workspace(t);
    const bytes = await image(2, 2, 'png');
    await put(root, 'a.png', bytes);
    await put(root, 'copy/b.png', bytes);
    const catalog = new MediaCatalog(root, []);
    const first = await catalog.resolve('a.png', AT, false);
    const again = await catalog.resolve('a.png', AT, false);
    const copy = await catalog.resolve('copy/b.png', AT, false);
    assert.equal(again?.asset, first?.asset);
    assert.equal(copy?.asset.output, first?.asset.output);
    assert.equal(catalog.assets.size, 1);
  });

  void it('gives GIFs a poster still and warns about very large ones', async (t) => {
    const root = await workspace(t);
    const small = await image(3, 5, 'gif');
    await put(root, 'small.gif', small);
    await put(root, 'large.gif', Buffer.concat([small, Buffer.alloc(5 * 1024 * 1024)]));
    const diagnostics: Array<Diagnostic> = [];
    const catalog = new MediaCatalog(root, diagnostics);
    const gif = await catalog.resolve('small.gif', AT, true);
    assert.equal(gif?.kind, 'gif');
    assert.deepEqual(gif.asset, {
      source: 'small.gif',
      output: `media/${fingerprint(small)}.gif`,
      poster: `media/${fingerprint(small)}-poster.png`,
    });
    assert.deepEqual(gif.dimensions, { width: 3, height: 5 });
    assert.deepEqual(diagnostics, []);

    assert.equal((await catalog.resolve('large.gif', AT, true))?.kind, 'gif');
    assert.deepEqual(located(diagnostics), [['warning', 'large-gif', AT.file, AT.line]]);
  });

  void it('attaches one caption track per language to a standalone video', async (t) => {
    const root = await workspace(t);
    for (const file of [
      'items/demo.mp4',
      'items/demo.EN-us.vtt',
      // "iw" is the deprecated code for Hebrew, so it canonicalizes to the language already claimed.
      'items/demo.he.vtt',
      'items/demo.iw.vtt',
      'items/demo.nl.vtt',
      'items/demo.english.vtt',
      'items/demo.vtt',
      'items/demo.fr.txt',
      'items/demonstration.de.vtt',
    ]) {
      await put(root, file, file);
    }

    const diagnostics: Array<Diagnostic> = [];
    const catalog = new MediaCatalog(root, diagnostics);
    const video = await catalog.resolve('items/demo.mp4', AT, true);
    assert.deepEqual(diagnostics, []);
    assert.equal(video?.kind, 'video');
    assert.equal(video.dimensions, undefined);
    assert.deepEqual(
      video.captions.map(({ asset, language }) => [asset.source, language]),
      [
        ['items/demo.EN-us.vtt', 'en-US'],
        ['items/demo.he.vtt', 'he'],
        ['items/demo.nl.vtt', 'nl'],
      ],
    );
    assert.deepEqual(
      video.captions.map(({ asset }) => asset.output),
      [
        `media/${fingerprint('items/demo.EN-us.vtt')}.vtt`,
        `media/${fingerprint('items/demo.he.vtt')}.vtt`,
        `media/${fingerprint('items/demo.nl.vtt')}.vtt`,
      ],
    );
    assert.equal(catalog.assets.size, 4);
  });

  void it('looks for captions only for a standalone video and warns when there are none', async (t) => {
    const root = await workspace(t);
    await put(root, 'clip.webm', 'video');
    await put(root, 'clip.en.vtt', 'WEBVTT');
    await put(root, 'bare.mp4', 'video');
    const diagnostics: Array<Diagnostic> = [];
    const catalog = new MediaCatalog(root, diagnostics);
    assert.deepEqual((await catalog.resolve('clip.webm', AT, false))?.captions, []);
    assert.deepEqual((await catalog.resolve('bare.mp4', AT, true))?.captions, []);
    assert.deepEqual(located(diagnostics), [['warning', 'missing-captions', AT.file, AT.line]]);
    assert.match(diagnostics[0]?.fix ?? '', /demo\.en\.vtt/);
  });

  void it('serves a caption file linked on its own', async (t) => {
    const root = await workspace(t);
    await put(root, 'notes.vtt', 'WEBVTT');
    const media = await new MediaCatalog(root, []).resolve('notes.vtt', AT, true);
    assert.equal(media?.kind, 'caption');
    assert.equal(media.asset.output, `media/${fingerprint('WEBVTT')}.vtt`);
  });

  void it('rejects unsupported types and unreadable or linked files at the link', async (t) => {
    const root = await workspace(t);
    await put(root, 'real.png', await image(1, 1, 'png'));
    await put(root, 'broken.png', 'not an image');
    await put(root, 'doc.pdf', 'pdf');
    await symlink(join(root, 'real.png'), join(root, 'linked.png'));
    const diagnostics: Array<Diagnostic> = [];
    const catalog = new MediaCatalog(root, diagnostics);
    for (const file of ['doc.pdf', 'missing.png', 'linked.png', 'broken.png', '../real.png']) {
      assert.equal(await catalog.resolve(file, AT, true), undefined, file);
    }

    assert.deepEqual(
      diagnostics.map(({ rule, message }) => [rule, message]),
      [
        [
          'unsupported-local-link',
          '"doc.pdf" is neither a roadmapped Markdown document nor a supported media file.',
        ],
        ['unreadable-asset', 'Could not read the local asset "missing.png".'],
        ['unreadable-asset', 'Could not read the local asset "linked.png".'],
        ['unreadable-asset', 'Could not read the local asset "broken.png".'],
        ['unreadable-asset', 'Could not read the local asset "../real.png".'],
      ],
    );
    assert.equal(catalog.assets.size, 0);
  });
});
