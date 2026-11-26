import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { HtmlValue, SafeHtml } from './html.ts';

import { getStatus } from '../data.ts';
import { filterAttributes } from '../scope.ts';
import { html } from './html.ts';
import { entityLink, time } from './links.ts';
import { statusPill } from './pill.ts';
import { countLabel } from './section.ts';

/**
 * Renders the catalogue table: a column header row, then row groups or plain rows. Every element
 * keeps an explicit table role, because the stylesheet lays the table out as a grid.
 *
 * @param label Accessible name of the table.
 * @param column Header of the first column, such as "Item" or "Release".
 * @param body Row groups or a single row group.
 * @returns Table.
 */
export function catalogueTable(label: string, column: string, body: HtmlValue): SafeHtml {
  return html`<table class="catalogue-table" role="table" aria-label="${label}">
    <thead role="rowgroup">
      <tr role="row">
        <th scope="col" role="columnheader">${column}</th>
        <th scope="col" role="columnheader">Status</th>
        <th scope="col" role="columnheader">Target</th>
      </tr>
    </thead>
    ${body}
  </table>`;
}

/**
 * Parts of one row group.
 */
export type TableGroup = {
  /**
   * ID of the group heading, or undefined for a group without a banner.
   */
  id?: string;

  /**
   * Linked or plain banner title.
   */
  title?: HtmlValue;

  /**
   * Rows in the group.
   */
  rows: HtmlValue;

  /**
   * Number of rows, shown in the banner.
   */
  count: number;

  /**
   * Singular noun for the banner count, such as "item" or "release".
   */
  unit: string;

  /**
   * Extra attributes for the row group.
   */
  attributes?: SafeHtml;
};

/**
 * Renders a row group with a grey banner row carrying its title and count, or without a banner when
 * it has no title.
 *
 * @param group Group parts.
 * @returns Row group.
 */
export function tableGroup({ id, title, rows, count, unit, attributes }: TableGroup): SafeHtml {
  const banner =
    id === undefined
      ? ''
      : html`<tr class="catalogue-group-row" role="row">
          <td role="cell" colspan="3">
            <div class="catalogue-group-label">
              <h2 id="${id}">${title}</h2>
              <span class="num" data-filter-group-count data-unit="${unit}"
                >${countLabel(count, unit)}</span
              >
            </div>
          </td>
        </tr>`;
  return html`<tbody
    role="rowgroup"
    data-filter-group
    ${attributes ?? ''}
    ${id === undefined ? '' : html`aria-labelledby="${id}"`}
  >
    ${banner} ${rows}
  </tbody>`;
}

/**
 * Renders one record as a row: title with its one-line outcome and any Jira keys, the status pill
 * and the target (or, for a shipped release, the ship date).
 *
 * @param data Indexed roadmap.
 * @param entity Item or release.
 * @returns Table row.
 */
export function catalogueRow(data: SiteData, entity: Entity): SafeHtml {
  const status = getStatus(entity);
  const jira = entity.jira.join(' ');
  const outcome = entity.outcome?.trim() || entity.description.trim();
  return html`<tr
    class="catalogue-item"
    role="row"
    ${filterAttributes(data, entity)}
    ${jira ? html`data-jira="${jira}"` : ''}
  >
    <th class="catalogue-item-title" scope="row" role="rowheader">
      ${entityLink(data, entity.id)}
      ${outcome ? html`<span class="catalogue-item-outcome">${outcome}</span>` : ''}
      ${jira ? html`<span class="catalogue-item-context">${jira}</span>` : ''}
    </th>
    <td class="catalogue-item-status" role="cell">${status ? statusPill(status) : 'No status'}</td>
    <td class="catalogue-item-target" role="cell">${dateCell(entity)}</td>
  </tr>`;
}

/**
 * Shows when a record lands: the ship date of a shipped release, otherwise its target.
 *
 * @param entity Item or release.
 * @returns Date with a visually hidden label, or "No target".
 */
function dateCell(entity: Entity): HtmlValue {
  if (entity.status === 'shipped' && entity.shipped_on) {
    return html`Shipped ${time(entity.shipped_on)}`;
  }

  return entity.target
    ? html`<span class="catalogue-target-label">Target </span>${time(entity.target)}`
    : 'No target';
}
