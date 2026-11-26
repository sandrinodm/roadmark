import type { Entity } from './model.ts';

import { escapeHtml } from './markdown.ts';

/**
 * Draws the current item's immediate prerequisites and dependents from the same relationships
 * validated by lint. Each node is an ordinary static link and the reading order follows delivery.
 */
export function dependencyDiagram(
  entities: ReadonlyArray<Entity>,
  file: string,
  base: string,
): string {
  const current = entities.find((entity) => entity.source === file);
  if (current?.kind !== 'item') {
    throw new Error('A dependency diagram belongs in a roadmap item.');
  }

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const prerequisites = current.depends_on.flatMap(({ item, reason }) => {
    const target = byId.get(item);
    return target ? [card(target, base, reason)] : [];
  });
  const dependents = entities.flatMap((entity) => {
    const dependency = entity.depends_on.find(({ item }) => item === current.id);
    return dependency ? [card(entity, base, dependency.reason)] : [];
  });
  return `<figure class="dependency-diagram"><figcaption>Item dependencies</figcaption>
    <div class="dependency-columns">
    ${column('Prerequisites', prerequisites, 'No prerequisites')}
    ${column('This item', [card(current, base)], '')}
    ${column('Enables', dependents, 'No dependent items')}
    </div></figure>`;
}

/**
 * Links to the stable item route and gives the relationship's authored reason when available.
 */
function card(item: Entity, base: string, reason?: string): string {
  const detail = reason ? '<p>' + escapeHtml(reason) + '</p>' : '';
  return `<li><a href="${escapeHtml(base)}items/${encodeURIComponent(item.id)}/">${escapeHtml(item.title)}</a>${detail}</li>`;
}

/**
 * Labels one stage of the dependency path and explicitly identifies its empty state.
 */
function column(label: string, cards: Array<string>, empty: string): string {
  const body = cards.length ? '<ul>' + cards.join('') + '</ul>' : '<p>' + empty + '</p>';
  return '<div><strong>' + label + '</strong>' + body + '</div>';
}
