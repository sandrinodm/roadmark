import type { TestContext } from 'node:test';

import { compile } from '@roadmark/compiler/compile';
import { ATLAS_URL } from '@roadmark/test-fixtures';
import { renderSite } from '@roadmark/web/render';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import { publish } from './publish.ts';

const BASE = '/product/atlas/';
const WORKSPACE = 'schema_version: 1\ntitle: Test roadmap\npeople: {}\nteams: {}\n';

void describe('workspace branding', () => {
  void it('uses the built-in mark and stylesheet when brand.yaml is absent', async (t) => {
    const root = await workspace(t);
    const model = await compile(root, BASE);
    const files = await renderSite(model, BASE);
    assert.deepEqual(model.diagnostics, []);
    assert.equal(model.brand, undefined);
    assert.equal(files.has('assets/brand.css'), false);
    assert.match(String(files.get('index.html')), /src="\/product\/atlas\/assets\/mark\.svg"/);
  });

  void it('publishes a local logo and background under the deployment base', async (t) => {
    const root = await workspace(t);
    await writeFile(
      join(root, 'brand.yaml'),
      [
        'schema_version: 1',
        'colors:',
        '  accent: "#2468AC"',
        'typography:',
        '  body:',
        '    tracking: 0.02',
        '    line_height: 1.5',
        '  header:',
        '    font:',
        '      family: Bricolage Grotesque',
        'header:',
        '  logo:',
        '    file: wordmark.png',
        '    height: 24',
        '    show_title: false',
        'background:',
        '  image: wordmark.png',
        '  fit: tile',
      ].join('\n'),
    );
    const imagePath = join(root, 'wordmark.png');
    await sharp({ create: { width: 30, height: 10, channels: 3, background: '#012345' } })
      .png()
      .toFile(imagePath);

    const out = join(root, 'site');
    const model = await publish(root, out, BASE);
    assert.deepEqual(model.diagnostics, []);
    const [asset] = model.assets;
    assert.ok(asset);
    assert.equal(model.assets.length, 1);
    assert.match(asset.output, /^media\/[a-f\d]{16}\.png$/);
    assert.deepEqual(await readFile(join(out, asset.output)), await readFile(imagePath));

    const html = await readFile(join(out, 'timeline/index.html'), 'utf8');
    assert.ok(html.includes(`href="${BASE}assets/brand.css"`));
    assert.ok(html.includes(`src="${BASE}${asset.output}" alt="" width="72" height="24"`));
    assert.doesNotMatch(html, /<span>Test roadmap<\/span>\s*<\/a>/);
    assert.match(html, /aria-label="Test roadmap home"/);

    const css = await readFile(join(out, 'assets/brand.css'), 'utf8');
    assert.ok(css.includes(`--page-background-image: url("../${asset.output}")`));
    assert.match(css, /--page-background-repeat: repeat/);
    assert.match(css, /--body-tracking: 0\.02em/);
    assert.match(css, /--body-line-height: 1\.5/);
    assert.match(css, /--header: "Bricolage Grotesque"/);
  });

  void it('publishes a shared local font and its license once for several roles', async (t) => {
    const root = await workspace(t);
    const example = new URL('brand/', ATLAS_URL);
    const license = await readFile(new URL('inter-tight-ofl.txt', example));
    await copyFile(new URL('inter-tight.woff2', example), join(root, 'family.woff2'));
    await writeFile(join(root, 'license.txt'), license);
    const font = [
      '    font:',
      '      family: Inter Tight',
      '      file: family.woff2',
      '      weight: [100, 900]',
      '      license: license.txt',
    ];
    await writeFile(
      join(root, 'brand.yaml'),
      ['schema_version: 1', 'typography:', '  body:', ...font, '  header:', ...font].join('\n'),
    );

    const out = join(root, 'site');
    const model = await publish(root, out, BASE);
    assert.deepEqual(model.diagnostics, []);
    assert.equal(model.assets.length, 2);
    const terms = model.assets.find(({ source }) => source === 'license.txt');
    assert.ok(terms);
    assert.deepEqual(await readFile(join(out, terms.output)), license);

    const css = await readFile(join(out, 'assets/brand.css'), 'utf8');
    assert.equal([...css.matchAll(/@font-face/g)].length, 1);
    assert.equal(css.split(`../${terms.output}`).length, 2);
    assert.match(css, /--header: "Inter Tight"/);
  });

  void it('rejects unknown settings, arbitrary CSS and paths outside the workspace', async (t) => {
    const root = await workspace(t);
    await writeFile(
      join(root, 'brand.yaml'),
      [
        'schema_version: 1',
        'colors:',
        '  accent: "var(--anything)"',
        '  unknown: "#123"',
        'typography:',
        '  body:',
        '    font:',
        '      family: "Body; background: red"',
        '      file: "https://example.com/body.woff2"',
        '      weight: [900, 100]',
        'header:',
        '  logo:',
        '    file: "../logo.png"',
      ].join('\n'),
    );
    const { brand, assets, diagnostics } = await compile(root);
    assert.equal(brand, undefined);
    assert.deepEqual(assets, []);
    assert.deepEqual(
      diagnostics.map(({ file, line }) => [file, line]),
      [3, 4, 8, 9, 10, 13].map((line) => ['brand.yaml', line]),
    );
  });

  void it('pinpoints missing, symlinked and mislabeled brand assets', async (t) => {
    const root = await workspace(t);
    await writeFile(
      join(root, 'brand.yaml'),
      [
        'schema_version: 1',
        'typography:',
        '  display:',
        '    font:',
        '      family: Display',
        '      file: missing.woff2',
        'header:',
        '  logo:',
        '    file: link.png',
        'background:',
        '  image: disguised.png',
      ].join('\n'),
    );
    const disguised = join(root, 'disguised.png');
    await writeFile(disguised, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"/>');
    await symlink(disguised, join(root, 'link.png'));
    const { assets, diagnostics } = await compile(root);
    assert.deepEqual(assets, []);
    assert.deepEqual(
      diagnostics.map(({ file, line, rule }) => [file, line, rule]),
      [6, 9, 11].map((line) => ['brand.yaml', line, 'unreadable-brand-asset']),
    );
  });
});

async function workspace(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-brand-')));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'roadmap.yaml'), WORKSPACE);
  return root;
}
