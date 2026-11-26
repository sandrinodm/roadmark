import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { catalogueFilters } from '../filter-forms.ts';
import { groupReleases } from '../release-groups.ts';
import { filterAttributes, UNASSIGNED_RELEASE } from '../scope.ts';
import { catalogueRow, catalogueTable, tableGroup } from '../ui/catalogue-table.ts';
import { icon, kindGlyph } from '../ui/glyph.ts';
import { html, joinHtml } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { progressBar } from '../ui/progress.ts';
import { row } from '../ui/row.ts';
import { countLabel, pageHead } from '../ui/section.ts';

/**
 * Lists feature sets and the delivery progress of their assigned items.
 *
 * @param data Compiled feature sets and item memberships.
 * @returns The searchable feature-set catalogue.
 */
export function featureSetsPage(data: SiteData): SafeHtml {
  const rows = data.sets.map((set) => featureSetRow(data, set));
  return html`<div class="page catalogue" data-filter-scope>
    ${pageHead('Feature sets', countLabel(data.sets.length, 'feature set'), {
      countHook: html`data-filter-count data-unit="feature set"`,
    })}
    ${rows.length ? catalogueFilters(data, 'set') : ''}
    ${
      rows.length
        ? html`<section data-filter-group aria-label="Feature sets">
            <div class="list">${rows}</div>
          </section>`
        : ''
    }
    ${catalogueEmpty('feature sets', rows.length, 'Add a feature set folder with a README.md.')}
  </div>`;
}

/**
 * Renders the Releases page (the site's home page): one table with a banner per quarter or month,
 * in chronological order, then releases without a target. Older links to the Items catalogue that
 * reach this page are forwarded by the boot script, using the anchors listed here.
 *
 * @param data Dated releases and their assigned work.
 * @param itemsAnchors Fragment ids the Items page renders.
 * @returns Page content.
 */
export function releasePlan(data: SiteData, itemsAnchors: ReadonlyArray<string>): SafeHtml {
  const unassigned = data.itemsByRelease.get('')?.length ?? 0;
  const unassignedHref = `${data.base}items/?release=${UNASSIGNED_RELEASE}&type=item#browse`;
  const groups = groupReleases(data.releases).map(({ key, label, releases }) =>
    tableGroup({
      id: `releases-${key}`,
      title: label,
      rows: releases.map((release) => catalogueRow(data, release)),
      count: releases.length,
      unit: 'release',
    }),
  );
  return html`<div
    class="page catalogue"
    data-filter-scope
    data-items-forward="${data.base}items/"
    data-items-anchors="${itemsAnchors.join(' ')}"
  >
    ${pageHead('Releases', countLabel(data.releases.length, 'release'), {
      countHook: html`data-filter-count data-unit="release"`,
      actions: html`<a class="button" href="${data.base}timeline/"
        >${icon('timeline')}View timeline</a
      >`,
    })}
    ${data.releases.length ? catalogueFilters(data, 'release') : ''}
    ${data.releases.length ? catalogueTable('Releases', 'Release', groups) : ''}
    ${catalogueEmpty('releases', data.releases.length, 'Add a release file under releases/.')}
    ${
      unassigned
        ? html`<p class="page-note">
            <a href="${unassignedHref}">${countLabel(unassigned, 'item')} without a release</a>
          </p>`
        : ''
    }
  </div>`;
}

/**
 * Presents a linked feature set and the status of its delivery.
 *
 * @param data Indexed item memberships and deployment prefix.
 * @param set Feature set to display.
 * @returns Row for one authored feature set.
 */
function featureSetRow(data: SiteData, set: Entity): SafeHtml {
  const items = data.itemsBySet.get(set.id) ?? [];
  const assigned = new Set(items.flatMap(({ release }) => (release ? [release] : [])));
  const releases = data.releases.filter(({ id }) => assigned.has(id));
  return row({
    tag: 'article',
    lead: kindGlyph('set'),
    title: html`<h2>${entityLink(data, set.id)}</h2>`,
    summary: set.outcome ?? set.description,
    detail: releases.length
      ? html`<span class="row-detail-label">Releases</span>
          ${joinHtml(releases.map(({ id }) => entityLink(data, id)))}`
      : '',
    meta: html`<span class="num">${countLabel(items.length, 'item')}</span>${progressBar(items)}`,
    attributes: filterAttributes(data, set),
  });
}

/**
 * Supplies an empty state on initial load and when filters exclude every record.
 *
 * @param plural Plural label for the record type.
 * @param count Number of records in the unfiltered collection.
 * @param hint What to do when there are none yet.
 * @returns An accessible, progressively enhanced empty state.
 */
function catalogueEmpty(plural: string, count: number, hint: string): SafeHtml {
  const message = count ? `No ${plural} match these filters.` : `No ${plural} yet. ${hint}`;
  return html`<p class="catalogue-empty" data-filter-empty ${count ? html`hidden` : ''}>
    ${message}
  </p>`;
}
