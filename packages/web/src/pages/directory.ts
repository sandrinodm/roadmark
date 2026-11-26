import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { getStatus, route } from '../data.ts';
import { kindGlyph } from '../ui/glyph.ts';
import { html } from '../ui/html.ts';
import { time } from '../ui/links.ts';
import { statusPill } from '../ui/pill.ts';
import { row, rowList } from '../ui/row.ts';
import { countLabel, pageHead } from '../ui/section.ts';

/**
 * Lists direct links to all the work scopes in the published roadmap.
 *
 * @param data Indexed directory entries and planning records.
 * @returns Grouped view directory HTML.
 */
export function viewsPage(data: SiteData): SafeHtml {
  const groups = [
    ['Feature sets', 'set', data.sets, data.itemsBySet],
    ['Releases', 'release', data.releases, data.itemsByRelease],
  ] as const;
  const sections = groups.flatMap(([heading, kind, entries, members]) => {
    if (!entries.length) {
      return [];
    }

    const rows = entries.map((entry) => {
      const size = members.get(entry.id)?.length ?? 0;
      const date = entry.shipped_on ?? entry.target;
      return row({
        lead: kindGlyph(kind),
        title: html`<a href="${scopeHref(data, kind, entry.id)}">${entry.title}</a>`,
        summary: entry.description,
        meta: html`<span class="num">${countLabel(size, 'item')}</span> ${date ? time(date) : ''}
          ${kind === 'set' ? '' : statusPill(getStatus(entry))}`,
      });
    });
    return [
      html`<section class="page-section" aria-labelledby="scopes-${kind}">
        <h2 id="scopes-${kind}">${heading}</h2>
        ${rowList(rows, '')}
      </section>`,
    ];
  });
  const total = data.sets.length + data.releases.length;
  return html`<div class="page">
    ${directoryHeader(data, 'scopes', countLabel(total, 'scope'))}
    ${sections.length ? sections : html`<p class="empty">No work scopes yet. Add a feature set or a release.</p>`}
  </div>`;
}

/**
 * Links a work scope to its list of items: a feature set's Items tab, a release's scope section.
 *
 * @param data Deployment prefix.
 * @param kind Scope kind.
 * @param id Scope ID.
 * @returns URL.
 */
function scopeHref(data: SiteData, kind: 'set' | 'release', id: string): string {
  const page = data.base + route(kind, id);
  return kind === 'set' ? `${page}items/` : `${page}#roadmap-items`;
}

/**
 * Renders the directory title, count and the tabs between People, Teams and Work scopes.
 *
 * @param data Compiled workspace and base path.
 * @param current Directory section shown on this page.
 * @param count Count line for the current section.
 * @returns Page header and directory navigation.
 */
export function directoryHeader(
  data: SiteData,
  current: 'people' | 'teams' | 'scopes',
  count: string,
): SafeHtml {
  const sections = [
    ['people', 'people/', 'People'],
    ['teams', 'teams/', 'Teams'],
    ['scopes', 'views/scopes/', 'Work scopes'],
  ] as const;
  const tabs = sections.map(
    ([id, path, name]) =>
      html`<a href="${data.base}${path}" ${id === current ? html`aria-current="page"` : ''}
        >${name}</a
      >`,
  );
  const title = sections.find(([id]) => id === current)?.[2] ?? 'Directory';
  return html`${pageHead(title, count)}
    <nav class="subnav" aria-label="Directory">${tabs}</nav>`;
}
