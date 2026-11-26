import { compile } from '@roadmark/compiler/compile';
import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { renderSite } from './render.ts';

const ATLAS = ATLAS_DIRECTORY;
const SITE = import.meta.dirname;
const BASE = '/roadmap/';

/**
 * Authored headings that name every section the renderer adds to a record page.
 */
const HEADINGS = [
  'Related work',
  'Depends on',
  'Required by',
  'Team requests',
  'Request 1',
  'Record brief',
  'Roadmap items',
  'Members',
  'Requests',
  'Milestones',
  'Release scope',
  'Links',
];

/**
 * IDs the renderer may place on a record page outside the brief. The content compiler rewrites
 * authored headings with these slugs to `heading:<slug>`, so they cannot collide.
 */
const RESERVED = new Set([
  'main',
  'record-brief',
  'record-facts',
  'record-work',
  'roadmap-items',
  'scope-filters',
]);

/**
 * Files allowed to call `trustedHtml`, and why.
 */
const TRUSTED_CALL_SITES = [
  // Compiled Markdown, the one trusted island in a page.
  'pages/record.ts',
  // Constant SVG paths from icons.ts.
  'ui/glyph.ts',
];

void describe('rendered markup safety', () => {
  let pages: Map<string, string>;
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'roadmap-anchors-'));
    await cp(ATLAS, workspace, { recursive: true });
    const sections = HEADINGS.map((heading) => `\n## ${heading}\n\nAuthored section.\n`).join('');
    for (const file of [
      'feature-sets/onboarding/items/guided-setup.md',
      'feature-sets/onboarding/README.md',
    ]) {
      await appendFile(path.join(workspace, file), sections);
    }

    // MDX headings may carry any explicit id, including ones shaped like generated control ids.
    const spring = path.join(workspace, 'releases/spring.mdx');
    await rename(path.join(workspace, 'releases/spring.md'), spring);
    await appendFile(
      spring,
      sections +
        '\n<h2 id="filter:status">Delivery status</h2>\n\n<h2 id="filter:release-value">Value</h2>\n',
    );

    const model = await compile(workspace, BASE);
    assert.deepEqual(model.diagnostics, []);
    const files = await renderSite(model, BASE);
    pages = new Map(
      [...files].flatMap(([file, value]) =>
        file.endsWith('.html') && typeof value === 'string' ? [[file, value]] : [],
      ),
    );
  });

  after(async () => rm(workspace, { recursive: true, force: true }));

  void it('never repeats an id, even when authored headings name generated sections', () => {
    for (const [file, page] of pages) {
      const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
      const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
      assert.deepEqual(repeated, [], file);
    }

    const item = pages.get('items/item-guided-setup/index.html') ?? '';
    assert.match(item, /<h2 id="related-work">Related work<\/h2>/);
  });

  void it('keeps generated ids on record pages inside the reserved set', () => {
    for (const [file, page] of pages) {
      if (!/^(items|releases|sets)\/[^/]+\/(items\/)?index\.html$/.test(file)) {
        continue;
      }

      const outside = withoutBrief(page);
      const generated = [...outside.matchAll(/\sid="([^"]+)"/g)].flatMap(([, id = '']) =>
        RESERVED.has(id) ? [] : [id],
      );
      assert.deepEqual(generated, [], file);
    }
  });

  void it('escapes author text exactly once', () => {
    for (const [file, page] of pages) {
      assert.doesNotMatch(page, /&amp;(?:lt|gt|amp|quot|#39);/, file);
    }
  });

  void it('trusts raw markup only for Markdown and constant icons', async () => {
    const sources = (await readdir(SITE, { recursive: true })).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'ui/html.ts',
    );
    const callers: Array<string> = [];
    for (const file of sources) {
      const source = await readFile(path.join(SITE, file), 'utf8');
      if (/\btrustedHtml\(/.test(source)) {
        callers.push(file.split(path.sep).join('/'));
      }
    }

    assert.deepEqual(callers.toSorted(), TRUSTED_CALL_SITES.toSorted());
    const record = await readFile(path.join(SITE, 'pages/record.ts'), 'utf8');
    assert.deepEqual(record.match(/trustedHtml\([^)]*\)/g), ['trustedHtml(body)']);
  });
});

/**
 * Removes the authored brief, the one element whose ids come from Markdown.
 */
function withoutBrief(page: string): string {
  const start = page.search(/<div\s+id="record-brief"/);
  if (start < 0) {
    return page;
  }

  let depth = 0;
  for (const match of page.slice(start).matchAll(/<\/?div\b/g)) {
    depth += match[0] === '<div' ? 1 : -1;
    if (depth === 0) {
      return page.slice(0, start) + page.slice(start + match.index);
    }
  }

  return page.slice(0, start);
}
