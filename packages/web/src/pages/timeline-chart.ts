import type { Entity } from '@roadmark/compiler/model';

import { DAY_PATTERN } from '@roadmark/compiler/dates';

import type { SiteData } from '../data.ts';
import type { ProfileView } from '../profile-view.ts';
import type { SafeHtml } from '../ui/html.ts';

import { dateBounds, getStatus, route, utcMonth } from '../data.ts';
import { filterAttributes } from '../scope.ts';
import { icon } from '../ui/glyph.ts';
import { html } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { statusPill } from '../ui/pill.ts';
import { statusLabel } from '../ui/status.ts';
import { datesText, groupId } from './timeline-dates.ts';

/**
 * Number of months in a calendar year.
 */
const MONTHS_PER_YEAR = 12;

/**
 * Number of months between quarter ticks.
 */
const MONTHS_PER_QUARTER = 3;

/**
 * Approximate upper limit on axis labels for long timelines.
 */
const MAX_AXIS_LABELS = 36;

/**
 * Full extent in percent used for CSS positioning.
 */
const FULL_PERCENT = 100;

/**
 * Short month names for axis ticks.
 */
const AXIS_LABEL = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

/**
 * UTC calendar bounds of the chart and the number of months it spans.
 */
export type Axis = {
  /**
   * Inclusive start in milliseconds since the epoch.
   */
  start: number;

  /**
   * Exclusive end in milliseconds since the epoch.
   */
  end: number;

  /**
   * Whole months spanned.
   */
  months: number;
};

/**
 * A labelled lane of dated records.
 */
export type Group = {
  /**
   * Release ID, or empty for the unassigned lane.
   */
  id: string;

  /**
   * Lane heading.
   */
  name: string;

  /**
   * Records in the lane.
   */
  rows: Array<Entity>;
};

/**
 * Computes the month-aligned range that covers every date on the chart.
 *
 * @param entities Dated records.
 * @returns Axis, or undefined when nothing has a date.
 */
export function chartAxis(entities: ReadonlyArray<Entity>): Axis | undefined {
  // A loop rather than `Math.min(...bounds)`: spreading hundreds of thousands of dates would
  // exceed the engine's argument limit on a large roadmap.
  let earliest = Infinity;
  let latest = -Infinity;
  for (const entity of entities) {
    for (const date of [entity.start, entity.target, entity.shipped_on]) {
      for (const bound of date ? dateBounds(date) : []) {
        earliest = Math.min(earliest, bound);
        latest = Math.max(latest, bound);
      }
    }
  }

  if (earliest === Infinity) {
    return undefined;
  }

  const min = new Date(earliest);
  const max = new Date(latest - 1);
  const year = min.getUTCFullYear();
  const maxYear = max.getUTCFullYear();
  const startMonth = min.getUTCMonth();
  const endMonth = max.getUTCMonth() + 1;
  const months = (maxYear - year) * MONTHS_PER_YEAR + endMonth - startMonth;
  return { start: utcMonth(year, startMonth), end: utcMonth(maxYear, endMonth), months };
}

/**
 * Renders the month and quarter rulers.
 *
 * @param axis Chart range.
 * @returns Both rulers; CSS shows the one that matches the zoom.
 */
export function axisRulers(axis: Axis): SafeHtml {
  return html`<div data-axis="quarter" class="axis-ticks">
      ${monthTicks(axis, MONTHS_PER_QUARTER)}
    </div>
    <div data-axis="month" class="axis-ticks">${monthTicks(axis, 1)}</div>`;
}

/**
 * Places a tick per step, thinning labels on long ranges.
 *
 * @param axis Chart range.
 * @param step Months between ticks.
 * @returns Ticks.
 */
function monthTicks(axis: Axis, step: number): Array<SafeHtml> {
  const spacing = Math.max(step, Math.ceil(axis.months / (MAX_AXIS_LABELS * step)) * step);
  const first = new Date(axis.start);
  const year = first.getUTCFullYear();
  const firstMonth = first.getUTCMonth();
  const firstOffset = (spacing - (firstMonth % spacing)) % spacing;
  const offsets = firstOffset > 0 ? [0, firstOffset] : [0];
  for (let offset = firstOffset + spacing; offset < axis.months; offset += spacing) {
    offsets.push(offset);
  }

  return offsets
    .filter((offset) => offset < axis.months)
    .map((offset) => {
      const date = new Date(utcMonth(year, firstMonth + offset));
      const label =
        spacing >= MONTHS_PER_YEAR
          ? String(date.getUTCFullYear())
          : monthLabel(date, step, offset === 0 || date.getUTCMonth() === 0);
      return html`<span style="--at:${position(axis, date.valueOf())}%">${label}</span>`;
    });
}

/**
 * Labels a tick with its month or quarter, adding the year at the start and in January.
 *
 * @param date First day of the tick's month.
 * @param step Months between ticks.
 * @param year Whether to add the year.
 * @returns Tick label.
 */
