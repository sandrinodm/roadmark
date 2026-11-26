import type { Entity } from '@roadmark/compiler/model';

import { dateBounds, dateLabel } from './data.ts';

/**
 * Releases that land in one time span.
 */
export type ReleaseGroup = {
  /**
   * Stable key: `2027-Q3`, `2027-05` or `none`.
   */
  key: string;

  /**
   * Banner text: "Q3 2027", "May 2027" or "No target".
   */
  label: string;

  /**
   * Releases in the span, earliest first.
   */
  releases: Array<Entity>;
};

/**
 * The span a release lands in, with the day it starts and how long it lasts for ordering.
 */
type Span = {
  /**
   * Group key.
   */
  key: string;

  /**
   * First day of the span, in milliseconds, or Infinity for no target.
   */
  start: number;

  /**
   * Exclusive end of the span, so a month sorts before the quarter that starts with it.
   */
  end: number;
};

/**
 * Finds the span a release belongs under. A shipped release uses its ship date's month; otherwise a
 * quarter target stays a quarter and a month or day target becomes its month.
 *
 * @param release Release.
 * @returns Span, or the "No target" span.
 */
export function releaseSpan(release: Entity): Span {
  const date = (release.status === 'shipped' ? release.shipped_on : undefined) ?? release.target;
  if (date === undefined) {
    return { key: 'none', start: Infinity, end: Infinity };
  }

  const key = date.includes('-Q') ? date : date.slice(0, 7);
  const [start, end] = dateBounds(key);
  return { key, start, end };
}

/**
 * Groups releases by the quarter or month they land in, in chronological order, with releases
 * without a target last. Inside a group, releases follow their own date, then title.
 *
 * @param releases Releases in any order.
 * @returns Groups in display order.
 */
export function groupReleases(releases: ReadonlyArray<Entity>): Array<ReleaseGroup> {
  const spans = new Map<string, Span>();
  const members = new Map<string, Array<Entity>>();
  for (const release of releases) {
    const span = releaseSpan(release);
    spans.set(span.key, span);
    const group = members.get(span.key) ?? [];
    group.push(release);
    members.set(span.key, group);
  }

  return [...spans.values()]
    .toSorted((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))
    .map(({ key }) => ({
      key,
      label: key === 'none' ? 'No target' : dateLabel(key),
      releases: (members.get(key) ?? []).toSorted(byLanding),
    }));
}

/**
 * Orders releases inside a group by the day they land, then by title.
 *
 * @param a First release.
 * @param b Second release.
 * @returns Comparator value.
 */
function byLanding(a: Entity, b: Entity): number {
  return landing(a) - landing(b) || a.title.localeCompare(b.title, 'en');
}

/**
 * The first day a release lands: its ship date once shipped, otherwise its target.
 *
 * @param release Release.
 * @returns Milliseconds, or Infinity without a date.
 */
function landing(release: Entity): number {
  const date = (release.status === 'shipped' ? release.shipped_on : undefined) ?? release.target;
  return date ? dateBounds(date)[0] : Infinity;
}
