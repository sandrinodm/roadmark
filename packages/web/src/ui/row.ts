import type { HtmlValue, SafeHtml } from './html.ts';

import { html } from './html.ts';

/**
 * Content of one list row.
 */
export type RowParts = {
  /**
   * Leading glyph or avatar.
   */
  lead?: HtmlValue;

  /**
   * Title, usually a link; the first link in the title makes the whole row clickable.
   */
  title: HtmlValue;

  /**
   * Inline extras beside the title, such as a status pill.
   */
  badges?: HtmlValue;

  /**
   * One muted summary line, truncated.
   */
  summary?: string | undefined;

  /**
   * Secondary content under the summary, such as related links or role tags.
   */
  detail?: HtmlValue;

  /**
   * Right-aligned metadata: progress, dates, owners.
   */
  meta?: HtmlValue;

  /**
   * Extra attributes for filters, such as `data-filter-entry`.
   */
  attributes?: SafeHtml | undefined;

  /**
   * Element name; list rows are `li`, stand-alone records may use `article`.
   */
  tag?: 'li' | 'article';
};

/**
 * Renders a row: glyph, semibold title, one muted summary line, meta on the right. Hover tints the
 * whole row and the title link covers it, so the row is one target.
 *
 * @param parts Row content.
 * @returns Row markup.
 */
export function row(parts: RowParts): SafeHtml {
  const content = html`${parts.lead ? html`<span class="row-lead">${parts.lead}</span>` : ''}
    <div class="row-main">
      <div class="row-title">${parts.title}${parts.badges ?? ''}</div>
      ${parts.summary ? html`<p class="row-summary">${parts.summary}</p>` : ''}
      ${parts.detail ? html`<div class="row-detail">${parts.detail}</div>` : ''}
    </div>
    ${parts.meta ? html`<div class="row-meta">${parts.meta}</div>` : ''}`;
  return parts.tag === 'article'
    ? html`<article class="row" ${parts.attributes ?? ''}>${content}</article>`
    : html`<li class="row" ${parts.attributes ?? ''}>${content}</li>`;
}

/**
 * Wraps rows in one flat surface, or shows the empty state.
 *
 * @param rows Rendered rows.
 * @param empty What to say when there are none, ideally what to do about it.
 * @param label Optional accessible name for the list.
 * @returns List or empty-state markup.
 */
export function rowList(rows: ReadonlyArray<SafeHtml>, empty: string, label?: string): SafeHtml {
  if (rows.length === 0) {
    return html`<p class="empty">${empty}</p>`;
  }

  return html`<ul class="list" role="list" ${label ? html`aria-label="${label}"` : ''}>
    ${rows}
  </ul>`;
}
