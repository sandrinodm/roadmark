import type { Root } from 'mdast';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeHtml, headingId, parseMarkdown } from './markdown.ts';

void describe('parseMarkdown', () => {
  void it('derives unique heading anchors from visible heading text', () => {
    const markdown = parseMarkdown(
      [
        '# Café au lait!',
        '## Café au lait',
        '## Café au lait',
        '### `code` and **bold** [link](x.md)',
        '## ???',
        '## Ünïcödé — dash_and-hyphen',
      ].join('\n\n'),
    );
    assert.deepEqual(
      [...markdown.headings.values()],
      [
        'café-au-lait',
        'café-au-lait-1',
        'café-au-lait-2',
        'code-and-bold-link',
        'section',
        'ünïcödé-dash_and-hyphen',
      ],
    );
    assert.deepEqual(markdown.anchors, new Set(markdown.headings.values()));
  });

  void it('normalizes decomposed characters before building an anchor', () => {
    const markdown = parseMarkdown('## Café');
    assert.deepEqual([...markdown.anchors], ['café']);
  });

  void it('keeps explicit element IDs and avoids them when generating heading anchors', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          data: { hProperties: { id: 'intro' } },
          children: [{ type: 'text', value: 'Lead.' }],
        },
        { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Intro' }] },
        {
          type: 'heading',
          depth: 2,
          data: { hProperties: { id: 'custom' } },
          children: [{ type: 'text', value: 'Named' }],
        },
      ],
    };
    const markdown = parseMarkdown(tree);
    assert.equal(markdown.tree, tree);
    assert.deepEqual(markdown.anchors, new Set(['intro', 'intro-1', 'custom']));
    assert.deepEqual([...markdown.headings.values()], ['intro-1', 'custom']);
  });

  void it('indexes the first link definition and footnote for each identifier', () => {
    const markdown = parseMarkdown(
      [
        'See [docs][Docs] and a note.[^n]',
        '[docs]: first.md "First"',
        '[DOCS]: second.md',
        '[^n]: First note.',
        '[^n]: Second note.',
      ].join('\n\n'),
    );
    assert.deepEqual([...markdown.definitions.keys()], ['docs']);
    const docs = markdown.definitions.get('docs');
    assert.equal(docs?.url, 'first.md');
    assert.equal(docs.title, 'First');
    assert.deepEqual([...markdown.footnotes.keys()], ['n']);
    assert.match(JSON.stringify(markdown.footnotes.get('n')), /First note/);
  });

  void it('extracts the visible text for search, including alt text and code', () => {
    const markdown = parseMarkdown(
      [
        '# Title',
        'Some *emphasis*, ~~struck~~ and `inline` text.  ',
        'After a break.',
        '![Diagram alt](d.png)',
        '- one\n- two',
        '> quoted',
        '| A | B |\n| - | - |\n| c | d |',
        '```ts\nconst x = 1;\n```',
        '<div>raw html</div>',
        '[hidden]: https://example.com',
      ].join('\n\n'),
    );
    for (const fragment of [
      'Title',
      'Some emphasis, struck and inline text.',
      'After a break.',
      'Diagram alt',
      'one two',
      'quoted',
      'A B c d',
      'const x = 1;',
    ]) {
      assert.ok(markdown.text.includes(fragment), fragment);
    }

    assert.doesNotMatch(markdown.text, /raw html|example\.com|hidden/);
    assert.equal(markdown.text, markdown.text.trim());
  });
});

void describe('headingId', () => {
  void it('moves authored IDs out of the namespaces the page and UI SDK generate', () => {
    assert.equal(headingId('ui-sdk-select-1-label'), 'heading:ui-sdk-select-1-label');
    assert.equal(headingId('request-2'), 'request-2');
    assert.equal(headingId('main'), 'heading:main');
    assert.equal(headingId('ui-sdk'), 'ui-sdk');
    assert.equal(headingId('delivery-status'), 'delivery-status');
  });

  void it('prefixes every reserved page landmark', () => {
    for (const id of ['search-title', 'record-brief', 'record-facts', 'record-work']) {
      assert.equal(headingId(id), `heading:${id}`);
    }

    assert.equal(headingId('roadmap-items'), 'heading:roadmap-items');
    assert.equal(headingId('scope-filters'), 'heading:scope-filters');
    assert.equal(headingId('main-ideas'), 'main-ideas');
  });
});

void describe('escapeHtml', () => {
  void it('escapes the five HTML-significant characters and nothing else', () => {
    assert.equal(
      escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`),
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
    assert.equal(escapeHtml('plain — text'), 'plain — text');
  });
});
