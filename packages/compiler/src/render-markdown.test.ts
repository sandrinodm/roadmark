import type { Root } from 'mdast';
import type { TestContext } from 'node:test';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Diagnostic } from './model.ts';

import { CodeBlocks } from './code-blocks.ts';
import { LinkResolver } from './markdown-links.ts';
import { parseMarkdown } from './markdown.ts';
import { MediaCatalog } from './media.ts';
import { renderMarkdown } from './render-markdown.ts';

/**
 * Deployment base prefixed to rewritten links and media.
 */
const BASE = '/b/';

/**
 * The brief being rendered.
 */
const FILE = 'items/brief.md';

/**
 * Lines of front matter before the body, added to every reported line.
 */
const LINE_OFFSET = 10;

/**
 * Creates a workspace with an image, a GIF and a captioned video beside the brief.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-render-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'items'));
  const solid = sharp({ create: { width: 3, height: 2, channels: 3, background: 'white' } });
  await solid.clone().png().toFile(join(root, 'items/preview.png'));
  await solid.clone().gif().toFile(join(root, 'items/anim.gif'));
  await writeFile(join(root, 'items/demo.mp4'), 'video');
  await writeFile(join(root, 'items/demo.en.vtt'), 'WEBVTT');
  await writeFile(join(root, 'items/demo.nl.vtt'), 'WEBVTT\n');
  return root;
}

/**
 * Renders a Markdown body (or a prepared tree) as the brief, with one other item to link to.
 */
async function render(root: string, body: string | Root) {
  const diagnostics: Array<Diagnostic> = [];
  const markdown = parseMarkdown(body);
  const docs = [
    { kind: 'item' as const, id: 'brief', source: FILE, anchors: markdown.anchors },
    { kind: 'item' as const, id: 'other', source: 'items/other.md', anchors: new Set(['setup']) },
  ];
  const media = new MediaCatalog(root, diagnostics);
  const html = await renderMarkdown({
    markdown,
    blocks: new CodeBlocks(root, []),
    file: FILE,
    lineOffset: LINE_OFFSET,
    base: BASE,
    links: new LinkResolver(BASE, docs, media, diagnostics),
    diagnostics,
  });
  return { html, diagnostics, media };
}

/**
 * Finds the published path of a workspace file in the media catalog.
 */
function published(media: MediaCatalog, source: string): string {
  return BASE + ([...media.assets.values()].find((asset) => asset.source === source)?.output ?? '');
}

