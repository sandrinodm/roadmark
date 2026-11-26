import type { Entity } from '@roadmark/compiler/model';

import type { SafeHtml } from './html.ts';

import { progress } from '../data.ts';
import { html } from './html.ts';

/**
 * Renders delivery progress as a full-width bar with a caption drawn from the same counts: done in
 * green, in progress in teal, the rest an empty track. "1 in progress · 0 of 2 done" says what the
 * bar shows. Cancelled work is left out of the total and counted separately.
 *
 * @param items Work being measured.
 * @param label Optional name of what is measured, such as "Exit items".
 * @returns Progress bar and its caption.
 */
export function progressBar(items: ReadonlyArray<Entity>, label?: string): SafeHtml {
  const { done, total, cancelled } = progress(items);
  const active = items.filter(({ status }) => status === 'in-progress').length;
  const name = label ? html`<span class="progress-label">${label}</span>` : '';
  const cancelledLabel =
    cancelled > 0 ? html`<span class="progress-extra num">${cancelled} cancelled</span>` : '';
  if (total === 0) {
    const empty = cancelled === 0 ? 'No items yet' : 'No active items';
    return html`<div class="progress" data-empty>
      ${name}<span class="progress-text">${empty}</span>${cancelledLabel}
    </div>`;
  }

  const noun = total === 1 ? 'item' : 'items';
  const summary = `${done} of ${total} ${noun} done${active ? `, ${active} in progress` : ''}`;
  return html`<div class="progress">
    ${name}<span
      class="progress-track"
      role="img"
      aria-label="${summary}"
      style="--done: ${share(done, total)}; --active: ${share(active, total)}"
      ><span class="progress-done"></span><span class="progress-active"></span
    ></span>
    <span class="progress-text num" aria-hidden="true">${caption(done, active, total)}</span
    >${cancelledLabel}
  </div>`;
}

/**
 * Words the counts the bar draws.
 *
 * @param done Finished items.
 * @param active Items in progress.
 * @param total Items that count towards the total.
 * @returns "Not started", "2 of 8 done" or "1 in progress · 0 of 2 done".
 */
function caption(done: number, active: number, total: number): string {
  if (done === 0 && active === 0) {
    return 'Not started';
  }

  const finished = `${done} of ${total} done`;
  return active > 0 ? `${active} in progress · ${finished}` : finished;
}

/**
 * Formats a part of the total as a CSS percentage.
 *
 * @param count Part.
 * @param total Whole, greater than zero.
 * @returns Percentage with two decimals.
 */
function share(count: number, total: number): string {
  return `${((count / total) * 100).toFixed(2)}%`;
}
