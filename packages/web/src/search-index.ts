import type { Entity } from '@roadmark/compiler/model';

import type { SearchEntry } from './client/search-rank.ts';
import type { SiteData } from './data.ts';

import { avatarFor, dateLabel, KIND_LABELS, personName, route, teamName } from './data.ts';
import { entryFields } from './scope.ts';

/**
 * Builds the downloadable search index for roadmap records, people and teams.
 *
 * @param data Indexed roadmap and registries.
 * @returns JSON text with deployment-relative result links.
 */
export function searchIndex(data: SiteData): string {
  const entities = data.entities.map((entity): SearchEntry => {
    const fields = entryFields(data, entity);
    return {
      ...fields,
      kind: KIND_LABELS[entity.kind],
      href: data.base + route(entity.kind, entity.id),
      title: entity.title,
      description: entity.description,
      outcome: entity.outcome ?? '',
      target: entity.target ? dateLabel(entity.target) : '',
      id: entity.id,
      jira: entity.jira,
      text: [entity.text, ...(entity.links ?? []).map(({ label, url }) => `${label} ${url}`)]
        .filter(Boolean)
        .join(' '),
      involvement: involvement(data, entity, fields.teams).join(' '),
    };
  });
  const teams = data.teams.map(([id, title]): SearchEntry => ({
    kind: 'Team',
    type: 'team',
    status: '',
    release: [],
    set: [],
    teams: [id],
    href: data.base + route('team', id),
    title,
    description: data.workspace.team_details?.[id]?.description ?? '',
    id,
    jira: [],
    text: id,
  }));
  const people = data.people.map(([id, title]) => personResult(data, id, title));
  return JSON.stringify([...entities, ...teams, ...people]);
}

/**
 * Builds a person's entry with their role and teams as the summary.
 *
 * @param data Indexed profiles and teams.
 * @param id Person ID.
 * @param title Display name.
 * @returns Entry linking to the profile.
 */
function personResult(data: SiteData, id: string, title: string): SearchEntry {
  const person = data.workspace.person_details?.[id];
  const teams = person?.teams ?? [];
  const detail = [person?.role, ...teams.map((team) => teamName(data, team))].filter(Boolean);
  return {
    avatar: avatarFor(data, id),
    kind: 'Person',
    type: 'person',
    status: '',
    release: [],
    set: [],
    teams,
    href: data.base + route('person', id),
    title,
    description: detail.join(' · '),
    id,
    jira: [],
    text: '',
  };
}

/**
 * Adds involved team and people names to the searchable text.
 *
 * @param data Indexed names.
 * @param entity Record being indexed.
 * @param teams Team IDs already computed for the record.
 * @returns Names and IDs for matching.
 */
function involvement(data: SiteData, entity: Entity, teams: Array<string>): Array<string> {
  const people = new Set(entity.contributors ?? []);
  if (entity.pm) {
    people.add(entity.pm);
  }

  return [
    ...teams.flatMap((id) => [id, teamName(data, id)]),
    ...[...people].flatMap((id) => [id, personName(data, id)]),
  ];
}
