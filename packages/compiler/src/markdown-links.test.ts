import type { TestContext } from 'node:test';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Diagnostic, Entity } from './model.ts';
import type { Position } from './source.ts';

import { LinkResolver } from './markdown-links.ts';
import { MediaCatalog } from './media.ts';

/**
 * Deployment base prefixed to every rewritten route.
 */
const BASE = '/roadmap/';

/**
 * Where each link is found: a line inside the first item.
 */
const AT: Position = { file: 'items/a.md', line: 12, column: 4 };

/**
 * The recognized documents and the anchors their headings define.
 */
const DOCS: Array<Pick<Entity, 'kind' | 'id' | 'source'> & { anchors: Set<string> }> = [
  { kind: 'item', id: 'item-a', source: 'items/a.md', anchors: new Set(['intro', 'café', 'main']) },
  { kind: 'item', id: 'item-b', source: 'items/b.md', anchors: new Set(['setup']) },
  { kind: 'set', id: 'set-billing', source: 'sets/billing/README.md', anchors: new Set<string>() },
  { kind: 'release', id: 'rel-summer', source: 'releases/summer.md', anchors: new Set<string>() },
];

/**
 * Creates a workspace with an image and a video next to the first item.
 */
async function workspace(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'items'));
  await sharp({ create: { width: 3, height: 2, channels: 3, background: 'white' } })
    .png()
    .toFile(join(root, 'items/preview.png'));
  await writeFile(join(root, 'items/demo.mp4'), 'video');
  const diagnostics: Array<Diagnostic> = [];
  const links = new LinkResolver(BASE, DOCS, new MediaCatalog(root, diagnostics), diagnostics);
  return { links, diagnostics };
}

/**
 * Reduces diagnostics to their rule and line.
 */
function rules(diagnostics: Array<Diagnostic>): Array<[string, number]> {
  return diagnostics.map(({ rule, line }) => [rule, line]);
}

