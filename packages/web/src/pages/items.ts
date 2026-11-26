import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { catalogueSearch } from '../filter-forms.ts';
import { catalogueRow, catalogueTable, tableGroup } from '../ui/catalogue-table.ts';
import { html } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { countLabel, pageHead } from '../ui/section.ts';

/**
 * Renders the item inventory: every item grouped by feature set, with its outcome, status and
 * target, and an inline search that the browser reveals.
 *
 * @param data Compiled workspace records and deployment prefix.
 * @returns Page content.
 */
export function itemsPage(data: SiteData): SafeHtml {
  const count = data.items.length;
  const groups = data.sets.map((set) => workGroup(data, data.itemsBySet.get(set.id) ?? [], set));
  return html`<div class="page catalogue" data-index="${data.base}search-index.json">
    ${pageHead('Items', countLabel(count, 'item'), {
      countHook: html`data-filter-count data-unit="item"`,
    })}
    <section id="browse" aria-label="Roadmap records" data-filter-scope>
      ${catalogueSearch(data)}
      <div data-index-list>
        <div data-work-list ${count > 0 ? '' : html`hidden`}>
          ${catalogueTable('Roadmap items', 'Item', [groups, workGroup(data, data.itemsBySet.get('') ?? [])])}
        </div>
        <p class="empty" data-filter-empty ${count > 0 ? html`hidden` : ''}>
          ${count > 0 ? 'No items match these filters.' : 'No items have been added.'}
        </p>
      </div>
      <section
        class="catalogue-results"
        data-inline-results
        aria-labelledby="work-results-title"
        hidden
      >
        <div class="catalogue-results-heading">
          <h2 id="work-results-title">Search results</h2>
          <p data-search-message role="status"></p>
        </div>
        <ul class="list" role="list" data-search-results></ul>
      </section>
    </section>
  </div>`;
}

/**
 * Renders the items of one feature set as a row group under its banner.
 *
 * @param data Indexed roadmap and deployment prefix.
 * @param items Items in the feature set.
 * @param set Feature set, when the items have one.
 * @returns Row group, or nothing when empty.
 */
function workGroup(data: SiteData, items: ReadonlyArray<Entity>, set?: Entity): SafeHtml | '' {
  if (items.length === 0) {
    return '';
  }

  return tableGroup({
    id: set ? `queue-set-${set.id}` : 'queue-unassigned',
    title: set ? entityLink(data, set.id) : 'No feature set',
    rows: items.map((item) => catalogueRow(data, item)),
    count: items.length,
    unit: 'item',
    attributes: html`data-work-group data-work-set="${set?.id ?? ''}"`,
  });
}
