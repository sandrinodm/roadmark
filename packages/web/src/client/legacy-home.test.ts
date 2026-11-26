import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import { atlasFile, installDom, loadPage, setUrl } from './test-dom.ts';

/**
 * The rendered home page (Releases), which forwards old Items links.
 */
const home = await atlasFile('index.html');
installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { forwardLegacyItemsLinks } = await import('./legacy-home.ts');

/**
 * URLs the page was sent to with `location.replace`.
 */
let forwarded: Array<string> = [];

/**
 * Shows the home page at a URL and runs the forwarding check.
 *
 * @param path Path, query and fragment.
 * @returns Whether the page is navigating away.
 */
function visit(path: string): boolean {
  loadPage(home, path);
  return forwardLegacyItemsLinks();
}

void describe('forwardLegacyItemsLinks', () => {
  beforeEach(() => {
    forwarded = [];
    mock.method(location, 'replace', (url: string | URL) => {
      forwarded.push(String(url));
    });
  });

  void it('renders the forwarding target and the Items anchors on the home page', () => {
    loadPage(home);
    const root = document.querySelector<HTMLElement>('[data-items-forward]');
    assert.equal(root?.dataset['itemsForward'], '/items/');
    assert.match(root.dataset['itemsAnchors'] ?? '', /\bbrowse\b/);
  });

  void it('stays on a plain home page and on pages without the forwarding root', () => {
    assert.equal(visit('/'), false);
    loadPage('<main></main>', '/sets/?q=billing');
    assert.equal(forwardLegacyItemsLinks(), false);
    assert.deepEqual(forwarded, []);
  });

  void it('forwards the Items search q with its filters and fragment', () => {
    assert.equal(visit('/?q=setup&type=item#results'), true);
    assert.deepEqual(forwarded, ['/items/?q=setup&type=item#results']);
  });

  void it('forwards search=1 or any filter parameter, dropping search=1', () => {
    assert.equal(visit('/?search=1'), true);
    assert.equal(visit('/?search=1&team=growth'), true);
    assert.equal(visit('/?release=rel-spring'), true);
    assert.deepEqual(forwarded, ['/items/', '/items/?team=growth', '/items/?release=rel-spring']);
  });

  void it('forwards an Items fragment the home page does not render', () => {
    assert.equal(visit('/#browse'), true);
    assert.deepEqual(forwarded, ['/items/#browse']);
  });

  void it('stays for a fragment the home page renders itself or does not know', () => {
    loadPage(home);
    const own = document.querySelector('[id]')?.id ?? '';
    assert.notEqual(own, '');
    assert.equal(visit(`/#${own}`), false);
    assert.equal(visit('/#somewhere-else'), false);
    assert.deepEqual(forwarded, []);
  });

  void it('tolerates a malformed escape in the fragment', () => {
    assert.equal(visit('/#%E0%A4%A'), false);
    assert.deepEqual(forwarded, []);
  });

  void it('never takes over a URL carrying the palette’s own state', () => {
    assert.equal(visit('/?search=palette&q=setup'), false);
    assert.equal(visit('/?search=filters&type=item'), false);
    assert.equal(visit('/?pq=setup&type=item'), false);
    assert.deepEqual(forwarded, []);
  });

  void it('forwards after an in-page fragment change', () => {
    assert.equal(visit('/'), false);
    setUrl('/#browse');
    dispatchEvent(new HashChangeEvent('hashchange'));
    // Every earlier visit in this file left its own listener behind, and each forwards the same way.
    assert.notEqual(forwarded.length, 0);
    assert.deepEqual(new Set(forwarded), new Set(['/items/#browse']));
  });
});
