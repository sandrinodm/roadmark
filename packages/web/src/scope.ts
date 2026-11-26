import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from './data.ts';
import type { SafeHtml } from './ui/html.ts';

import { getStatus, teamIds } from './data.ts';
import { html } from './ui/html.ts';

/**
 * Represents items without a release using a value outside the authored ID grammar.
 */
export const UNASSIGNED_RELEASE = '~unassigned';

/**
 * Filterable memberships of one record, shared by lists, the timeline and search.
 */
export type EntryFields = {
  /**
   * Record kind.
   */
  type: string;

  /**
   * Canonical or derived status.
   */
  status: string;

  /**
   * Release IDs, with `~unassigned` for items without one.
   */
  release: Array<string>;

  /**
   * Feature set IDs.
   */
  set: Array<string>;

  /**
   * Team IDs.
   */
  teams: Array<string>;
};

/**
 * Computes the memberships of a record and the items it contains.
 *
 * @param data Indexed roadmap used to find items in scope.
 * @param entity Record whose memberships are needed.
 * @returns Type, status and membership lists.
 */
export function entryFields(data: SiteData, entity: Entity): EntryFields {
  const scope = entityScope(data, entity);
  const membership = [entity, ...scope];
  return {
    type: entity.kind,
    status: getStatus(entity),
    release: [...new Set(membership.flatMap(releaseMembership))],
    set: [...new Set(membership.flatMap(setMembership))],
    teams: teamIds(entity, scope),
  };
}

/**
 * Attaches the memberships used by search to a list or timeline row, so filters can hide it.
 *
 * @param data Indexed roadmap used to resolve scope.
 * @param entity Record represented by the row.
 * @param roles Optional profile involvement labels by item ID.
 * @returns Attribute markup.
 */
export function filterAttributes(
  data: SiteData,
  entity: Entity,
  roles?: Map<string, Array<string>>,
): SafeHtml {
  const fields = entryFields(data, entity);
  const roleKeys = roles?.get(entity.id)?.map(roleKey).join(' ');
  return html`data-filter-entry="${entity.id}" ${roleKeys ? html`data-role="${roleKeys}"` : ''}
  data-type="${fields.type}" data-status="${fields.status}"
  data-release="${fields.release.join(' ')}" data-set="${fields.set.join(' ')}"
  data-team="${fields.teams.join(' ')}"`;
}

/**
 * Groups explicit and inherited ownership under the same involvement filter.
 *
 * @param label Display label of an item's assignment.
 * @returns Role without its inheritance annotation.
 */
export function roleLabel(label: string): string {
  return label.replace(' (from feature set)', '');
}

/**
 * Converts a role label into a URL and dataset value.
 *
 * @param label Assignment label used by the profile.
 * @returns Lowercase hyphenated role identifier.
 */
export function roleKey(label: string): string {
  return roleLabel(label).toLowerCase().replaceAll(' ', '-');
}

/**
 * Looks up the items contained by a release or feature set.
 *
 * @param data Indexed scope relationships.
 * @param entity Scope record or individual item.
 * @returns Items in scope, or none for an item.
 */
function entityScope(data: SiteData, entity: Entity): Array<Entity> {
  const scopes = new Map([
    ['release', data.itemsByRelease],
    ['set', data.itemsBySet],
  ]);
  return scopes.get(entity.kind)?.get(entity.id) ?? [];
}

/**
 * Resolves the release choices that match one member of the scope.
 *
 * @param entity Record in the scope.
 * @returns Release ID, the unassigned sentinel for unscheduled items, or nothing.
 */
function releaseMembership(entity: Entity): Array<string> {
  if (entity.kind === 'release') {
    return [entity.id];
  }

  if (entity.release) {
    return [entity.release];
  }

  return entity.kind === 'item' ? [UNASSIGNED_RELEASE] : [];
}

/**
 * Resolves a feature set from the record itself or its parent.
 *
 * @param entity Record in the scope.
 * @returns A feature set ID when applicable.
 */
function setMembership(entity: Entity): Array<string> {
  if (entity.kind === 'set') {
    return [entity.id];
  }

  return entity.set ? [entity.set] : [];
}