function monthLabel(date: Date, step: number, year: boolean): string {
  const month =
    step === MONTHS_PER_QUARTER
      ? `Q${Math.floor(date.getUTCMonth() / MONTHS_PER_QUARTER) + 1}`
      : AXIS_LABEL.format(date);
  return year ? `${month} ${date.getUTCFullYear()}` : month;
}

/**
 * Renders one chart row: label, status and the bar on its track.
 *
 * @param data Indexed roadmap.
 * @param axis Chart range.
 * @param entity Record.
 * @param view Profile whose roles become filter attributes.
 * @returns Row.
 */
export function chartRow(data: SiteData, axis: Axis, entity: Entity, view?: ProfileView): SafeHtml {
  return html`<div
    class="gantt-row"
    ${filterAttributes(data, entity, view?.roles)}
    data-timeline-id="${entity.id}"
    data-zoom-release="${groupId(entity, 'release')}"
    data-zoom-set="${groupId(entity, 'set')}"
    data-zoom-team="${groupId(entity, 'team')}"
  >
    <div class="gantt-label">
      <span class="gantt-kind gantt-kind-${entity.kind}">${icon(entity.kind)}</span>
      <div>${entityLink(data, entity.id)}${statusPill(getStatus(entity))}</div>
    </div>
    <div class="gantt-track" data-track>
      ${marks(data, axis, entity)}
      <span class="gantt-date visually-hidden">${datesText(entity)}</span>
    </div>
  </div>`;
}

/**
 * Draws a record's bar or point and its actual-date pin.
 *
 * @param axis Chart range.
 * @param entity Record.
 * @returns Marks.
 */
function marks(data: SiteData, axis: Axis, entity: Entity): SafeHtml | '' {
  const start = entity.start ? dateBounds(entity.start)[0] : undefined;
  const actual = entity.shipped_on;
  const actualPin = actual
    ? html`<span
        class="actual-pin"
        style="--at:${position(axis, midpoint(dateBounds(actual)))}%"
      ></span>`
    : '';
  if (!entity.target) {
    const style = `--at:${position(axis, start ?? 0)}%`;
    return start === undefined ? '' : mark(data, entity, { name: 'exact-point', style });
  }

  const target = dateBounds(entity.target);
  const exact = DAY_PATTERN.test(entity.target);
  if (exact && start === undefined) {
    const style = `--at:${position(axis, midpoint(target))}%`;
    return html`${mark(data, entity, { name: 'exact-point', style })}${actualPin}`;
  }

  const left = start ?? target[0];
  const right = Math.max(left, target[1]);
  const windowAt = exact ? FULL_PERCENT : windowPosition(left, right, target[0]);
  const style = `--at:${position(axis, left)}%;--end:${position(axis, right)}%;--window:${windowAt}%`;
  return html`${mark(data, entity, { name: 'exact-span', style })}${actualPin}`;
}

/**
 * Renders a bar as a plain link to the record, wrapped in a trigger of the chart's shared tooltip.
 * The timeline script turns a click into a selection; without it the link opens the record.
 *
 * @param data Indexed roadmap with the deployment prefix.
 * @param entity Record.
 * @param shape `exact-point` or `exact-span`, with its position custom properties.
 * @returns Bar.
 */
function mark(data: SiteData, entity: Entity, shape: { name: string; style: string }): SafeHtml {
  const dates = datesText(entity);
  const status = getStatus(entity);
  const tip = `${entity.title} · ${statusLabel(status)} · ${dates}`;
  return html`<ui-tooltip-trigger
    for="timeline-tip"
    class="gantt-bar ${shape.name}"
    style="${shape.style}"
    data-tip="${tip}"
    ><a
      class="gantt-mark gantt-mark-${entity.kind}"
      data-status="${status}"
      data-mark="${entity.id}"
      href="${data.base + route(entity.kind, entity.id)}"
      aria-label="${entity.title} · ${dates}"
    ></a
  ></ui-tooltip-trigger>`;
}

/**
 * Converts a date to its position along the axis.
 *
 * @param axis Chart range.
 * @param date Milliseconds since the epoch.
 * @returns Percentage from the left edge.
 */
function position(axis: Axis, date: number): number {
  return ((date - axis.start) / (axis.end - axis.start)) * FULL_PERCENT;
}

/**
 * Finds the middle of a date range.
 *
 * @param range Start and exclusive end.
 * @returns Midpoint.
 */
function midpoint([start, end]: [number, number]): number {
  return (start + end) / 2;
}

/**
 * Places the start of the target window within a bar.
 *
 * @param start Bar start.
 * @param end Bar end.
 * @param target Start of the target period.
 * @returns Percentage of the bar before the target window.
 */
function windowPosition(start: number, end: number, target: number): number {
  if (end <= start) {
    return 0;
  }

  return Math.max(0, ((target - start) / (end - start)) * FULL_PERCENT);
}
