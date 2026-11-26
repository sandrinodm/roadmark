import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import { assertSameNode, installDom, loadPage } from './test-dom.ts';

installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { chunkLoaded, loadModule, recoverFromStaleChunk } = await import('./stale.ts');

/**
 * Times the page reloaded itself.
 */
let reloads = 0;

/**
 * A dynamic import whose chunk is gone after a republish.
 *
 * @returns Never; always rejects.
 */
async function missingChunk(): Promise<never> {
  throw new TypeError('Failed to fetch dynamically imported module');
}

/**
 * The out-of-date notices on the page.
 *
 * @returns Notice elements.
 */
function notices(): Array<HTMLElement> {
  return [...document.querySelectorAll<HTMLElement>('[data-stale-notice]')];
}

void describe('stale chunk recovery', () => {
  beforeEach(() => {
    reloads = 0;
    mock.method(location, 'reload', () => {
      reloads += 1;
    });
    loadPage('<main><h1>Roadmap</h1></main>');
  });

  void it('returns a module that loads and clears its reload marker', async () => {
    sessionStorage.setItem('roadmap:stale:palette', '1');
    const module = await loadModule('palette', async () => ({ openPalette: 'loaded' }));
    assert.deepEqual(module, { openPalette: 'loaded' });
    assert.equal(sessionStorage.getItem('roadmap:stale:palette'), null);
    assert.equal(reloads, 0);
  });

  void it('reloads once for a missing chunk, then explains instead', async () => {
    assert.equal(await loadModule('palette', missingChunk), undefined);
    assert.equal(reloads, 1);
    assert.notEqual(sessionStorage.getItem('roadmap:stale:palette'), null);
    assert.deepEqual(notices(), []);

    assert.equal(await loadModule('palette', missingChunk), undefined);
    assert.equal(reloads, 1, 'the module already reloaded the page');
    const [notice] = notices();
    assert.equal(notice?.getAttribute('role'), 'alert');
    assert.match(notice.textContent, /out of date/);
    assertSameNode(document.querySelector('main')?.firstElementChild, notice);
  });

  void it('shows the notice once however often modules fail', () => {
    sessionStorage.setItem('roadmap:stale:timeline', '1');
    recoverFromStaleChunk('timeline');
    recoverFromStaleChunk('timeline');
    assert.equal(notices().length, 1);
  });

  void it('allows no second reload within ten seconds, even for another module', () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    recoverFromStaleChunk('palette');
    assert.equal(reloads, 1);
    mock.timers.tick(9999);
    recoverFromStaleChunk('gallery');
    assert.equal(reloads, 1);
    assert.equal(notices().length, 1);
    mock.timers.tick(1);
    recoverFromStaleChunk('gallery');
    assert.equal(reloads, 2, 'ten seconds later another module may reload');
  });

  void it('lets a module reload again after it has loaded once', () => {
    mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
    recoverFromStaleChunk('filter-chips');
    mock.timers.tick(10_000);
    chunkLoaded('filter-chips');
    recoverFromStaleChunk('filter-chips');
    assert.equal(reloads, 2);
  });

  void it('never reloads when session storage is blocked', async () => {
    mock.method(sessionStorage, 'getItem', () => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    mock.method(sessionStorage, 'removeItem', () => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    assert.doesNotThrow(() => chunkLoaded('palette'));
    assert.equal(await loadModule('palette', missingChunk), undefined);
    assert.equal(reloads, 0);
    assert.equal(notices().length, 1);
  });

  void it('skips the notice on a page without a main region', () => {
    loadPage('<p>No main</p>');
    sessionStorage.setItem('roadmap:stale:palette', '1');
    recoverFromStaleChunk('palette');
    assert.deepEqual(notices(), []);
  });
});