void describe('LinkResolver', () => {
  void it('keeps safe external links and refuses other schemes, credentials and padding', async (t) => {
    const { links, diagnostics } = await workspace(t);
    for (const url of [
      'https://example.com/a?b#c',
      'HTTP://example.com',
      'mailto:team@example.com',
    ]) {
      assert.deepEqual(await links.resolve(url, 'link', AT), { href: url }, url);
    }

    for (const url of [
      'javascript:alert(1)',
      'ftp://example.com/file',
      'data:text/html,hi',
      'https://user:secret@example.com',
      'https://example.com/\u0007',
      String.raw`https://example.com\evil`,
      'https://example.com ',
      'https://[invalid/',
    ]) {
      assert.equal(await links.resolve(url, 'standalone', AT), undefined, url);
    }

    assert.equal(diagnostics.length, 8);
    assert.ok(diagnostics.every(({ rule }) => rule === 'unsafe-url'));
    assert.equal(diagnostics[0]?.message, 'The link "javascript:alert(1)" is not allowed.');
    assert.deepEqual(
      [diagnostics[0].file, diagnostics[0].line, diagnostics[0].column],
      ['items/a.md', 12, 4],
    );
  });

  void it('never repeats credentials from a refused URL', async (t) => {
    const { links, diagnostics } = await workspace(t);
    for (const [url, use] of [
      ['https://user:hunter2@example.com/', 'link'],
      ['HTTPS://admin:hunter2@example.com:8443/path?q=1', 'standalone'],
      ['https://user:hun@ter2@example.com/a.png', 'image'],
      ['https://user:hunter2 x@example.com/', 'link'],
      ['https:user:hunter2@example.com/', 'link'],
      [String.raw`https:\\user:hunter2@example.com/`, 'link'],
      ['//user:hunter2@example.com/', 'link'],
    ] as const) {
      assert.equal(await links.resolve(url, use, AT), undefined, url);
    }

    assert.equal(diagnostics.length, 7);
    assert.ok(diagnostics.every(({ rule }) => rule === 'unsafe-url'));
    assert.doesNotMatch(JSON.stringify(diagnostics), /hunter2|ter2|user:|admin:/);
    assert.equal(diagnostics[0]?.message, 'The link "https:***@example.com/" is not allowed.');
    assert.match(diagnostics[0].fix, /Remove the user name and password/);
  });

  void it('never loads a remote image', async (t) => {
    const { links, diagnostics } = await workspace(t);
    assert.equal(await links.resolve('https://example.com/a.png', 'image', AT), undefined);
    assert.equal(
      diagnostics[0]?.message,
      'The image URL "https://example.com/a.png" is not allowed.',
    );
  });

  void it('rewrites relative document links to stable routes, keeping queries and fragments', async (t) => {
    const { links, diagnostics } = await workspace(t);
    const cases = [
      ['b.md', `${BASE}items/item-b/`],
      ['./b.md#setup', `${BASE}items/item-b/#setup`],
      ['b.md?tab=1#setup', `${BASE}items/item-b/?tab=1#setup`],
      ['../sets/billing/README.md', `${BASE}sets/set-billing/`],
      ['../releases/summer.md?from=item', `${BASE}releases/rel-summer/?from=item`],
      ['../items/a.md', `${BASE}items/item-a/`],
      ['%62.md', `${BASE}items/item-b/`],
    ] as const;
    for (const [url, href] of cases) {
      assert.deepEqual(await links.resolve(url, 'link', AT), { href }, url);
    }

    assert.deepEqual(diagnostics, []);
  });

  void it('keeps same-page anchors short and moves reserved ones out of the page namespace', async (t) => {
    const { links, diagnostics } = await workspace(t);
    assert.deepEqual(await links.resolve('#intro', 'link', AT), { href: '#intro' });
    assert.deepEqual(await links.resolve('a.md#intro', 'link', AT), { href: '#intro' });
    assert.deepEqual(await links.resolve('#caf%C3%A9', 'link', AT), { href: '#caf%C3%A9' });
    assert.deepEqual(await links.resolve('#main', 'link', AT), { href: '#heading%3Amain' });
    assert.deepEqual(await links.resolve('?x=1#intro', 'link', AT), {
      href: `${BASE}items/item-a/?x=1#intro`,
    });
    assert.deepEqual(await links.resolve('', 'link', AT), { href: `${BASE}items/item-a/` });
    assert.deepEqual(diagnostics, []);
  });

  void it('reports anchors that no heading defines', async (t) => {
    const { links, diagnostics } = await workspace(t);
    assert.equal(await links.resolve('#missing', 'link', AT), undefined);
    assert.equal(await links.resolve('b.md#intro', 'link', AT), undefined);
    assert.deepEqual(rules(diagnostics), [
      ['broken-anchor', 12],
      ['broken-anchor', 12],
    ]);
    assert.equal(diagnostics[1]?.message, 'Heading "#intro" does not exist in items/b.md.');
  });

  void it('reports Markdown files that are not recognized documents', async (t) => {
    const { links, diagnostics } = await workspace(t);
    assert.equal(await links.resolve('notes.md', 'link', AT), undefined);
    assert.equal(await links.resolve('NOTES.MDX', 'standalone', AT), undefined);
    // A document is never an image, so the image use falls through to the Markdown check.
    assert.equal(await links.resolve('b.md', 'image', AT), undefined);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['broken-markdown-link', 'broken-markdown-link', 'broken-markdown-link'],
    );
  });

  void it('refuses absolute, escaping, hidden and malformed local paths', async (t) => {
    const { links, diagnostics } = await workspace(t);
    for (const url of [
      '/items/b.md',
      '../../outside.png',
      '.hidden/x.png',
      '%E0%A4%A.png',
      'b.md#%E0',
      'a%5Cb.png',
    ]) {
      assert.equal(await links.resolve(url, 'link', AT), undefined, url);
    }

    assert.equal(diagnostics.length, 6);
    assert.ok(diagnostics.every(({ rule }) => rule === 'unsafe-url'));
  });

  void it('publishes local media under the base, keeping queries and fragments', async (t) => {
    const { links, diagnostics } = await workspace(t);
    const image = await links.resolve('preview.png?v=2#frame', 'image', AT);
    assert.match(image?.href ?? '', /^\/roadmap\/media\/[a-f0-9]{16}\.png\?v=2#frame$/);
    assert.equal(image?.media?.kind, 'image');
    assert.deepEqual(image.media.dimensions, { width: 3, height: 2 });

    const video = await links.resolve('demo.mp4', 'standalone', AT);
    assert.match(video?.href ?? '', /^\/roadmap\/media\/[a-f0-9]{16}\.mp4$/);
    assert.equal(video?.media?.kind, 'video');
    assert.deepEqual(rules(diagnostics), [['missing-captions', 12]]);
  });

  void it('rejects a non-image used as an image and unsupported local files', async (t) => {
    const { links, diagnostics } = await workspace(t);
    assert.equal(await links.resolve('demo.mp4', 'image', AT), undefined);
    assert.equal(await links.resolve('report.pdf', 'link', AT), undefined);
    assert.equal(await links.resolve('absent.png', 'link', AT), undefined);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['invalid-image', 'unsupported-local-link', 'unreadable-asset'],
    );
    assert.equal(diagnostics[0]?.message, '"items/demo.mp4" is not an image.');
  });
});
