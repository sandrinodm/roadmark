import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { ProfileView } from '../profile-view.ts';
import type { Fact } from '../ui/facts.ts';
import type { HtmlValue, SafeHtml } from '../ui/html.ts';

import { byDate } from '../data.ts';
import { itemSection } from '../filter-forms.ts';
import { filterAttributes } from '../scope.ts';
import { entityRows } from '../ui/entity-rows.ts';
import { factsRail, timelineLink } from '../ui/facts.ts';
import { html, joinHtml } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { tag } from '../ui/pill.ts';

/**
 * Lists each item a profile is involved in once, with every role and its planning context.
 *
 * @param data Indexed roadmap.
 * @param view Items and roles of the profile.
 * @param empty What to say when the profile has no items.
 * @returns Filterable section.
 */
export function workSection(data: SiteData, view: ProfileView, empty: string): SafeHtml {
  const items = view.items.toSorted(byDate);
  const content = entityRows(data, items, {
    empty,
    detail: (item) => workDetails(data, item, view.roles.get(item.id) ?? []),
    attributes: (item) => filterAttributes(data, item, view.roles),
  });
  return itemSection(data, { items, title: 'Roadmap items', content, roles: view.roles });
}

/**
 * Renders the facts rail of a person or team with a link to its timeline.
 *
 * @param view Profile.
 * @param facts Facts in display order.
 * @param label Timeline link text.
 * @returns Facts rail.
 */
export function profileRail(
  view: ProfileView,
  facts: ReadonlyArray<Fact>,
  label: string,
): SafeHtml {
  return factsRail(timelineLink(`${view.href}timeline/`, label), facts);
}

/**
 * Renders a profile page header with an optional portrait or glyph and lead line.
 *
 * @param kind Visible kind, "Person" or "Team".
 * @param mark Portrait or glyph beside the name.
 * @param name Display name.
 * @param lead Role or description.
 * @returns Page header.
 */
export function profileHeading(
  kind: string,
  mark: SafeHtml,
  name: string,
  lead: HtmlValue,
): SafeHtml {
  return html`<header class="doc-head">
    <p class="doc-kind">${kind}</p>
    <div class="doc-title-row">
      ${mark}
      <h1>${name}</h1>
    </div>
    ${lead ? html`<p class="doc-lead">${lead}</p>` : ''}
  </header>`;
}

/**
 * Shows a profile's roles on an item, then the item's feature set and release as labelled links
 * separated by dots.
 *
 * @param data Indexed roadmap used to link planning records.
 * @param item Item in the profile.
 * @param roles Role labels for this profile and item.
 * @returns Detail line.
 */
function workDetails(data: SiteData, item: Entity, roles: ReadonlyArray<string>): SafeHtml {
  const relations = [
    ['Feature set', item.set],
    ['Release', item.release],
  ].flatMap(([label, id]) =>
    id
      ? [
          html`<span class="relation"
            ><span class="relation-label">${label}</span> ${entityLink(data, id)}</span
          >`,
        ]
      : [],
  );
  return html`<span class="profile-roles">${roles.map((role) => tag(role))}</span> ${
      relations.length > 0
        ? html`<span class="relations"
            >${joinHtml(relations, html`<span class="relation-dot" aria-hidden="true">·</span>`)}</span
          >`
        : ''
    }`;
}
