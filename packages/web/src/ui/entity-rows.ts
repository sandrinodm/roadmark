import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { HtmlValue, SafeHtml } from './html.ts';

import { getStatus } from '../data.ts';
import { kindGlyph } from './glyph.ts';
import { html } from './html.ts';
import { entityLink, time } from './links.ts';
import { statusPill } from './pill.ts';
import { row, rowList } from './row.ts';

/**
 * Optional parts of each entity row.
 */
export type EntityRowOptions = {
  /**
   * What to say when there are no records.
   */
  empty: string;

  /**
   * Secondary content under the summary, such as roles and related links.
   */
  detail?: (entity: Entity) => HtmlValue;

  /**
   * Filter attributes for each row.
   */
  attributes?: (entity: Entity) => SafeHtml;
};

/**
 * Lists linked records with their one-line outcome, target and status.
 *
 * @param data Indexed roadmap used to build links.
 * @param entities Records in display order.
 * @param options Empty state, detail and filter attributes.
 * @returns List or empty state.
 */
export function entityRows(
  data: SiteData,
  entities: ReadonlyArray<Entity>,
  options: EntityRowOptions,
): SafeHtml {
  const rows = entities.map((entity) =>
    row({
      lead: kindGlyph(entity.kind),
      title: entityLink(data, entity.id),
      summary: entity.outcome?.trim() || entity.description,
      detail: options.detail?.(entity),
      meta: html`${entity.target ? time(entity.target) : ''}${statusPill(getStatus(entity))}`,
      attributes: options.attributes?.(entity),
    }),
  );
  return rowList(rows, options.empty);
}
