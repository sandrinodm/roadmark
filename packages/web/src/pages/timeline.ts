import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { ProfileView } from '../profile-view.ts';
import type { SafeHtml } from '../ui/html.ts';
import type { Axis, Group } from './timeline-chart.ts';
import type { Edge } from './timeline-dates.ts';

import { byDate, getStatus, KIND_LABELS, route } from '../data.ts';
import { itemFilters, timelineFilters } from '../filter-forms.ts';
import { filterAttributes } from '../scope.ts';
import { chip } from '../ui/filter-bar.ts';
import { icon, kindGlyph } from '../ui/glyph.ts';
import { html } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { statusPill } from '../ui/pill.ts';
import { row } from '../ui/row.ts';
import { pageHead } from '../ui/section.ts';
import { axisRulers, chartAxis, chartRow } from './timeline-chart.ts';
import { dateConflict, datesHtml, incidentEdges } from './timeline-dates.ts';

/**
 * Formats the chart's overall range.
 */
const SCHEDULE_RANGE = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Renders the roadmap timeline, or a profile's, as a Gantt chart with an accessible list.
 *
 * @param data Indexed roadmap.
 * @param view Profile whose items the timeline is limited to.
 * @returns Page content.
 */
export function timelinePage(data: SiteData, view?: ProfileView): SafeHtml {
  const source = view ? view.items : [...data.releases, ...data.items];
  const entities = source.toSorted(byDate);
  const dated = entities.filter(({ target, start }) => target || start);
  const undated = entities.filter(({ target, start }) => !target && !start);
  const axis = chartAxis(dated);
  const edges = incidentEdges(graphEdges(data));
  const count = `${entities.length} ${entities.length === 1 ? 'entry' : 'entries'}`;
  const header = pageHead(view ? `${view.name} timeline` : 'Timeline', count, {
    countHook: html`data-filter-count`,
    actions: view
      ? html`<a class="button" data-preserve-filters href="${view.href}#roadmap-items"
          >View roadmap items ${icon('arrow')}</a
        >`
      : '',
  });
  if (view && entities.length === 0) {
    return html`<div class="page">
      ${header}
      <div data-timeline><p class="empty">No roadmap items in this view.</p></div>
    </div>`;
  }

  return html`<div class="page">
    ${header}
    <div class="timeline-page" data-timeline data-filter-scope>
      <div class="timeline-bar">
        ${axis ? chartTools() : ''}
        ${view ? itemFilters(data, entities, view.roles) : timelineFilters(data)}
      </div>
      ${
        axis
          ? html`<p class="minor num">${SCHEDULE_RANGE.formatRange(axis.start, axis.end - 1)}</p>
              ${chart(data, axis, timelineGroups(data, dated), view)}`
          : html`<p class="empty">
              No dates are set yet. Add <code>target</code> dates to show them here.
            </p>`
      }
      <p class="empty" data-filter-empty hidden>No entries match these filters.</p>
      ${selectionPanels(data, entities, edges)}
      ${timelineLists(data, { dated, undated, axis: Boolean(axis), edges, view })}
    </div>
  </div>`;
}

/**
 * Groups dated records into release lanes, with unassigned records last.
 *
 * @param data Releases in target order.
 * @param dated Dated records.
 * @returns Non-empty lanes.
 */
function timelineGroups(data: SiteData, dated: ReadonlyArray<Entity>): Array<Group> {
  const assigned = new Map<string, Array<Entity>>();
  for (const entity of dated) {
    const key = entity.kind === 'release' ? entity.id : (entity.release ?? '');
    const rows = assigned.get(key) ?? [];
    rows.push(entity);
    assigned.set(key, rows);
  }

  const groups = data.releases
    .map(({ id, title }) => ({ id, name: title, rows: assigned.get(id) ?? [] }))
    .filter(({ rows }) => rows.length > 0);
  const unassigned = assigned.get('') ?? [];
  if (unassigned.length > 0) {
    groups.push({ id: '', name: 'Unassigned release', rows: unassigned });
  }

  return groups;
}

/**
 * Renders the Gantt/List switch and the grouping and zoom chips. They need the timeline script, so
 * they stay hidden until it marks them ready, and upgrade to UI SDK controls on first use.
 *
 * @returns Controls.
 */
