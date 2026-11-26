import type { SiteData } from '../data.ts';
import type { ProfileView } from '../profile-view.ts';
import type { SafeHtml } from '../ui/html.ts';

import { byDate, route } from '../data.ts';
import { entityRows } from '../ui/entity-rows.ts';
import { kindGlyph } from '../ui/glyph.ts';
import { html, joinHtml } from '../ui/html.ts';
import { entityLink, teamLink } from '../ui/links.ts';
import { row, rowList } from '../ui/row.ts';
import { countLabel } from '../ui/section.ts';
import { directoryHeader } from './directory.ts';
import { personList } from './people.ts';
import { profileHeading, profileRail, workSection } from './profile-work.ts';

/**
 * Renders the team directory with members and owned items.
 *
 * @param data Indexed roadmap with the team registry.
 * @returns Page content.
 */
export function teamsPage(data: SiteData): SafeHtml {
  const rows = data.teams.map(([id]) => {
    const owned = data.items.filter(({ engineering_team }) => engineering_team === id).length;
    const members = data.peopleByTeam.get(id) ?? [];
    const href = data.base + route('team', id);
    return row({
      lead: kindGlyph('team'),
      title: teamLink(data, id),
      summary: data.workspace.team_details?.[id]?.description,
      meta: html`<a href="${href}#members">${countLabel(members.length, 'member')}</a> ${
          owned > 0
            ? html`<a href="${href}?role=owner#roadmap-items"
                >${countLabel(owned, 'item')} owned</a
              >`
            : html`<span>0 items owned</span>`
        }`,
    });
  });
  return html`<div class="page">
    ${directoryHeader(data, 'teams', countLabel(data.teams.length, 'team'))}
    ${rowList(rows, 'No teams yet. Add them to teams.yaml.')}
  </div>`;
}

/**
 * Renders a team's roster, its work and owned feature sets.
 *
 * @param data Indexed roadmap with members and work.
 * @param view Team and its items.
 * @returns Page content.
 */
export function teamPage(data: SiteData, view: ProfileView): SafeHtml {
  const sets = data.sets.filter(({ engineering_team }) => engineering_team === view.id);
  const members = data.peopleByTeam.get(view.id) ?? [];
  const owned = data.items.filter(({ engineering_team }) => engineering_team === view.id).length;
  const facts = [
    {
      term: 'Members',
      value: html`<a href="#members">${countLabel(members.length, 'member')}</a>`,
    },
    { term: 'Owned items', value: html`${countLabel(owned, 'item')}` },
    {
      term: 'Owned feature sets',
      value: joinHtml(
        sets.map(({ id }) => entityLink(data, id)),
        html`<br />`,
      ),
      wide: true,
    },
  ];
  const description = data.workspace.team_details?.[view.id]?.description;
  return html`<div class="doc">
    ${profileHeading('Team', kindGlyph('team'), view.name, description)}
    <div class="doc-body">
      ${profileRail(view, facts, 'View team timeline')}
      <div class="doc-main">
        <div>
          <span id="owned-items"></span><span id="contributing"></span>
          ${workSection(data, view, 'No roadmap items involve this team.')}
        </div>
        ${
          sets.length > 0
            ? html`<section class="doc-section">
                <div class="section-head"><h2>Owned feature sets</h2></div>
                ${entityRows(data, sets.toSorted(byDate), { empty: '' })}
              </section>`
            : ''
        }
        <section class="doc-section" id="members">
          <div class="section-head"><h2>Members</h2></div>
          ${personList(
            data,
            members,
            'No members are listed for this team. Add the team to a person in people.yaml.',
          )}
        </section>
      </div>
    </div>
  </div>`;
}
