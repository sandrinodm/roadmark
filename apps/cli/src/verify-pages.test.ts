import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyPages } from './verify-pages.ts';

/**
 * Wraps body markup in a minimal HTML document.
 */
function page(body: string): string {
  return `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
}

/**
 * Runs the verifier over a set of files, treating every file as a published name.
 */
function verify(files: Record<string, string | Uint8Array>, base = '/', extra: Array<string> = []) {
  const map = new Map(Object.entries(files));
  verifyPages(map, new Set([...map.keys(), ...extra]), base);
}

void describe('verifyPages', () => {
  void it('accepts a consistent site under a subpath, with directory links, anchors and assets', () => {
    assert.doesNotThrow(() => {
      verify(
        {
          'index.html': page(
            [
              '<a href="/roadmap/items/a/#why">Why</a>',
              '<a href="items/a/">Relative</a>',
              '<a href="#top" id="top">Top</a>',
              '<img src="assets/caf%C3%A9.png" alt="">',
              '<video poster="/roadmap/assets/poster.webp"></video>',
              '<div data-index="search-index.json"></div>',
              '<a href="https://example.com/x">External</a>',
              '<a href="//cdn.example.com/x">Protocol-relative</a>',
              '<a href="mailto:pm@example.com">Mail</a>',
            ].join(''),
          ),
          'items/a/index.html': page('<h2 id="why">Why</h2><a href="../../">Home</a>'),
          'assets/site.css': new TextEncoder().encode(
            "body { background: url('../assets/poster.webp'); } @font-face { src: url( fonts/x.woff2 ); }",
          ),
          'search-index.json': '[{"href":"/roadmap/items/a/#why"},{"href":"/roadmap/"}]',
        },
        '/roadmap/',
        ['assets/café.png', 'assets/poster.webp', 'assets/fonts/x.woff2'],
      );
    });
  });

  void it('rejects a duplicate anchor on one page', () => {
    assert.throws(() => verify({ 'index.html': page('<h2 id="a"></h2><p id="a"></p>') }), {
      message: 'index.html contains duplicate anchor #a',
    });
  });

  void it('rejects links that leave the deployment base', () => {
    assert.throws(
      () => verify({ 'index.html': page('<a href="/elsewhere/">x</a>') }, '/roadmap/'),
      { message: 'index.html links outside the deployment base: /elsewhere/' },
    );
    assert.throws(() => verify({ 'index.html': page('<a href="../">x</a>') }, '/roadmap/'), {
      message: 'index.html links outside the deployment base: /',
    });
  });

  void it('rejects links to missing pages and assets from HTML, CSS and the search index', () => {
    assert.throws(() => verify({ 'index.html': page('<a href="items/b/">x</a>') }), {
      message: 'index.html links to a missing file: /items/b/',
    });
    assert.throws(() => verify({ 'index.html': page('<img src="/logo.svg" alt="">') }), {
      message: 'index.html links to a missing file: /logo.svg',
    });
    assert.throws(() => verify({ 'site.css': 'a { background: url("missing.png") }' }), {
      message: 'site.css links to a missing file: /missing.png',
    });
    assert.throws(() => verify({ 'search-index.json': '[{"href":"/items/gone/"}]' }), {
      message: 'search-index.json links to a missing file: /items/gone/',
    });
  });

  void it('rejects a link to a missing anchor on an HTML page only', () => {
    assert.throws(
      () =>
        verify({
          'index.html': page('<a href="items/a/#nope">x</a>'),
          'items/a/index.html': page('<h2 id="why"></h2>'),
        }),
      { message: 'index.html links to a missing anchor: /items/a/#nope' },
    );
    assert.throws(() => verify({ 'index.html': page('<a href="#missing">x</a>') }), {
      message: 'index.html links to a missing anchor: /index.html#missing',
    });
    assert.doesNotThrow(() => {
      verify({ 'index.html': page('<a href="notes.txt#line-4">x</a>') }, '/', ['notes.txt']);
    });
  });

  void it('decodes encoded anchors before matching them', () => {
    assert.doesNotThrow(() => {
      verify({ 'index.html': page('<h2 id="café">C</h2><a href="#caf%C3%A9">x</a>') });
    });
  });

  void it('rejects a search index that is not an array of hrefs', () => {
    assert.throws(() => verify({ 'search-index.json': '{"href":"/"}' }));
  });
});
