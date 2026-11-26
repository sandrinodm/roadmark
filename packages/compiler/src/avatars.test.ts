import type { TestContext } from 'node:test';
import type { Sharp } from 'sharp';

import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Diagnostic, Workspace } from './model.ts';
import type { Position } from './source.ts';

import { resolveAvatars } from './avatars.ts';

/**
 * Person details keyed by ID, as the workspace reader passes them.
 */
type People = NonNullable<Workspace['person_details']>;

/**
 * Locates an avatar field by encoding its path in the file name.
 */
function field(path: ReadonlyArray<PropertyKey>): Position {
  return { file: `people.yaml#${path.map(String).join('.')}`, line: 1, column: 1 };
}

/**
 * Creates a temporary workspace removed after the test.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-avatars-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Draws a wide image whose left half is red and right half is blue.
 */
function halves(): Sharp {
  const half = { width: 100, height: 100, channels: 3, background: '#ff0000' } as const;
  const blue = { create: { ...half, background: '#0000ff' } };
  return sharp({ create: { ...half, width: 200 } }).composite([{ input: blue, left: 100, top: 0 }]);
}

/**
 * Encodes a solid 8 pixel PNG frame.
 */
function frame(background: string): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background } })
    .png()
    .toBuffer();
}

/**
 * Reads the dominant channel of one pixel of a decoded image.
 */
async function colorAt(bytes: Uint8Array, x: number, y: number): Promise<'red' | 'blue' | 'other'> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  const [red = 0, , blue = 0] = data.subarray(offset, offset + 3);
  if (red > 200 && blue < 60) {
    return 'red';
  }

  return blue > 200 && red < 60 ? 'blue' : 'other';
}

/**
 * Resolves the avatars of the given people, collecting diagnostics.
 */
async function resolve(root: string, people: People) {
  const diagnostics: Array<Diagnostic> = [];
  const assets = await resolveAvatars(root, people, field, diagnostics);
  return { assets, diagnostics };
}

void describe('resolveAvatars', () => {
  void it('publishes a square 128 pixel WebP cropped from the center of the portrait', async (t) => {
    const root = await workspace(t);
    await halves().png().toFile(join(root, 'wide.png'));
    const people: People = { alex: { avatar: 'wide.png', role: 'PM' }, stevie: {} };
    const { assets, diagnostics } = await resolve(root, people);
    assert.deepEqual(diagnostics, []);
    assert.equal(assets.length, 1);
    const [asset] = assets;
    assert.ok(asset?.bytes);
    assert.equal(asset.source, 'wide.png');
    assert.match(asset.output, /^avatars\/[a-f0-9]{16}\.webp$/);
    const metadata = await sharp(asset.bytes).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 128, 128]);
    assert.equal(await colorAt(asset.bytes, 4, 64), 'red');
    assert.equal(await colorAt(asset.bytes, 123, 64), 'blue');
    assert.deepEqual(people, { alex: { avatar: asset.output, role: 'PM' }, stevie: {} });
  });

  void it('applies the EXIF orientation before cropping', async (t) => {
    const root = await workspace(t);
    // Orientation 6 displays the image rotated a quarter turn clockwise: left becomes top.
    await halves().jpeg().withMetadata({ orientation: 6 }).toFile(join(root, 'turned.jpg'));
    const people: People = { alex: { avatar: 'turned.jpg' } };
    const [asset] = (await resolve(root, people)).assets;
    assert.ok(asset?.bytes);
    assert.equal(await colorAt(asset.bytes, 64, 4), 'red');
    assert.equal(await colorAt(asset.bytes, 64, 123), 'blue');
  });

  void it('shares one thumbnail between people and between files with the same pixels', async (t) => {
    const root = await workspace(t);
    const image = sharp({ create: { width: 10, height: 10, channels: 3, background: 'teal' } });
    const bytes = await image.png().toBuffer();
    await writeFile(join(root, 'a.png'), bytes);
    await writeFile(join(root, 'b.png'), bytes);
    const people: People = {
      a: { avatar: 'a.png' },
      b: { avatar: 'a.png' },
      c: { avatar: 'b.png' },
    };
    const { assets, diagnostics } = await resolve(root, people);
    assert.deepEqual(diagnostics, []);
    assert.equal(assets.length, 1);
    assert.equal(people['a']?.avatar, assets[0]?.output);
    assert.equal(people['b']?.avatar, assets[0]?.output);
    assert.equal(people['c']?.avatar, assets[0]?.output);
  });

  void it('accepts JPEG content under either JPEG extension', async (t) => {
    const root = await workspace(t);
    const jpeg = await halves().jpeg().toBuffer();
    await writeFile(join(root, 'a.jpg'), jpeg);
    await writeFile(join(root, 'b.jpeg'), jpeg);
    const { assets, diagnostics } = await resolve(root, {
      a: { avatar: 'a.jpg' },
      b: { avatar: 'b.jpeg' },
    });
    assert.deepEqual(diagnostics, []);
    assert.equal(assets.length, 1);
  });

  void it('rejects mismatched, animated, missing, linked and corrupt portraits at the field', async (t) => {
    const root = await workspace(t);
    await writeFile(join(root, 'png-named.jpg'), await frame('red'));
    const animated = await sharp([await frame('red'), await frame('blue')], {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    await writeFile(join(root, 'animated.webp'), animated);
    await writeFile(join(root, 'corrupt.png'), 'not an image');
    await writeFile(join(root, 'real.png'), await frame('green'));
    await symlink(join(root, 'real.png'), join(root, 'linked.png'));
    const people: People = {
      mismatch: { avatar: 'png-named.jpg' },
      animated: { avatar: 'animated.webp' },
      missing: { avatar: 'missing.png', role: 'Kept' },
      linked: { avatar: 'linked.png' },
      corrupt: { avatar: 'corrupt.png' },
      escaping: { avatar: '../real.png' },
    };
    const { assets, diagnostics } = await resolve(root, people);
    assert.deepEqual(assets, []);
    assert.deepEqual(
      diagnostics.map(({ severity, rule, file }) => [severity, rule, file]),
      Object.keys(people).map((id) => ['error', 'unreadable-avatar', `people.yaml#${id}.avatar`]),
    );
    assert.equal(diagnostics[2]?.message, 'Could not load the avatar "missing.png" for "missing".');
    assert.ok(Object.values(people).every((details) => details.avatar === undefined));
    assert.deepEqual(people['missing'], { role: 'Kept' });
  });
});
