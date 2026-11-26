import type { TestContext } from 'node:test';

import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Asset, Diagnostic } from './model.ts';

import { readBrand } from './brand.ts';

/**
 * Creates a temporary workspace removed after the test.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-brand-'));
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
function image(width: number, height: number, format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2457a6' } })
    .toFormat(format)
    .toBuffer();
}

/**
 * Builds the smallest byte string that passes the WOFF2 header check.
 */
function woff2(length = 64): Buffer {
  const bytes = Buffer.alloc(length);
  bytes.write('wOF2', 0, 'ascii');
  bytes.writeUInt32BE(length, 8);
  return bytes;
}

/**
 * Reads the brand file, collecting diagnostics and published assets.
 */
async function read(root: string) {
  const diagnostics: Array<Diagnostic> = [];
  const assets = new Map<string, Asset>();
  const brand = await Effect.runPromise(readBrand(root, diagnostics, assets));
  return { brand, diagnostics, assets };
}

void describe('readBrand', () => {
  void it('is optional', async (t) => {
    const root = await workspace(t);
    assert.deepEqual(await read(root), { brand: undefined, diagnostics: [], assets: new Map() });
  });

  void it('reports an invalid brand file and returns nothing', async (t) => {
    const root = await workspace(t);
    await put(root, 'brand.yaml', 'schema_version: 1\ncolors:\n  text: red\n');
    const { brand, diagnostics } = await read(root);
    assert.equal(brand, undefined);
    assert.deepEqual(
      diagnostics.map(({ rule, file, line, column }) => [rule, file, line, column]),
      [['invalid-field', 'brand.yaml', 3, 3]],
    );
  });

  void it('fingerprints fonts, licenses, the logo and the background', async (t) => {
    const root = await workspace(t);
    await put(root, 'brand/logo.png', await image(60, 20, 'png'));
    await put(root, 'brand/paper.jpg', await image(4, 4, 'jpeg'));
    await put(root, 'fonts/body.woff2', woff2());
    await put(root, 'fonts/display.woff2', woff2(80));
    await put(root, 'fonts/OFL.txt', 'SIL Open Font License\n');
    await put(
      root,
      'brand.yaml',
      [
        'schema_version: 1',
        'colors: { accent: "#2457a6" }',
        'typography:',
        '  body: { font: { family: Body, file: fonts/body.woff2, license: fonts/OFL.txt } }',
        '  display: { font: { family: Display, file: fonts/display.woff2 } }',
        '  header: { font: { family: System } }',
        'header: { logo: { file: brand/logo.png, height: 32 } }',
        'background: { image: brand/paper.jpg, fit: tile }',
      ].join('\n'),
    );
    const { brand, diagnostics, assets } = await read(root);
    assert.deepEqual(diagnostics, []);
    assert.ok(brand);
    assert.equal(brand.config.colors?.accent, '#2457a6');
    const output = (source: string) =>
      [...assets.values()].find((asset) => asset.source === source)?.output;
    assert.deepEqual(brand.fonts, {
      body: { file: output('fonts/body.woff2'), license: output('fonts/OFL.txt') },
      display: { file: output('fonts/display.woff2') },
    });
    assert.deepEqual(brand.logo, { output: output('brand/logo.png'), width: 96, height: 32 });
    assert.equal(brand.background, output('brand/paper.jpg'));
    assert.equal(assets.size, 5);
    for (const [key, asset] of assets) {
      assert.equal(key, asset.output);
      assert.match(asset.output, /^media\/[a-f0-9]{16}\.(?:woff2|txt|png|jpg)$/);
    }
  });

  void it('sizes the logo from the default height and an authored aspect ratio', async (t) => {
    const root = await workspace(t);
    await put(root, 'logo.webp', await image(10, 40, 'webp'));
    await put(root, 'brand.yaml', 'schema_version: 1\nheader: { logo: { file: logo.webp } }\n');
    assert.deepEqual((await read(root)).brand?.logo?.width, 8);
    assert.equal((await read(root)).brand?.logo?.height, 30);

    await put(
      root,
      'brand.yaml',
      'schema_version: 1\nheader: { logo: { file: logo.webp, aspect: 2.5 } }\n',
    );
    assert.deepEqual((await read(root)).brand?.logo?.width, 75);

    await put(
      root,
      'brand.yaml',
      'schema_version: 1\nheader: { logo: { file: logo.webp, height: 16, aspect: 0.1 } }\n',
    );
    // The width is rounded to whole pixels.
    assert.deepEqual((await read(root)).brand?.logo?.width, 2);
  });

  void it('rejects assets that do not match their declared format at their fields', async (t) => {
    const root = await workspace(t);
    await put(root, 'jpeg-named.png', await image(4, 4, 'jpeg'));
    await put(root, 'png-named.webp', await image(4, 4, 'png'));
    await put(root, 'bad.woff2', 'wOF2 too short');
    await put(root, 'empty.txt', '  \n');
    await put(root, 'real.woff2', woff2());
    await symlink(join(root, 'real.woff2'), join(root, 'linked.woff2'));
    await put(
      root,
      'brand.yaml',
      [
        'schema_version: 1',
        'typography:',
        '  body: { font: { family: Body, file: bad.woff2 } }',
        '  display: { font: { family: Display, file: real.woff2, license: empty.txt } }',
        '  header: { font: { family: Header, file: linked.woff2 } }',
        'header: { logo: { file: jpeg-named.png } }',
        'background: { image: png-named.webp }',
      ].join('\n'),
    );
    const { brand, diagnostics } = await read(root);
    assert.deepEqual(
      diagnostics.map(({ rule, line, column }) => [rule, line, column]),
      [
        ['unreadable-brand-asset', 3, 33],
        ['unreadable-brand-asset', 4, 57],
        ['unreadable-brand-asset', 5, 37],
        ['unreadable-brand-asset', 6, 19],
        ['unreadable-brand-asset', 7, 15],
      ],
    );
    assert.equal(
      diagnostics[0]?.message,
      'Could not read the brand asset "bad.woff2" in its declared format.',
    );
    assert.ok(brand);
    // The font survives its unreadable license; nothing else resolves.
    const display = brand.fonts.display?.file;
    assert.ok(display);
    assert.deepEqual(brand.fonts, { display: { file: display } });
    assert.equal(brand.logo, undefined);
    assert.equal(brand.background, undefined);
  });

  void it('rejects WOFF2 files whose declared length is wrong and licenses that are not text', async (t) => {
    const root = await workspace(t);
    const truncated = woff2(64);
    truncated.writeUInt32BE(65, 8);
    await put(root, 'truncated.woff2', truncated);
    await put(root, 'ok.woff2', woff2());
    await put(root, 'binary.txt', new Uint8Array([0x4c, 0x00, 0x49]));
    await put(root, 'latin1.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    await put(
      root,
      'brand.yaml',
      [
        'schema_version: 1',
        'typography:',
        '  body: { font: { family: Body, file: truncated.woff2 } }',
        '  display: { font: { family: Display, file: ok.woff2, license: binary.txt } }',
        '  header: { font: { family: Header, file: ok.woff2, license: latin1.txt } }',
      ].join('\n'),
    );
    const { diagnostics } = await read(root);
    assert.deepEqual(
      diagnostics.map(({ line }) => line),
      [3, 4, 5],
    );
    assert.ok(diagnostics.every(({ rule }) => rule === 'unreadable-brand-asset'));
  });

  void it('rejects an animated logo', async (t) => {
    const root = await workspace(t);
    const first = await image(8, 8, 'png');
    const second = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    // Distinct frames, because the encoder collapses identical ones into a still image.
    const animated = await sharp([first, second], { join: { animated: true } })
      .webp()
      .toBuffer();
    await put(root, 'logo.webp', animated);
    await put(root, 'brand.yaml', 'schema_version: 1\nheader: { logo: { file: logo.webp } }\n');
    const { brand, diagnostics } = await read(root);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['unreadable-brand-asset'],
    );
    assert.equal(brand?.logo, undefined);
  });
});