function chartTools(): SafeHtml {
  return html`<div class="timeline-tools" data-timeline-tools>
    <ui-segmented-control
      class="segmented"
      role="radiogroup"
      aria-label="Timeline view"
      data-timeline-view
    >
      <ui-segmented-control-indicator></ui-segmented-control-indicator>
      <ui-segmented-control-item value="chart" role="radio" aria-checked="true" tabindex="0"
        >Gantt</ui-segmented-control-item
      >
      <ui-segmented-control-item value="list" role="radio" aria-checked="false" tabindex="-1"
        >List</ui-segmented-control-item
      >
    </ui-segmented-control>
    <div class="timeline-settings" data-timeline-settings>
      ${chip(
        {
          param: 'group',
          label: 'Group by',
          placeholder: 'Release',
          choices: [
            ['release', 'Release'],
            ['set', 'Feature set'],
            ['team', 'Engineering team'],
          ],
        },
        true,
      )}
      ${chip(
        {
          param: 'zoom',
          label: 'Zoom',
          placeholder: 'Months',
          choices: [
            ['month', 'Months'],
            ['quarter', 'Quarters'],
          ],
        },
        true,
      )}
    </div>
  </div>`;
}

/**
 * Renders the Gantt chart with its lanes, rulers, legend and lane names for regrouping.
 *
 * @param data Indexed roadmap.
 * @param axis Chart range.
 * @param groups Release lanes.
 * @param view Profile, when the timeline is personal.
 * @returns Chart section.
 */
function chart(
  data: SiteData,
  axis: Axis,
  groups: ReadonlyArray<Group>,
  view?: ProfileView,
): SafeHtml {
  const lanes = groups.map(
    ({ id, name, rows }) =>
      html`<details open data-filter-group data-lane="${id}">
        <summary class="gantt-group"><span>${name}</span></summary>
        ${rows.map((entity) => chartRow(data, axis, entity, view))}
      </details>`,
  );
  return html`<section class="gantt-section" data-timeline-chart aria-label="Gantt chart">
    <div class="gantt-scroll" tabindex="0" role="region" aria-label="Gantt chart, scrolls sideways">
      <div
        class="gantt"
        data-gantt
        data-zoom="month"
        data-start="${axis.start}"
        data-end="${axis.end}"
        style="--months:${axis.months}"
      >
        <div class="gantt-axis" aria-hidden="true">
          <span class="gantt-corner">Work</span>
          <div class="gantt-axis-ruler">${axisRulers(axis)}</div>
        </div>
        <div class="gantt-lanes" data-gantt-lanes>${lanes}</div>
        <span class="gantt-today" data-today hidden></span>
        <svg class="gantt-edges" aria-hidden="true" data-gantt-edges></svg>
      </div>
    </div>
    <div class="gantt-legend">
      <span><i class="legend-work"></i>Scheduled</span>
      <span><i class="legend-window"></i>Target window</span>
      <span><i class="legend-day"></i>Exact date</span>
      <span><i class="legend-actual"></i>Actual date</span>
      <span><i class="legend-today"></i>Today</span>
      <noscript><a href="#dated-list">Go to timeline list</a></noscript>
    </div>
    ${laneNames(data)}
    <ui-tooltip id="timeline-tip" side="top"
      ><ui-tooltip-content class="tip"></ui-tooltip-content
    ></ui-tooltip>
  </section>`;
}

/**
 * Lists the lane names of each grouping in display order, for the script that regroups the chart.
 *
 * @param data Releases, feature sets and teams.
 * @returns Hidden name lists.
 */
function laneNames(data: SiteData): SafeHtml {
  const modes: ReadonlyArray<[string, ReadonlyArray<readonly [string, string]>]> = [
    ['release', data.releases.map(({ id, title }) => [id, title] as const)],
    ['set', data.sets.map(({ id, title }) => [id, title] as const)],
    ['team', data.teams],
  ];
  return html`${modes.map(
    ([mode, names]) =>
      html`<div hidden data-lanes="${mode}">
        ${names.map(([id, name]) => html`<span data-lane-id="${id}">${name}</span>`)}
      </div>`,
  )}`;
}

/**
 * Inputs to the timeline lists.
 */
type ListParts = {
  /**
   * Dated records.
   */
  dated: ReadonlyArray<Entity>;

  /**
   * Records without dates.
   */
  undated: ReadonlyArray<Entity>;

  /**
   * Whether a chart is shown, so the dated list is its alternative.
   */
  axis: boolean;

  /**
   * Dependencies by item.
   */
  edges: Map<string, Array<Edge>>;

  /**
   * Profile, when the timeline is personal.
   */
  view: ProfileView | undefined;
};

/**
 * Renders the dated list (the chart's accessible alternative) and the undated records.
 *
 * @param data Indexed roadmap.
 * @param parts Records, dependencies and profile.
 * @returns Lists.
 */
