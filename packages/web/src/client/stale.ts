/**
 * Prefix of the session keys that mark a module whose missing chunk already reloaded the page.
 */
const MODULE_KEY = 'roadmap:stale:';

/**
 * Session key holding the time of the last automatic reload.
 */
const RELOADED_AT = 'roadmap:stale-reload-at';

/**
 * Shortest time between two automatic reloads of the page, whichever module failed.
 */
const RELOAD_INTERVAL_MS = 10_000;

/**
 * Tells the reader the page is out of date, once.
 */
function showNotice(): void {
  if (document.querySelector('[data-stale-notice]')) {
    return;
  }

  const notice = document.createElement('p');
  notice.className = 'stale-notice';
  notice.dataset['staleNotice'] = '';
  notice.setAttribute('role', 'alert');
  notice.textContent =
    'This page is out of date: the roadmap was republished. Reload the page to use search and filters.';
  document.querySelector('main')?.prepend(notice);
}

/**
 * Whether an automatic reload is allowed for a module: it has not reloaded the page already, and no
 * module reloaded it in the last ten seconds. Blocked storage allows none.
 *
 * @param name Module name.
 * @returns Whether to reload, after recording the reload.
 */
function claimReload(name: string): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (
      sessionStorage.getItem(MODULE_KEY + name) !== null ||
      Date.now() - last < RELOAD_INTERVAL_MS
    ) {
      return false;
    }

    sessionStorage.setItem(MODULE_KEY + name, String(Date.now()));
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recovers from a lazily loaded module whose chunk is gone, as after a republish replaced the
 * chunks an open page refers to: reload once, then explain instead of failing silently.
 *
 * @param name Module name, so each module reloads the page at most once until it loads.
 */
export function recoverFromStaleChunk(name: string): void {
  if (claimReload(name)) {
    location.reload();
  } else {
    showNotice();
  }
}

/**
 * Clears a module's reload marker once it has loaded, so a later republish can reload again.
 *
 * @param name Module name.
 */
export function chunkLoaded(name: string): void {
  try {
    sessionStorage.removeItem(MODULE_KEY + name);
  } catch {
    // Storage is blocked; there is no marker to clear.
  }
}

/**
 * Imports a lazily loaded module, recording success and recovering when its chunk is gone.
 *
 * @param name Module name for the reload guard.
 * @param load Dynamic import.
 * @returns The module, or undefined when it could not load.
 */
export async function loadModule<T>(name: string, load: () => Promise<T>): Promise<T | undefined> {
  try {
    const module = await load();
    chunkLoaded(name);
    return module;
  } catch {
    recoverFromStaleChunk(name);
    return undefined;
  }
}