void describe('renderMarkdown', () => {
  void it('renders blocks with body-level headings, escaped text and line breaks', async (t) => {
    const { html, diagnostics } = await render(
      await workspace(t),
      '# Top\n\nText with `a<b` and <i>x</i> & more.\n\n***\n\none  \ntwo\n\n#### Deep\n\n## Main',
    );
    assert.deepEqual(diagnostics, []);
    assert.equal(
      html,
      [
        '<h2 id="top">Top</h2>',
        '<p>Text with <code>a&lt;b</code> and &lt;i&gt;x&lt;/i&gt; &amp; more.</p>',
        '<hr>',
        '<p>one<br>\ntwo</p>',
        '<h4 id="deep">Deep</h4>',
        '<h2 id="heading:main">Main</h2>',
      ].join('\n'),
    );
  });

  void it('renders emphasis, quotes, lists with start numbers and task items', async (t) => {
    const { html } = await render(
      await workspace(t),
      '> *a* **b** ~~c~~\n\n3. three\n4. four\n\nBreak.\n\n1. one\n\n- [x] done\n- [ ] open\n- plain',
    );
    assert.match(
      html,
      /^<blockquote><p><em>a<\/em> <strong>b<\/strong> <del>c<\/del><\/p><\/blockquote>/,
    );
    assert.match(html, /<ol start="3"><li><p>three<\/p><\/li><li><p>four<\/p><\/li><\/ol>/);
    assert.match(html, /<ol><li><p>one<\/p><\/li><\/ol>/);
    assert.match(
      html,
      /<ul><li class="task-list-item"><input type="checkbox" disabled checked aria-label="Task status"><p>done<\/p><\/li>/,
    );
    assert.match(
      html,
      /<li class="task-list-item"><input type="checkbox" disabled aria-label="Task status"><p>open<\/p><\/li>/,
    );
    assert.match(html, /<li><p>plain<\/p><\/li><\/ul>$/);
  });

  void it('renders tables with a header row and column alignment', async (t) => {
    const { html } = await render(
      await workspace(t),
      '| A | B | C |\n| :- | -: | - |\n| 1 | **2** | 3 |',
    );
    assert.equal(
      html,
      '<table><thead><tr><th align="left">A</th><th align="right">B</th><th>C</th></tr></thead><tbody><tr><td align="left">1</td><td align="right"><strong>2</strong></td><td>3</td></tr></tbody></table>',
    );
  });

  void it('links footnote references to the first definition only', async (t) => {
    const { html } = await render(
      await workspace(t),
      'Claim.[^n]\n\n[^n]: First.\n\n[^n]: Second.',
    );
    assert.match(html, /<sup><a href="#footnote:bg">n<\/a><\/sup>/);
    assert.match(html, /<aside id="footnote:bg"><p>First\.<\/p><\/aside>/);
    assert.doesNotMatch(html, /Second/);
  });

  void it('resolves inline, reference and standalone links and keeps the label of broken ones', async (t) => {
    const { html, diagnostics } = await render(
      await workspace(t),
      [
        'Read [setup](other.md#setup "Setup steps") or [ref][r].',
        '',
        '[Standalone](https://example.com)',
        '',
        'Broken [label](javascript:alert(1)) here.',
        '',
        '[Broken standalone](missing.md)',
        '',
        '[r]: other.md',
      ].join('\n'),
    );
    assert.equal(
      html,
      [
        '<p>Read <a href="/b/items/other/#setup" title="Setup steps">setup</a> or <a href="/b/items/other/">ref</a>.</p>',
        '<p><a href="https://example.com">Standalone</a></p>',
        '<p>Broken label here.</p>',
        '<p>Broken standalone</p>',
        '',
      ].join('\n'),
    );
    assert.deepEqual(
      diagnostics.map(({ rule, file, line, column }) => [rule, file, line, column]),
      [
        ['unsafe-url', FILE, 15, 8],
        ['broken-markdown-link', FILE, 17, 1],
      ],
    );
  });

  void it('wraps images in a link to the full size and captions standalone ones', async (t) => {
    const { html, diagnostics, media } = await render(
      await workspace(t),
      'Inline ![Alt](preview.png) image.\n\n![Alt](preview.png "Caption")\n\n[![Alt](preview.png)](other.md)',
    );
    assert.deepEqual(diagnostics, []);
    const src = published(media, 'items/preview.png');
    const img = (title = '') =>
      `<img loading="lazy" src="${src}" alt="Alt"${title} width="3" height="2">`;
    assert.equal(
      html,
      [
        `<p>Inline <a href="${src}">${img()}</a> image.</p>`,
        `<figure><a href="${src}">${img(' title="Caption"')}</a><figcaption>Caption</figcaption></figure>`,
        `<p><a href="/b/items/other/">${img()}</a></p>`,
      ].join('\n'),
    );
  });

  void it('warns about missing alt text and falls back to the alt text of unresolved images', async (t) => {
    const { html, diagnostics } = await render(
      await workspace(t),
      '![](preview.png)\n\n![Remote <chart>](https://example.com/chart.png)',
    );
    assert.match(html, /<figure><a href="[^"]+"><img loading="lazy" src="[^"]+" alt="" width="3"/);
    assert.match(html, /\nRemote &lt;chart&gt;$/);
    assert.deepEqual(
      diagnostics.map(({ severity, rule, line }) => [severity, rule, line]),
      [
        ['warning', 'missing-alt', 11],
        ['error', 'unsafe-url', 13],
      ],
    );
  });

  void it('shows GIFs as a still poster that plays on demand', async (t) => {
    const { html, media } = await render(
      await workspace(t),
      '![Loop](anim.gif "Spinner")\n\nInline ![Loop](anim.gif) gif.\n\n[![Loop](anim.gif)](other.md)',
    );
    const gif = published(media, 'items/anim.gif');
    const poster = BASE + ([...media.assets.values()][0]?.poster ?? '');
    const still = `<img loading="lazy" src="${poster}" alt="Loop" width="3" height="2">`;
    const animated = `<img loading="lazy" src="${gif}" alt="Loop" width="3" height="2">`;
    const [standalone, inline, linked] = html.split('\n');
    assert.equal(
      standalone,
      `<figure><details class="gif"><summary>${still}<span class="gif-control"><span class="gif-play">Play animation</span><span class="gif-pause">Pause animation</span></span></summary>${animated}</details><figcaption>Spinner</figcaption></figure>`,
    );
    assert.equal(inline, `<p>Inline <a href="${gif}">${still}</a> gif.</p>`);
    assert.equal(linked, `<p><a href="/b/items/other/">${still}</a></p>`);
  });

  void it('embeds a standalone video link as a captioned player and keeps inline ones as links', async (t) => {
    const { html, media } = await render(
      await workspace(t),
      '[Walkthrough](demo.mp4)\n\nWatch [the demo](demo.mp4) later.',
    );
    const video = published(media, 'items/demo.mp4');
    const en = published(media, 'items/demo.en.vtt');
    const nl = published(media, 'items/demo.nl.vtt');
    const [player, inline] = html.split('\n');
    assert.equal(
      player,
      `<details class="video"><summary>Walkthrough</summary><div class="video-playback"><video controls preload="none" playsinline src="${video}"><track kind="captions" src="${en}" srclang="en" label="English" default><track kind="captions" src="${nl}" srclang="nl" label="Dutch"></video><a href="${video}" download>Download video</a></div></details>`,
    );
    assert.equal(inline, `<p>Watch <a href="${video}">the demo</a> later.</p>`);
  });

  void it('delegates fences to the code block renderer with the body line offset', async (t) => {
    const { html, diagnostics } = await render(
      await workspace(t),
      '```text\n<x>\n```\n\n```ts src="../missing.ts"\n```',
    );
    assert.equal(html, '<pre><code>&lt;x&gt;\n</code></pre>\n');
    assert.deepEqual(
      diagnostics.map(({ rule, line }) => [rule, line]),
      [['code-block', 15]],
    );
  });

  void it('keeps authored IDs and classes and the markup of custom elements', async (t) => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 1,
          data: { hProperties: { id: 'main', className: ['lead'] } },
          children: [{ type: 'text', value: 'Title' }],
        },
        {
          type: 'paragraph',
          data: { hProperties: { id: 'record-brief', className: ['note', 'wide'] } },
          children: [{ type: 'text', value: 'Body' }],
        },
        {
          type: 'roadmapElement',
          open: '<aside class="roadmap-callout">',
          close: '</aside>',
          children: [
            { type: 'text', value: 'Risk & ' },
            { type: 'link', url: 'other.md', children: [{ type: 'text', value: 'other' }] },
          ],
        },
      ],
    };
    const { html } = await render(await workspace(t), tree);
    assert.equal(
      html,
      [
        '<h2 id="heading:main" class="lead">Title</h2>',
        '<p id="heading:record-brief" class="note wide">Body</p>',
        '<aside class="roadmap-callout">Risk &amp; <a href="/b/items/other/">other</a></aside>',
      ].join('\n'),
    );
  });
});
