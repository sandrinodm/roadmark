import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from './data.ts';

import { personName, route, teamIds, teamName } from './data.ts';

/**
 * Item membership shared by a profile and its scoped timeline.
 */
export type ProfileView = {
  /**
   * Authored person or team identifier.
   */
  id: string;

  /**
   * Display name of the profile.
   */
  name: string;

  /**
   * Deployment-prefixed URL of the canonical profile.
   */
  href: string;

  /**
   * Distinct roadmap items associated with this profile.
   */
  items: Array<Entity>;

  /**
   * Reasons each item belongs to this profile.
   */
  roles: Map<string, Array<string>>;
};

/**
 * Resolves item membership once for both ways to read a profile's work.
 *
 * @param data Indexed roadmap with effective assignments.
 * @param kind Registry that owns the profile.
 * @param id Stable registry key.
 * @returns Profile identity, matching items, and their involvement labels.
 */
export function profileView(data: SiteData, kind: 'person' | 'team', id: string): ProfileView {
  const personal = kind === 'person';
  const items = personal
    ? (data.workByPerson.get(id) ?? []).filter(({ kind: recordKind }) => recordKind === 'item')
    : data.items.filter((item) => teamIds(item).includes(id));
  const roles = new Map(
    items.map((item) => [item.id, personal ? personRoles(item, id) : teamRoles(item, id)]),
  );
  return {
    id,
    name: personal ? personName(data, id) : teamName(data, id),
    href: data.base + route(kind, id),
    items,
    roles,
  };
}

/**
 * Determines which personal assignments apply to the item.
 *
 * @param item Item with effective PM and direct contributor assignments.
 * @param id Stable ID of the person being profiled.
 * @returns Assignment labels, distinguishing inherited ownership from direct assignment.
 */
function personRoles(item: Entity, id: string): Array<string> {
  const roles = [];
  if (item.pm === id) {
    roles.push(item.inherited_pm ? 'Product manager (from feature set)' : 'Product manager');
  }

  if (item.contributors?.includes(id)) {
    roles.push('Contributor');
  }

  return roles;
}

/**
 * Collects every way a team is directly involved in an item.
 *
 * @param item Roadmap item with compiled ownership.
 * @param team Stable ID of the team being profiled.
 * @returns Ownership and contribution labels when applicable.
 */
function teamRoles(item: Entity, team: string): Array<string> {
  const roles = [];
  if (item.engineering_team === team) {
    roles.push(item.inherited_engineering_team ? 'Owner (from feature set)' : 'Owner');
  }

  if (item.contributing_teams.includes(team)) {
    roles.push('Contributing team');
  }

  return roles;
}
