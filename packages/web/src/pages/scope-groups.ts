import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { byDate } from '../data.ts';
import { itemSection } from '../filter-forms.ts';
import { filterAttributes } from '../scope.ts';
import { entityRows } from '../ui/entity-rows.ts';
import { html } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { progressBar } from '../ui/progress.ts';

/**
 * Shows a scope's progress and its items grouped by their feature set or release.
 *
 * @param data Indexed roadmap used to label groups.
 * @param title Section heading.
 * @param items Items in scope.
 * @param grouping Parent record to group by.
 * @returns Filterable section.
 */
export function scopeSection(
  data: SiteData,
  title: string,
  items: ReadonlyArray<Entity>,
  grouping: 'set' | 'release',
): SafeHtml {
  const groups = scopedGroups(data, items, grouping);
  const hint =
    grouping === 'set'
      ? html`No items in this release yet. Set <code>release:</code> in an item’s frontmatter.`
      : html`No items in this feature set yet. Add Markdown files to its items folder.`;
  const content =
    groups.length > 0
      ? html`<div class="scope-progress">${progressBar(items)}</div>
          ${groups}`
      : html`<p class="empty">${hint}</p>`;
  return itemSection(data, { items, title, content });
}

/**
 * Groups items by parent in the parents' display order, with ungrouped items last.
 *
 * @param data Indexed roadmap used to find and label parents.
 * @param items Items in scope.
 * @param grouping Parent field.
 * @returns One section per non-empty group.
 */
function scopedGroups(
  data: SiteData,
  items: ReadonlyArray<Entity>,
  grouping: 'set' | 'release',
): Array<SafeHtml> {
  const byParent = new Map<string, Array<Entity>>();
  for (const item of items) {
    const parent = item[grouping] ?? '';
    const members = byParent.get(parent) ?? [];
    members.push(item);
    byParent.set(parent, members);
  }

  const parents = grouping === 'set' ? data.sets : data.releases;
  const ungrouped = grouping === 'set' ? 'No feature set' : 'Unassigned';
  return [...parents.map(({ id }) => id), ''].flatMap((id) => {
    const members = byParent.get(id);
    if (!members) {
      return [];
    }

    return [
      html`<section class="scope-group" data-filter-group>
        <h3>${id ? entityLink(data, id) : ungrouped}</h3>
        ${entityRows(data, members.toSorted(byDate), {
          empty: '',
          attributes: (item) => filterAttributes(data, item),
        })}
      </section>`,
    ];
  });
}