function timelineLists(data: SiteData, parts: ListParts): SafeHtml {
  /**
   * Renders one record with its dependencies.
   *
   * @param entity Record.
   * @returns List item.
   */
  const renderRow = (entity: Entity): SafeHtml =>
    timelineRow(data, entity, parts.edges.get(entity.id) ?? [], parts.view);
  return html`${
    parts.axis
      ? html`<section class="page-section dated-list" data-timeline-list id="dated-list">
          <h2>Dated work</h2>
          <ul class="list" role="list">
            ${parts.dated.map(renderRow)}
          </ul>
        </section>`
      : ''
  }
  ${
    parts.undated.length > 0
      ? html`<section class="page-section" data-filter-group>
          <h2>Undated</h2>
          <ul class="list" role="list">
            ${parts.undated.map(renderRow)}
          </ul>
        </section>`
      : ''
  }`;
}

/**
 * Renders one list entry with its dates, status and dependencies.
 *
 * @param data Indexed roadmap.
 * @param entity Record.
 * @param edges Its dependencies.
 * @param view Profile, when the timeline is personal.
 * @returns List item.
 */
function timelineRow(
  data: SiteData,
  entity: Entity,
  edges: ReadonlyArray<Edge>,
  view?: ProfileView,
): SafeHtml {
  const dependencies =
    edges.length > 0
      ? html`<details class="record-dependencies">
          <summary>Dependencies (${edges.length})</summary>
          <ul class="edge-list">
            ${edges.map((edge) => edgeDetails(data, edge))}
          </ul>
        </details>`
      : '';
  return row({
    lead: kindGlyph(entity.kind),
    title: entityLink(data, entity.id),
    detail: html`<span>${datesHtml(entity)}</span>${dependencies}`,
    meta: statusPill(getStatus(entity)),
    attributes: filterAttributes(data, entity, view?.roles),
  });
}

/**
 * Renders the details panel the chart shows for a selected record.
 *
 * @param data Indexed roadmap.
 * @param entities Records on the timeline.
 * @param edges Dependencies by item.
 * @returns Hidden panels, one per record.
 */
function selectionPanels(
  data: SiteData,
  entities: ReadonlyArray<Entity>,
  edges: Map<string, Array<Edge>>,
): SafeHtml {
  const panels = entities.map((entity) => {
    const connections = edges.get(entity.id) ?? [];
    return html`<section class="timeline-record" data-selection="${entity.id}" hidden>
      <div>
        <div class="selection-head">
          <div>
            <p class="doc-kind">${kindGlyph(entity.kind)}${KIND_LABELS[entity.kind]}</p>
            <h2>${entity.title}</h2>
            <p class="minor">${datesHtml(entity)}</p>
            ${statusPill(getStatus(entity))}
          </div>
          <button
            type="button"
            class="button"
            data-clear-selection
            aria-label="Clear timeline selection"
          >
            ${icon('close')}
          </button>
        </div>
        ${
          connections.length > 0
            ? html`<h3>Dependencies</h3>
                <ul class="edge-list">
                  ${connections.map((edge) => edgeDetails(data, edge))}
                </ul>`
            : html`<p class="minor">No item dependencies.</p>`
        }
        <a class="facts-link" href="${data.base + route(entity.kind, entity.id)}"
          >Open details ${icon('arrow')}</a
        >
      </div>
    </section>`;
  });
  return html`<div class="timeline-selection" data-selection-box aria-live="polite">
    ${panels}
  </div>`;
}

/**
 * Lists every item dependency in the roadmap.
 *
 * @param data Indexed roadmap.
 * @returns Dependencies whose prerequisite exists.
 */
function graphEdges(data: SiteData): Array<Edge> {
  return data.items.flatMap((to) =>
    to.depends_on.flatMap(({ item, reason }) => {
      const from = data.byId.get(item);
      return from ? [{ from, to, reason }] : [];
    }),
  );
}

/**
 * Shows a dependency, its reason and any date conflict.
 *
 * @param data Indexed roadmap.
 * @param edge Dependency.
 * @returns List item.
 */
function edgeDetails(data: SiteData, { from, to, reason }: Edge): SafeHtml {
  const conflict = dateConflict(from, to);
  return html`<li
    data-edge-from="${from.id}"
    data-edge-to="${to.id}"
    data-conflict="${String(Boolean(conflict))}"
  >
    <div class="edge-pair">
      <div>${entityLink(data, from.id)}<span>${datesHtml(from)}</span></div>
      <span class="edge-arrow"
        >${icon('arrow')}<span class="visually-hidden">Required by</span></span
      >
      <div>${entityLink(data, to.id)}<span>${datesHtml(to)}</span></div>
    </div>
    ${reason ? html`<p>${reason}</p>` : ''}
    ${conflict ? html`<p class="edge-conflict">${conflict}</p>` : ''}
  </li>`;
}
