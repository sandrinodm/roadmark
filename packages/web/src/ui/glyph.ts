import type { SafeHtml } from './html.ts';
import type { IconName } from './icons.ts';

import { html, trustedHtml } from './html.ts';
import { iconMarkup } from './icons.ts';

/**
 * Renders a shared icon. The markup comes only from the constant paths in `icons.ts`.
 *
 * @param name Icon key.
 * @returns Decorative SVG.
 */
export function icon(name: IconName): SafeHtml {
  return trustedHtml(iconMarkup(name));
}

/**
 * Renders the kind glyph for a record: card for items, flag for releases, stack for feature sets,
 * silhouettes for people and teams.
 *
 * @param kind Record kind or directory entry.
 * @returns Decorative glyph in a tinted tile.
 */
export function kindGlyph(kind: IconName): SafeHtml {
  return html`<span class="glyph" data-kind="${kind}">${icon(kind)}</span>`;
}
