import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { getStatus } from '../data.ts';
import { html } from '../ui/html.ts';
import { entityLink, teamLink, time } from '../ui/links.ts';
import { statusPill } from '../ui/pill.ts';
import { releaseOf } from './record-facts.ts';
import { scopeSection } from './scope-groups.ts';

/**
 * Compiler diagnostic rules relevant to a release's schedule.
 */
const SCHEDULE_RULES = new Set([
  'schedule-conflict',
  'dependency-schedule-conflict',
  'shipped-release-open-item',
]);

/**
 * Chooses the relationship sections for a record's kind.
 *
 * @param data Indexed roadmap and its relationships.
 * @param entity Record whose relationships are shown.
 * @returns Related sections.
 */
export function related(data: SiteData, entity: Entity): SafeHtml {
  if (entity.kind === 'item') {
    return itemRelationships(data, entity);
  }

  if (entity.kind === 'release') {
    const items = data.itemsByRelease.get(entity.id) ?? [];
    return html`${scopeSection(data, 'Release scope', items, 'set')}
    ${releaseRelationships(data, entity)}`;
  }

  // A feature set lists its items on its own Items tab.
  return html``;
}

/**
 * Renders a relationship list under a heading, or nothing when it is empty.
 *
 * @param title Visible heading.
 * @param entries Rendered rows.
 * @param level Heading level.
 * @returns Section, or nothing.
 */
export function relationshipSection(
  title: string,
  entries: ReadonlyArray<SafeHtml>,
  level: 2 | 3 = 2,
): SafeHtml | '' {
  if (entries.length === 0) {
    return '';
  }

  const heading = level === 2 ? html`<h2>${title}</h2>` : html`<h3>${title}</h3>`;
  return html`<section class="doc-section">
    <div class="section-head">${heading}</div>
    <ul class="list" role="list">
      ${entries}
    </ul>
  </section>`;
}

/**
 * Shows dependencies in both directions. The section has no generated id, so an authored "Related
 * work" heading in the brief keeps its own anchor.
 *
 * @param data Indexed roadmap with prerequisites and dependents.
 * @param entity Item whose relationships are shown.
 * @returns Related work section, or nothing.
 */
function itemRelationships(data: SiteData, entity: Entity): SafeHtml {
  const incoming = entity.depends_on.map(({ item, reason }) => relationship(data, item, reason));
  const outgoing = (data.blockedByItem.get(entity.id) ?? []).map((item) => {
    const reason = item.depends_on.find((dependency) => dependency.item === entity.id)?.reason;
    return relationship(data, item.id, reason);
  });
  const sections = [
    relationshipSection('Depends on', incoming, 3),
    relationshipSection('Required by', outgoing, 3),
  ].filter((section) => section !== '');
  return sections.length > 0
    ? html`<section class="doc-section">
        <h2>Related work</h2>
        ${sections}
      </section>`
    : html``;
}

/**
 * Renders a dependency with its reason, target and status.
 *
 * @param data Indexed roadmap used to resolve the item.
 * @param id Related item ID.
 * @param reason Authored reason, when present.
 * @returns Row.
 */
function relationship(data: SiteData, id: string, reason?: string): SafeHtml {
  const entity = data.byId.get(id);
  return html`<li class="request-row">
    <div>
      <strong>${entityLink(data, id)}</strong>
      ${reason ? html`<p>${reason}</p>` : ''}
      ${entity?.target ? html`<p class="minor">Target ${time(entity.target)}</p>` : ''}
    </div>
    ${entity ? statusPill(getStatus(entity)) : ''}
  </li>`;
}

/**
 * Shows a release's outside prerequisites and schedule warnings.
 *
 * @param data Indexed roadmap and diagnostics.
 * @param release Release on the page.
 * @returns Related sections.
 */
function releaseRelationships(data: SiteData, release: Entity): SafeHtml {
  const items = data.itemsByRelease.get(release.id) ?? [];
  return html`${relationshipSection(
    'Cross-release prerequisites',
    prerequisites(data, release.id, items),
  )}
  ${relationshipSection('Schedule warnings', warnings(data, release, items))}`;
}

/**
 * Finds item prerequisites outside the release.
 *
 * @param data Indexed roadmap used to resolve dependencies.
 * @param releaseId Release on the page.
 * @param items Items in the release.
 * @returns Rows naming each dependent item, its prerequisite and the prerequisite's release.
 */
function prerequisites(
  data: SiteData,
  releaseId: string,
  items: ReadonlyArray<Entity>,
): Array<SafeHtml> {
  return items.flatMap((item) =>
    item.depends_on.flatMap(({ item: id, reason }) => {
      const prerequisite = data.byId.get(id);
      if (!prerequisite || prerequisite.release === releaseId) {
        return [];
      }

      const team = prerequisite.engineering_team;
      return [
        html`<li class="request-row">
          <div>
            <p>${entityLink(data, item.id)} depends on ${entityLink(data, prerequisite.id)}</p>
            ${reason ? html`<p>${reason}</p>` : ''}
            <p class="minor">
              Prerequisite release
              ${releaseOf(data, prerequisite)}${team ? html` · ${teamLink(data, team)}` : ''}
            </p>
          </div>
          ${statusPill(getStatus(prerequisite))}
        </li>`,
      ];
    }),
  );
}

/**
 * Keeps the schedule warnings about the release and its scope.
 *
 * @param data Diagnostics and records.
 * @param release Release on the page.
 * @param scope Items in the release.
 * @returns Warning rows.
 */
function warnings(data: SiteData, release: Entity, scope: ReadonlyArray<Entity>): Array<SafeHtml> {
  const sources = new Map([release, ...scope].map((entity) => [entity.source, entity.id]));
  return data.diagnostics.flatMap(({ severity, rule, file, message }) => {
    const id = sources.get(file);
    if (severity !== 'warning' || !SCHEDULE_RULES.has(rule) || !id) {
      return [];
    }

    return [
      html`<li class="request-row">
        <div>
          ${id === release.id ? '' : html`<strong>${entityLink(data, id)}</strong>`}
          <p>${message}</p>
        </div>
      </li>`,
    ];
  });
}
