import type { Entity } from '@roadmark/compiler/model';

import type { SafeHtml } from '../ui/html.ts';

import { dateBounds, dateLabel } from '../data.ts';
import { html, joinHtml } from '../ui/html.ts';
import { time } from '../ui/links.ts';

/**
 * Shown when a record has no timeline dates.
 */
export const NO_DATES = 'No dates set';

/**
 * Timeline grouping modes.
 */
export type GroupMode = 'release' | 'set' | 'team';

/**
 * Dependency from a prerequisite to the item that needs it.
 */
export type Edge = {
  /**
   * Prerequisite item.
   */
  from: Entity;

  /**
   * Dependent item.
   */
  to: Entity;

  /**
   * Authored reason, when present.
   */
  reason: string | undefined;
};

/**
 * Lists a record's start, target and actual dates.
 *
 * @param entity Record.
 * @returns Labelled dates with `<time>` elements, or "No dates set".
 */
export function datesHtml(entity: Entity): SafeHtml {
  const parts = dateParts(entity).map(([label, date]) => html`${label} ${time(date)}`);
  return parts.length > 0 ? joinHtml(parts, html` · `) : html`${NO_DATES}`;
}

/**
 * Lists a record's dates as plain text for labels and tooltips.
 *
 * @param entity Record.
 * @returns Labelled dates, or "No dates set".
 */
export function datesText(entity: Entity): string {
  const parts = dateParts(entity).map(([label, date]) => `${label} ${dateLabel(date)}`);
  return parts.length > 0 ? parts.join(' · ') : NO_DATES;
}

/**
 * Picks the dates a record has, with their labels.
 *
 * @param entity Record.
 * @returns Label and authored date pairs.
 */
function dateParts(entity: Entity): Array<[string, string]> {
  const actual = entity.shipped_on;
  const parts: Array<[string, string]> = [];
  if (entity.start) {
    parts.push(['Start', entity.start]);
  }

  if (entity.target) {
    parts.push(['Target', entity.target]);
  }

  if (actual) {
    parts.push(['Shipped', actual]);
  }

  return parts;
}

/**
 * Finds the lane a record belongs to in a grouping mode.
 *
 * @param entity Record.
 * @param group Grouping mode.
 * @returns Lane ID, empty for the unassigned lane.
 */
export function groupId(entity: Entity, group: GroupMode): string {
  if (group === 'release') {
    return entity.kind === 'release' ? entity.id : (entity.release ?? '');
  }

  if (entity.kind !== 'item') {
    return '';
  }

  return (group === 'set' ? entity.set : entity.engineering_team) ?? '';
}

/**
 * Explains a dependency whose dates contradict it.
 *
 * @param from Prerequisite.
 * @param to Dependent item.
 * @returns Explanation, or empty when the dates agree.
 */
export function dateConflict(from: Entity, to: Entity): string {
  if (!from.target) {
    return '';
  }

  const [prerequisite] = dateBounds(from.target);
  if (to.start && prerequisite > dateBounds(to.start)[0]) {
    return 'The prerequisite is scheduled to finish after the dependent item starts.';
  }

  if (to.target && prerequisite >= dateBounds(to.target)[1]) {
    return "The prerequisite target is after the dependent item's target.";
  }

  return '';
}

/**
 * Indexes dependencies by both of their endpoints.
 *
 * @param edges Dependencies.
 * @returns Edges keyed by item ID.
 */
export function incidentEdges(edges: ReadonlyArray<Edge>): Map<string, Array<Edge>> {
  const map = new Map<string, Array<Edge>>();
  for (const edge of edges) {
    for (const endpoint of [edge.from.id, edge.to.id]) {
      const incident = map.get(endpoint) ?? [];
      incident.push(edge);
      map.set(endpoint, incident);
    }
  }

  return map;
}
