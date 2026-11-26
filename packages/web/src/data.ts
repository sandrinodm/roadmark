import type { Compilation, Diagnostic, Entity, Kind, Workspace } from '@roadmark/compiler/model';

import { dateRange, DAY_PATTERN } from '@roadmark/compiler/dates';

export { STATUS_LABELS } from './ui/status.ts';

/**
 * Milliseconds in a UTC calendar day.
 */
const DAY_MS = 86_400_000;

/**
 * Base options used by calendar formatters to avoid viewer-local date shifts.
 */
const UTC = {
  /**
   * Uses UTC to display dates consistently across time zones.
   */
  timeZone: 'UTC',
};

/**
 * Formats exact calendar dates with an abbreviated month.
 */
const DAY_LABEL = new Intl.DateTimeFormat('en', {
  ...UTC,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Formats month windows without displaying a specific day.
 */
const MONTH_LABEL = new Intl.DateTimeFormat('en', { ...UTC, month: 'short', year: 'numeric' });

/**
 * Shared indexes for the static renderer.
 */
export type SiteData = {
  /**
   * Normalized, slash-terminated deployment URL prefix.
   */
  base: string;

  /**
   * Normalized workspace settings and registries.
   */
  workspace: Workspace;

  /**
   * Resolved theme assets and settings, when configured.
   */
  brand: Compilation['brand'];

  /**
   * Compiler messages available to render on detail pages.
   */
  diagnostics: Array<Diagnostic>;

  /**
   * All roadmap records in title order.
   */
  entities: Array<Entity>;

  /**
   * Items in title order.
   */
  items: Array<Entity>;

  /**
   * Feature sets in title order.
   */
  sets: Array<Entity>;

  /**
   * Releases in target order, with undated releases last.
   */
  releases: Array<Entity>;

  /**
   * Records keyed by their stable authored ID.
   */
  byId: Map<string, Entity>;

  /**
   * Items keyed by their containing feature set.
   */
  itemsBySet: Map<string, Array<Entity>>;

  /**
   * Items keyed by release ID, with an empty key for unassigned items.
   */
  itemsByRelease: Map<string, Array<Entity>>;

  /**
   * Items keyed by the prerequisite item they depend on.
   */
  blockedByItem: Map<string, Array<Entity>>;

  /**
   * Team IDs and names in display order.
   */
  teams: Array<[string, string]>;

  /**
   * Person IDs and names in display order.
   */
  people: Array<[string, string]>;

  /**
   * Registered person IDs grouped by declared team membership.
   */
  peopleByTeam: Map<string, Array<string>>;

  /**
   * Effective PM and contributor assignments keyed by person ID.
   */
  workByPerson: Map<string, Array<Entity>>;
};

/**
 * Visible labels for authored roadmap kinds.
 */
export const KIND_LABELS: Record<Kind, string> = {
  /**
   * Represents feature sets.
   */
  set: 'Feature set',

  /**
   * Represents individual roadmap items.
   */
  item: 'Item',

  /**
   * Represents releases.
   */
  release: 'Release',
};

/**
 * Output directory names for records and directory profiles.
 */
const KIND_PATHS: Record<Kind | 'team' | 'person', string> = {
  /**
   * Represents feature sets.
   */
  set: 'sets',

  /**
   * Represents individual roadmap items.
   */
  item: 'items',

  /**
   * Represents releases.
   */
  release: 'releases',

  /**
   * Identifies directory routes for team profiles.
   */
  team: 'teams',

  /**
   * Identifies directory routes for individual profiles.
   */
  person: 'people',
};

/**
 * Prepares shared relationship indexes and sorts display collections.
 *
 * @param model Validated roadmap compilation.
 * @param base Normalized, slash-terminated deployment URL prefix.
 * @returns Data shared by all page and search renderers.
 */
export function siteData(model: Compilation, base: string): SiteData {
  const entities = model.entities.toSorted(byTitle);
  const items = entities.filter(({ kind }) => kind === 'item');
  const sets = entities.filter(({ kind }) => kind === 'set');
  const releases = entities.filter(({ kind }) => kind === 'release').toSorted(byDate);
  const people = registryEntries(model.workspace.people);
  return {
    base,
    workspace: model.workspace,
    brand: model.brand,
    diagnostics: model.diagnostics,
    entities,
    items,
    sets,
    releases,
    byId: new Map(entities.map((entity) => [entity.id, entity])),
    itemsBySet: groupBy(items, ({ set }) => set),
    itemsByRelease: groupBy(items, ({ release }) => release),
    blockedByItem: groupBlocked(items),
    teams: registryEntries(model.workspace.teams),
    people,
    peopleByTeam: peopleByTeam(model.workspace, people),
    workByPerson: workByPerson(entities),
  };
}

/**
 * Builds an output-relative directory route using the stable ID.
 *
 * @param kind Entity or directory profile type.
 * @param id Stable ID of the target.
 * @returns Slash-terminated route without a deployment prefix.
 */
export function route(kind: Kind | 'team' | 'person', id: string): string {
  return `${KIND_PATHS[kind]}/${encodeURIComponent(id)}/`;
}

/**
 * Looks up a team display label.
 *
 * @param data Indexed roadmap containing the team registry.
 * @param id Stable team ID.
 * @returns Registered name, falling back to the supplied ID.
 */
export function teamName(data: SiteData, id: string): string {
  return data.workspace.teams[id] ?? id;
}

/**
 * Looks up a person display label.
 *
 * @param data Indexed roadmap containing the people registry.
 * @param id Stable person ID.
 * @returns Registered name, falling back to the supplied ID.
 */
export function personName(data: SiteData, id: string): string {
  return data.workspace.people[id] ?? id;
}

/**
 * Keeps a displayed initial together with its combining marks.
 */
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Identifies name components while preserving internal apostrophes and diacritics.
 */
const NAME_PARTS = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;

/**
 * Returns a compact identity shared by static pages and search results.
 *
 * @param data Indexed person metadata and deployment prefix.
 * @param id Stable registry identifier, also used when the name has no letters or digits.
 * @returns Initials plus the published thumbnail URL when available.
 */
export function avatarFor(data: SiteData, id: string): { initials: string; src?: string } {
  const words = personName(data, id).normalize('NFC').match(NAME_PARTS) ?? [id];
  const first = words[0];
  const last = words.at(-1) ?? first;
  let initials: string;
  if (words.length === 1) {
    initials = graphemes(first.replaceAll(/['’]/g, '')).slice(0, 2).join('');
  } else {
    const components = words.length === 2 ? [first, last] : [first, words[1] ?? first, last];
    initials = components.map((word) => graphemes(word)[0]).join('');
  }

  initials = graphemes(initials.toUpperCase()).slice(0, 3).join('');
  const file = data.workspace.person_details?.[id]?.avatar;
  return file ? { initials, src: data.base + file } : { initials };
}

/**
 * Splits a short name into user-perceived characters.
 *
 * @param text Name or initials to segment.
 * @returns Grapheme clusters in display order.
 */
function graphemes(text: string): Array<string> {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment);
}

/**
 * Collects unique engineering and contributing teams.
 *
 * @param entity Main roadmap record.
 * @param scope Additional items included in the record's scope.
 * @returns Deduplicated team IDs in encounter order.
 */
export function teamIds(entity: Entity, scope: Array<Entity> = []): Array<string> {
  const teams = new Set<string>();
  for (const member of [entity, ...scope]) {
    if (member.engineering_team) {
      teams.add(member.engineering_team);
    }

    for (const team of member.contributing_teams) {
      teams.add(team);
    }
  }

  return [...teams];
}

/**
 * Reads a record's status, empty when it has none.
 *
 * @param entity Roadmap record whose status will be shown.
 * @returns Status value or an empty string when status does not apply.
 */
export function getStatus(entity: Entity): string {
  return entity.status ?? '';
}

/**
 * Counts used to display delivery progress for a set of items.
 */
type ProgressCounts = {
  /**
   * Number of items marked done.
   */
  done: number;

  /**
   * Number of items still in scope, including those marked done.
   */
  total: number;

  /**
   * Number of cancelled items excluded from the total.
   */
  cancelled: number;
};

/**
 * Counts work for a progress display while tracking cancelled items separately.
 *
 * @param items Roadmap items included in the scope.
 * @returns Done and in-scope totals plus the number cancelled.
 */
export function progress(items: ReadonlyArray<Entity>): ProgressCounts {
  const done = items.filter(({ status }) => status === 'done').length;
  const cancelled = items.filter(({ status }) => status === 'cancelled').length;
  return { done, total: items.length - cancelled, cancelled };
}

/**
 * Converts the authored date bucket to UTC millisecond boundaries.
 *
 * @param date Calendar day, month, or quarter.
 * @returns Inclusive start and exclusive end, or NaN boundaries for invalid input.
 */
export function dateBounds(date: string): [number, number] {
  const range = dateRange(date);
  if (!range) {
    return [Number.NaN, Number.NaN];
  }

  return [Date.parse(range.first), Date.parse(range.last) + DAY_MS];
}

/**
 * Formats a date without adding precision to an authored month or quarter.
 *
 * @param date Calendar day, month, or quarter.
 * @returns Localized English label, or the original text if it cannot be parsed.
 */
export function dateLabel(date: string): string {
  const [year, period] = date.split('-');
  if (period?.startsWith('Q')) {
    return `${period} ${year}`;
  }

  const [start] = dateBounds(date);
  if (!Number.isFinite(start)) {
    return date;
  }

  const formatter = DAY_PATTERN.test(date) ? DAY_LABEL : MONTH_LABEL;
  return formatter.format(start);
}

/**
 * Constructs a UTC month boundary and allows month rollover.
 *
 * @param year UTC year.
 * @param month Zero-based month index that may fall outside 0–11.
 * @returns Milliseconds since the Unix epoch at the start of the month.
 */
export function utcMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 1);
  return date.valueOf();
}

/**
 * Orders work by target bucket, with undated work last.
 *
 * @param a First record.
 * @param b Second record.
 * @returns Comparator value, breaking target ties by title and ID.
 */
export function byDate(a: Entity, b: Entity): number {
  const startA = a.target ? dateBounds(a.target)[0] : Infinity;
  const startB = b.target ? dateBounds(b.target)[0] : Infinity;
  return startA - startB || byTitle(a, b);
}

/**
 * Builds a relationship index using one optional key per record.
 *
 * @param items Records to group.
 * @param field Function that extracts the relationship key.
 * @returns Map with missing keys grouped under the empty string.
 */
function groupBy(
  items: Array<Entity>,
  field: (item: Entity) => string | undefined,
): Map<string, Array<Entity>> {
  const groups = new Map<string, Array<Entity>>();
  for (const item of items) {
    const key = field(item) ?? '';
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return groups;
}

/**
 * Indexes the downstream items for each prerequisite item.
 *
 * @param items Items with compiled dependency edges.
 * @returns Map from prerequisite ID to dependent items.
 */
function groupBlocked(items: Array<Entity>): Map<string, Array<Entity>> {
  const dependents = new Map<string, Array<Entity>>();
  for (const item of items) {
    for (const dependency of item.depends_on) {
      const list = dependents.get(dependency.item) ?? [];
      list.push(item);
      dependents.set(dependency.item, list);
    }
  }

  return dependents;
}

/**
 * Sorts directory entries by display name and then by stable ID.
 *
 * @param registry Stable IDs and their display labels.
 * @returns Sorted ID and label pairs.
 */
function registryEntries(registry: Record<string, string>): Array<[string, string]> {
  return Object.entries(registry).toSorted(
    ([idA, nameA], [idB, nameB]) => compare(nameA, nameB) || compare(idA, idB),
  );
}

/**
 * Inverts declared team memberships to support team rosters.
 *
 * @param workspace Workspace containing person details.
 * @param people People in existing display order.
 * @returns Team IDs mapped to their member IDs.
 */
function peopleByTeam(
  workspace: Workspace,
  people: Array<[string, string]>,
): Map<string, Array<string>> {
  const memberships = new Map<string, Array<string>>();
  for (const [id] of people) {
    for (const team of workspace.person_details?.[id]?.teams ?? []) {
      const members = memberships.get(team) ?? [];
      members.push(id);
      memberships.set(team, members);
    }
  }

  return memberships;
}

/**
 * Indexes direct contributors and effective PMs without duplicating multi-role work.
 *
 * @param entities Compiled roadmap records with inherited PMs already resolved.
 * @returns Distinct associated work grouped by person ID.
 */
function workByPerson(entities: Array<Entity>): Map<string, Array<Entity>> {
  const assignments = new Map<string, Array<Entity>>();
  for (const entity of entities) {
    const people = new Set(entity.contributors ?? []);
    if (entity.pm) {
      people.add(entity.pm);
    }

    for (const id of people) {
      const work = assignments.get(id) ?? [];
      work.push(entity);
      assignments.set(id, work);
    }
  }

  return assignments;
}

/**
 * Orders work by display title and uses stable IDs to break ties.
 *
 * @param a First record.
 * @param b Second record.
 * @returns Comparator value in English locale order.
 */
function byTitle(a: Entity, b: Entity): number {
  return compare(a.title, b.title) || compare(a.id, b.id);
}

/**
 * Compares display text in the roadmap's English locale.
 *
 * @param a First string.
 * @param b Second string.
 * @returns Negative, zero, or positive comparator value.
 */
function compare(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}
