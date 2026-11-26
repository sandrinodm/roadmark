import type { HtmlValue, SafeHtml } from './html.ts';

import { icon } from './glyph.ts';
import { html } from './html.ts';

/**
 * One fact in a rail. Empty values are left out.
 */
export type Fact = {
  /**
   * Visible term.
   */
  term: string;

  /**
   * Rendered value; empty renders nothing.
   */
  value: SafeHtml | '';

  /**
   * Whether the value is long (ownership, lists) and takes the full width of a narrow rail.
   */
  wide?: boolean;
};

/**
 * Renders facts as a definition list. On narrow screens the list has two columns, so short facts
 * such as Start and Target pair up and long ones span the row.
 *
 * @param facts Facts in display order.
 * @returns Definition list, or nothing when every value is empty.
 */
export function factList(facts: ReadonlyArray<Fact>): SafeHtml | '' {
  const entries = facts.flatMap(({ term, value, wide }) =>
    value === '' || value.value === ''
      ? []
      : [
          html`<div ${wide ? html`class="fact-wide"` : ''}>
            <dt>${term}</dt>
            <dd>${value}</dd>
          </div>`,
        ],
  );
  return entries.length > 0 ? html`<dl>${entries}</dl>` : '';
}

/**
 * Renders the rail beside a document: an optional head line (status and timeline link), then the
 * facts and any trailing links.
 *
 * @param head Status pill and the timeline link, kept on one line.
 * @param facts Facts in display order.
 * @param footer Links under the facts, such as previous and next release.
 * @returns Facts rail.
 */
export function factsRail(
  head: HtmlValue,
  facts: ReadonlyArray<Fact>,
  footer: HtmlValue = '',
): SafeHtml {
  return html`<aside class="facts" id="record-facts" aria-label="Facts">
    <div class="facts-head">${head}</div>
    ${factList(facts)} ${footer}
  </aside>`;
}

/**
 * Renders the "Show on timeline" style link at the head of a rail.
 *
 * @param href Timeline URL.
 * @param label Link text.
 * @returns Link that keeps the page's filters.
 */
export function timelineLink(href: string, label: string): SafeHtml {
  return html`<a class="facts-link" data-preserve-filters href="${href}"
    >${icon('timeline')}${label}</a
  >`;
}
