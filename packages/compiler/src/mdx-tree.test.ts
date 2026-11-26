import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mdxTree } from './mdx-tree.ts';

void describe('mdxTree', () => {
  void it('turns paragraphs and headings into Markdown nodes with their authored IDs', () => {
    const tree = mdxTree('<h3 id="plan" class="wide lead">Plan</h3><p>Hello <em>there</em></p>');
    assert.deepEqual(tree, {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 3,
          data: { hProperties: { id: 'plan', className: ['wide', 'lead'] } },
          children: [{ type: 'text', value: 'Plan' }],
        },
        {
          type: 'paragraph',
          data: { hProperties: { id: undefined, className: undefined } },
          children: [
            { type: 'text', value: 'Hello ' },
            {
              type: 'roadmapElement',
              data: { hProperties: { id: undefined, className: undefined } },
              open: '<em>',
              close: '</em>',
              children: [{ type: 'text', value: 'there' }],
            },
          ],
        },
      ],
    });
  });

  void it('restores code fences with their language, options and source position', () => {
    const [code] = mdxTree(
      '<pre data-roadmap-line="7" data-roadmap-column="3"><code class="x language-ts" data-code-meta="title=&quot;a.ts&quot;">const a = 1;\n</code></pre>',
    ).children;
    assert.deepEqual(code, {
      type: 'code',
      lang: 'ts',
      meta: 'title="a.ts"',
      value: 'const a = 1;',
      position: { start: { line: 7, column: 3 }, end: { line: 7, column: 3 } },
    });
  });

  void it('keeps a code element without a language as an untyped fence', () => {
    const [code] = mdxTree('<pre><code>plain</code></pre>').children;
    assert.deepEqual(code, { type: 'code', lang: '', meta: '', value: 'plain' });
  });

  void it('maps images, links and videos to the nodes the link checker resolves', () => {
    const [paragraph, video, unlabelled] = mdxTree(
      [
        '<p><img src="a.png" alt="A" title="T" data-roadmap-line="2"><a href="b.md" title="B" data-roadmap-line="3" data-roadmap-column="4">B</a></p>',
        '<video src="demo.mp4" aria-label="Demo"></video>',
        '<video src="other.webm"></video>',
      ].join(''),
    ).children;
    assert.deepEqual(paragraph?.type === 'paragraph' && paragraph.children, [
      {
        type: 'image',
        url: 'a.png',
        alt: 'A',
        title: 'T',
        position: { start: { line: 2, column: 1 }, end: { line: 2, column: 1 } },
      },
      {
        type: 'link',
        url: 'b.md',
        title: 'B',
        data: { hProperties: { id: undefined, className: undefined } },
        children: [{ type: 'text', value: 'B' }],
        position: { start: { line: 3, column: 4 }, end: { line: 3, column: 4 } },
      },
    ]);
    assert.deepEqual(video, {
      type: 'paragraph',
      children: [{ type: 'link', url: 'demo.mp4', children: [{ type: 'text', value: 'Demo' }] }],
    });
    assert.deepEqual(unlabelled, {
      type: 'paragraph',
      children: [{ type: 'link', url: 'other.webm', children: [{ type: 'text', value: 'Video' }] }],
    });
  });

  void it('keeps other elements as raw markup, moving reserved IDs and dropping location data', () => {
    const [aside, anchor, breakNode] = mdxTree(
      '<aside id="main" class="roadmap-callout" data-roadmap-line="4"><strong>Risk</strong><p>Body</p></aside><a name="x">No href</a><br>',
    ).children;
    assert.ok(aside?.type === 'roadmapElement');
    assert.equal(aside.open, '<aside id="heading:main" class="roadmap-callout">');
    assert.equal(aside.close, '</aside>');
    assert.deepEqual(
      aside.children.map((child) => child.type),
      ['roadmapElement', 'paragraph'],
    );
    assert.deepEqual(aside.data, {
      hProperties: { id: 'main', className: ['roadmap-callout'] },
    });

    assert.ok(anchor?.type === 'roadmapElement');
    assert.equal(anchor.open, '<a name="x">');

    assert.ok(breakNode?.type === 'roadmapElement');
    assert.equal(breakNode.open, '<br>');
    assert.equal(breakNode.close, '');
  });

  void it('drops preload links and comments and keeps top-level text', () => {
    const tree = mdxTree('<link rel="preload" href="font.woff2"><!-- note -->loose text');
    assert.deepEqual(tree.children, [{ type: 'text', value: 'loose text' }]);
  });
});
