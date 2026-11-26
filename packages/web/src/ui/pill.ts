import type { SafeHtml } from './html.ts';

import { html } from './html.ts';
import { statusLabel, statusTone } from './status.ts';

/**
 * Renders a status as a dot and label on a soft tint of its semantic colour.
 *
 * @param status Canonical status; empty renders nothing.
 * @returns Status pill, or empty markup.
 */
export function statusPill(status: string): SafeHtml {
  if (!status) {
    return html``;
  }

  return html`<span class="pill" data-tone="${statusTone(status)}"
    ><span class="pill-dot"></span>${statusLabel(status)}</span
  >`;
}

/**
 * Renders a role or relationship label, such as "Contributor", as a quiet tag without a dot.
 *
 * @param label Visible label.
 * @returns Tag markup.
 */
export function tag(label: string): SafeHtml {
  return html`<span class="tag">${label}</span>`;
}
