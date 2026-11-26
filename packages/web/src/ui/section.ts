import type { HtmlValue, SafeHtml } from './html.ts';

import { html } from './html.ts';

/**
 * Header of an index page: the title, a count, and optional actions on the right.
 *
 * @param title Page title, rendered as the only `<h1>`.
 * @param count Count line such as "5 items", announced when filters change it.
 * @param options Optional count hook attribute and actions.
 * @returns Page header markup.
 */
export function pageHead(
  title: string,
  count: string,
  options: { countHook?: SafeHtml; actions?: HtmlValue } = {},
): SafeHtml {
  return html`<header class="page-head">
    <div class="page-title">
      <h1>${title}</h1>
      <p class="page-count num" ${options.countHook ?? ''} role="status">${count}</p>
    </div>
    ${options.actions ? html`<div class="page-actions">${options.actions}</div>` : ''}
  </header>`;
}

/**
 * Formats a number with a singular or plural noun.
 *
 * @param value Number of records.
 * @param noun Singular noun.
 * @returns Count and noun, such as "1 item" or "3 items".
 */
export function countLabel(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
