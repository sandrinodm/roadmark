import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from './data.ts';
import type { Chip } from './ui/filter-bar.ts';
import type { HtmlValue, SafeHtml } from './ui/html.ts';

import { getStatus, KIND_LABELS, STATUS_LABELS } from './data.ts';
import { roleKey, roleLabel, UNASSIGNED_RELEASE } from './scope.ts';
import { filterBar } from './ui/filter-bar.ts';
import { html } from './ui/html.ts';

/**
 * A filter option pairs the option value with its label.
 */
type Choice = readonly [value: string, label: string];

/**
 * Record types the Items search can look through instead of items.
 */
const RECORD_TYPES: ReadonlyArray<Choice> = [
  ['item', 'Items'],
  ['all', 'All records'],
  ['set', 'Feature sets'],
  ['release', 'Releases'],
  ['person', 'People'],
  ['team', 'Teams'],
];

/**
 * Renders the timeline's filter chips.
 *
 * @param data Indexed roadmap used to populate choices.
 * @returns Filter bar.
 */
export function timelineFilters(data: SiteData): SafeHtml {
  const kinds = Object.entries(KIND_LABELS).filter(([kind]) => kind !== 'set');
  const states = ['proposed', 'planned', 'in-progress', 'done', 'shipped', 'cancelled'];
  return filterBar('Timeline filters', [
    { param: 'type', label: 'Type', choices: kinds },
    {
      param: 'status',
      label: 'Status',
      choices: states.map((state) => [state, STATUS_LABELS[state] ?? state]),
    },
    { param: 'release', label: 'Release', choices: releaseChoices(data) },
    { param: 'set', label: 'Feature set', choices: data.sets.map(toChoice) },
    { param: 'team', label: 'Team', choices: data.teams },
  ]);
}

/**
 * Renders the chips of one scoped item list, offering only values present in it.
 *
 * @param data Indexed roadmap labels.
 * @param items Items in the scope before reader filters.
 * @param roles Optional involvement labels keyed by item ID.
 * @returns Filter bar.
 */
export function itemFilters(
  data: SiteData,
  items: ReadonlyArray<Entity>,
  roles?: Map<string, Array<string>>,
): SafeHtml {
  const releases = new Set(items.map((item) => item.release ?? UNASSIGNED_RELEASE));
  const sets = new Set(items.map((item) => item.set));
  const states = new Set(items.map(getStatus));
  const roleLabels = [...new Set([...(roles?.values() ?? [])].flat().map(roleLabel))].toSorted();
  const chips: Array<Chip> = [
    {
      param: 'status',
      label: 'Status',
      choices: Object.entries(STATUS_LABELS).filter(([id]) => states.has(id)),
    },
    {
      param: 'release',
      label: 'Release',
      choices: releaseChoices(data).filter(([id]) => releases.has(id)),
    },
    {
      param: 'set',
      label: 'Feature set',
      choices: data.sets.filter(({ id }) => sets.has(id)).map(toChoice),
    },
    {
      param: 'role',
      label: 'Involvement',
      choices: roleLabels.map((label) => [roleKey(label), label]),
    },
  ];
  return filterBar('Item filters', chips);
}

/**
 * Renders the Items page's search field and chips; any type other than items switches to search
 * results.
 *
 * @param data Indexed roadmap labels.
 * @returns Filter bar.
 */
export function catalogueSearch(data: SiteData): SafeHtml {
  return filterBar(
    'Search and filter items',
    [
      { param: 'type', label: 'Type', placeholder: 'Items', choices: RECORD_TYPES },
      { param: 'status', label: 'Status', choices: Object.entries(STATUS_LABELS) },
      { param: 'release', label: 'Release', choices: releaseChoices(data) },
      { param: 'set', label: 'Feature set', choices: data.sets.map(toChoice) },
      { param: 'team', label: 'Team', choices: data.teams },
    ],
    { param: 'q', label: 'Search items', mode: 'index' },
  );
}

/**
 * A scoped list of items with its heading and rendered rows.
 */
export type ItemScope = {
  /**
   * Full membership of the section.
   */
  items: ReadonlyArray<Entity>;

  /**
   * Section heading.
   */
  title: string;

  /**
   * Rendered rows or the empty state.
   */
  content: HtmlValue;

  /**
   * Optional involvement labels keyed by item ID.
   */
  roles?: Map<string, Array<string>>;
};

/**
 * Combines a scoped list with its count, filter chips and filtered empty state.
 *
 * @param data Indexed roadmap labels.
 * @param scope Items, heading, rows and roles.
 * @returns Addressable, filterable section.
 */
export function itemSection(data: SiteData, { items, title, content, roles }: ItemScope): SafeHtml {
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
  return html`<section class="doc-section" id="roadmap-items" data-filter-scope>
    <div class="section-head">
      <h2>${title}</h2>
      <p class="section-count num" data-filter-count data-unit="item" role="status">${count}</p>
    </div>
    ${items.length > 0 ? itemFilters(data, items, roles) : ''} ${content}
    ${
      items.length > 0
        ? html`<p class="empty" data-filter-empty hidden>No items match these filters.</p>`
        : ''
    }
  </section>`;
}

/**
 * Renders the local search and chip of the Releases and Feature sets pages.
 *
 * @param data Indexed values for the chip options.
 * @param kind Collection being filtered.
 * @returns Filter bar.
 */
export function catalogueFilters(data: SiteData, kind: 'release' | 'set'): SafeHtml {
  const name = kind === 'release' ? 'releases' : 'feature sets';
  const chip: Chip =
    kind === 'release'
      ? {
          param: 'collection-status',
          field: 'status',
          label: 'Status',
          choices: Object.entries(STATUS_LABELS).filter(([id]) =>
            data.releases.some(({ status }) => id === status),
          ),
        }
      : { param: 'collection-team', field: 'team', label: 'Team', choices: data.teams };
  return filterBar(`Filter ${name}`, [chip], {
    param: 'collection-q',
    label: `Search ${name}`,
    mode: 'contains',
  });
}

/**
 * Lists releases, then the "Unassigned" choice for items without one.
 *
 * @param data Indexed releases.
 * @returns Release choices.
 */
export function releaseChoices(data: SiteData): Array<Choice> {
  return [...data.releases.map(toChoice), [UNASSIGNED_RELEASE, 'Unassigned']];
}

/**
 * Converts a record to a choice without deriving an ID from its title.
 *
 * @param entity Record.
 * @returns ID and title.
 */
export function toChoice(entity: Entity): Choice {
  return [entity.id, entity.title];
}
