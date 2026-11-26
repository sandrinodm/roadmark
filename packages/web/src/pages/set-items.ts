import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { byDate, route } from '../data.ts';
import { catalogueRow, catalogueTable, tableGroup } from '../ui/catalogue-table.ts';
import { html } from '../ui/html.ts';
import { countLabel } from '../ui/section.ts';

/**
 * Renders a feature set's Overview | Items tabs: plain links, so each tab has its own URL and works
 * without JavaScript.
 *
 * @param data Deployment prefix.
 * @param set Feature set.
 * @param current Tab shown on this page.
 * @returns Tab navigation.
 */
export function setTabs(data: SiteData, set: Entity, current: 'overview' | 'items'): SafeHtml {
  const page = data.base + route('set', set.id);
  const tabs = [
    ['overview', page, 'Overview'],
    ['items', `${page}items/`, 'Items'],
  ] as const;
  return html`<nav class="subnav doc-tabs" aria-label="${set.title} sections">
    ${tabs.map(
      ([id, href, label]) =>
        html`<a href="${href}" ${id === current ? html`aria-current="page"` : ''}>${label}</a>`,
    )}
  </nav>`;
}

/**
 * Renders a feature set's Items tab: its items in the Items table, by target, without banners.
 *
 * @param data Indexed roadmap.
 * @param set Feature set.
 * @param heading The set's page heading, shared with its Overview tab.
 * @returns Page content.
 */
export function setItemsPage(data: SiteData, set: Entity, heading: SafeHtml): SafeHtml {
  const items = (data.itemsBySet.get(set.id) ?? []).toSorted(byDate);
  return html`<article class="doc">
    ${heading} ${setTabs(data, set, 'items')}
    <section class="doc-section" aria-label="Items in ${set.title}">
      <p class="section-count num">${countLabel(items.length, 'item')}</p>
      ${
        items.length > 0
          ? catalogueTable(
              `Items in ${set.title}`,
              'Item',
              tableGroup({
                rows: items.map((item) => catalogueRow(data, item)),
                count: items.length,
                unit: 'item',
              }),
            )
          : html`<p class="empty">
              No items in this feature set yet. Add Markdown files to its items folder.
            </p>`
      }
    </section>
  </article>`;
}
