import type { SiteData } from '../data.ts';

import { brandColorScheme } from '../brand.ts';
import { html } from '../ui/html.ts';

/**
 * Renders a page that moved: an immediate refresh to its new address and a visible link, so old
 * bookmarks work without JavaScript. Query strings on the old address are not carried over.
 *
 * @param data Workspace title and deployment prefix.
 * @param title Name of the page that moved.
 * @param target New address.
 * @returns Complete HTML document.
 */
export function movedPage(data: SiteData, title: string, target: string): string {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          name="color-scheme"
          content="${brandColorScheme(data.brand?.config.colors?.surface)}"
        />
        <meta http-equiv="refresh" content="0; url=${target}" />
        <link rel="canonical" href="${target}" />
        <title>${title} · ${data.workspace.title}</title>
        <link rel="stylesheet" href="${data.base}assets/site.css" />
      </head>
      <body>
        <main id="main" class="app-main">
          <p class="page-note">
            ${title} moved to <a href="${target}">${data.workspace.title}</a>.
          </p>
        </main>
      </body>
    </html> `.value;
}
