import type { SiteData } from '../data.ts';
import type { ProfileView } from '../profile-view.ts';
import type { SafeHtml } from '../ui/html.ts';

import { avatarFor, personName, route } from '../data.ts';
import { entityRows } from '../ui/entity-rows.ts';
import { html, joinHtml } from '../ui/html.ts';
import { personAvatar, teamLink } from '../ui/links.ts';
import { row, rowList } from '../ui/row.ts';
import { countLabel } from '../ui/section.ts';
import { directoryHeader } from './directory.ts';
import { profileHeading, profileRail, workSection } from './profile-work.ts';

/**
 * Renders the people directory with stable profile links and team membership.
 *
 * @param data Indexed people and teams.
 * @returns Page content.
 */
export function peoplePage(data: SiteData): SafeHtml {
  const ids = data.people.map(([id]) => id);
  const count = ids.length === 1 ? '1 person' : `${ids.length} people`;
  return html`<div class="page">
    ${directoryHeader(data, 'people', count)}
    ${personList(data, ids, 'No people yet. Add them to people.yaml.', true)}
  </div>`;
}

/**
 * Shows a person's teams, owned feature sets and directly assigned items.
 *
 * @param data Indexed workspace and assignments.
 * @param view Person and their items.
 * @returns Page content.
 */
export function personPage(data: SiteData, view: ProfileView): SafeHtml {
  const person = data.workspace.person_details?.[view.id];
  const owned = (data.workByPerson.get(view.id) ?? []).filter(
    ({ kind, pm }) => kind === 'set' && pm === view.id,
  );
  const teams = person?.teams ?? [];
  const facts = [
    {
      term: 'Teams',
      value: joinHtml(
        teams.map((team) => teamLink(data, team)),
        html`<br />`,
      ),
      wide: true,
    },
    { term: 'Assigned items', value: html`${countLabel(view.items.length, 'item')}` },
  ];
  return html`<div class="doc">
    ${profileHeading('Person', personAvatar(avatarFor(data, view.id)), view.name, person?.role)}
    <div class="doc-body">
      ${profileRail(view, facts, 'View personal timeline')}
      <div class="doc-main">
        ${workSection(data, view, 'No roadmap items assigned to this person.')}
        ${
          owned.length > 0
            ? html`<section class="doc-section">
                <div class="section-head"><h2>Owned feature sets</h2></div>
                ${entityRows(data, owned, { empty: '' })}
              </section>`
            : ''
        }
      </div>
    </div>
  </div>`;
}

/**
 * Lists people with their role, telling homonyms apart by ID.
 *
 * @param data Indexed people and teams.
 * @param ids Person IDs in display order.
 * @param empty What to say when there is nobody.
 * @param showTeams Whether to list each person's teams.
 * @returns List or empty state.
 */
export function personList(
  data: SiteData,
  ids: ReadonlyArray<string>,
  empty: string,
  showTeams = false,
): SafeHtml {
  const nameCounts = new Map<string, number>();
  for (const id of ids) {
    const name = personName(data, id);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const rows = ids.map((id) => {
    const person = data.workspace.person_details?.[id];
    const teams = person?.teams ?? [];
    const name = personName(data, id);
    const duplicate = (nameCounts.get(name) ?? 0) > 1;
    const role = person?.role ?? '';
    const context = `person-context-${id}`;
    const described = duplicate || role ? html`aria-describedby="${context}"` : '';
    return row({
      lead: personAvatar(avatarFor(data, id)),
      title: html`<a href="${data.base + route('person', id)}" ${described}>${name}</a>`,
      detail:
        duplicate || role
          ? html`<span id="${context}">${role} ${duplicate ? html`<code>${id}</code>` : ''}</span>`
          : '',
      meta: showTeams
        ? html`<span class="row-teams">${teams.map((team) => teamLink(data, team))}</span>`
        : '',
    });
  });
  return rowList(rows, empty);
}
