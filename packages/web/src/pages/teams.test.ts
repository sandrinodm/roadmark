import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Element } from '../test-support.test.ts';

import { profileView } from '../profile-view.ts';
import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  hrefs,
  nth,
  pageText,
  profilesFixture,
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { teamPage, teamsPage } from './teams.ts';

/**
 * Two teams with members, a set and items owned by Growth, and a team without anything.
 */
const DATA = dataFor(
  [
    entity({
      kind: 'set',
      id: 'onboarding',
      title: 'Onboarding',
      engineering_team: 'growth',
      target: '2027-06',
    }),
    entity({ id: 'setup', title: 'Setup', engineering_team: 'growth', set: 'onboarding' }),
    entity({
      id: 'events',
      title: 'Events',
      engineering_team: 'growth',
      contributing_teams: ['ops team'],
    }),
    entity({
      id: 'help',
      title: 'Help',
      engineering_team: 'platform',
      contributing_teams: ['growth'],
    }),
  ],
  {
    people: { maya: 'Maya Chen', noor: 'Noor Patel' },
    teams: { growth: 'Growth', platform: 'Platform', 'ops team': HOSTILE },
    person_details: { maya: { teams: ['growth'] }, noor: { teams: ['growth', 'platform'] } },
    team_details: { growth: { description: 'Owns activation & onboarding.' } },
  },
);

void describe('teamsPage', () => {
  void it('lists teams with their description, member count and owned items', () => {
    const root = fragment(teamsPage(DATA));
    assert.equal(textOf(findOne(root, 'h1')), 'Teams');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '3 teams');
    const rows = findAll(root, 'li', { class: 'row' });
    assert.deepEqual(
      rows.map((row) => attr(findOne(findOne(row, 'div', { class: 'row-title' }), 'a'), 'href')),
      [`${BASE}teams/ops%20team/`, `${BASE}teams/growth/`, `${BASE}teams/platform/`],
    );
    const growth = nth(rows, 1);
    assert.equal(
      textOf(findOne(growth, 'p', { class: 'row-summary' })),
      'Owns activation & onboarding.',
    );
    const meta = findOne(growth, 'div', { class: 'row-meta' });
    assert.deepEqual(
      findAll(meta, 'a').map((link) => [attr(link, 'href'), textOf(link)]),
      [
        [`${BASE}teams/growth/#members`, '2 members'],
        [`${BASE}teams/growth/?role=owner#roadmap-items`, '2 items owned'],
      ],
    );
    assert.equal(
      textOf(findOne(nth(rows, 2), 'div', { class: 'row-meta' })),
      '1 member 1 item owned',
    );
  });

  void it('shows zero owned items as text and escapes team names', () => {
    const root = fragment(teamsPage(DATA));
    const hostile = nth(findAll(root, 'li', { class: 'row' }), 0);
    assert.equal(textOf(findOne(findOne(hostile, 'div', { class: 'row-title' }), 'a')), HOSTILE);
    const meta = findOne(hostile, 'div', { class: 'row-meta' });
    assert.deepEqual(hrefs(meta), [`${BASE}teams/ops%20team/#members`]);
    assert.equal(textOf(meta), '0 members 0 items owned');
    assert.deepEqual(findAll(hostile, 'p', { class: 'row-summary' }), []);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('explains how to add teams', () => {
    const root = fragment(teamsPage(dataFor([])));
    assert.equal(
      textOf(findOne(root, 'p', { class: 'empty' })),
      'No teams yet. Add them to teams.yaml.',
    );
  });
});

void describe('teamPage', () => {
  void it('heads the profile with the description and links the team timeline', () => {
    const root = fragment(teamPage(DATA, profileView(DATA, 'team', 'growth')));
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-kind' })), 'Team');
    assert.equal(textOf(findOne(root, 'h1')), 'Growth');
    assert.equal(
      textOf(findOne(root, 'p', { class: 'doc-lead' })),
      'Owns activation & onboarding.',
    );
    assert.equal(
      attr(
        findOne(findOne(root, 'header', { class: 'doc-head' }), 'span', { class: 'glyph' }),
        'data-kind',
      ),
      'team',
    );
    assert.equal(
      attr(findOne(root, 'a', { class: 'facts-link' }), 'href'),
      `${BASE}teams/growth/timeline/`,
    );
  });

  void it('counts members and owned items and links owned sets in the facts', () => {
    const rail = findOne(fragment(teamPage(DATA, profileView(DATA, 'team', 'growth'))), 'aside');
    const values = Object.fromEntries(
      findAll(rail, 'dt').map((term, index) => [textOf(term), nth(findAll(rail, 'dd'), index)]),
    );
    assert.equal(textOf(shownFact(values, 'Members')), '2 members');
    assert.deepEqual(hrefs(shownFact(values, 'Members')), ['#members']);
    assert.equal(textOf(shownFact(values, 'Owned items')), '2 items');
    assert.deepEqual(hrefs(shownFact(values, 'Owned feature sets')), [`${BASE}sets/onboarding/`]);
  });

  void it('lists involved items with roles, owned sets and linked members', () => {
    const root = fragment(teamPage(DATA, profileView(DATA, 'team', 'growth')));
    assert.equal(findAll(root, 'span', { id: 'owned-items' }).length, 1);
    assert.equal(findAll(root, 'span', { id: 'contributing' }).length, 1);
    const work = findOne(root, 'section', { id: 'roadmap-items' });
    assert.deepEqual(
      findAll(work, 'li', { class: 'row' }).map((row) => [
        attr(row, 'data-filter-entry'),
        attr(row, 'data-role'),
      ]),
      [
        ['events', 'owner'],
        ['help', 'contributing-team'],
        ['setup', 'owner'],
      ],
    );
    const members = findOne(root, 'section', { id: 'members' });
    assert.deepEqual(
      hrefs(members).filter((href) => href.includes('/people/')),
      [`${BASE}people/maya/`, `${BASE}people/noor/`],
    );
    assert.ok(textOf(root).includes('Owned feature sets'));
  });

  void it('shows empty states for a team without members, items or sets', () => {
    const root = fragment(teamPage(DATA, profileView(DATA, 'team', 'ops team')));
    assert.equal(textOf(findOne(root, 'h1')), HOSTILE);
    assert.deepEqual(findAll(root, 'p', { class: 'doc-lead' }), []);
    assert.deepEqual(findAll(root, 'script'), []);
    const work = findOne(root, 'section', { id: 'roadmap-items' });
    assert.deepEqual(
      findAll(work, 'li').map((row) => attr(row, 'data-filter-entry')),
      ['events'],
    );
    const empty = fragment(
      teamPage(
        dataFor([], { teams: { idle: 'Idle' } }),
        profileView(dataFor([], { teams: { idle: 'Idle' } }), 'team', 'idle'),
      ),
    );
    assert.deepEqual(
      findAll(empty, 'p', { class: 'empty' }).map((paragraph) => textOf(paragraph)),
      [
        'No roadmap items involve this team.',
        'No members are listed for this team. Add the team to a person in people.yaml.',
      ],
    );
    assert.ok(!textOf(empty).includes('Owned feature sets'));
  });

  void it('links team members and lists each involved item with its team roles', async () => {
    const files = await renderSite(profilesFixture(), TEAM_BASE);
    const team = pageText(files, 'teams/design/index.html');
    assert.match(team, /Facilitates reviews &amp; design/);
    assert.ok(team.includes(`href="${TEAM_BASE}people/alex/"`));
    assert.ok(team.includes(`href="${TEAM_BASE}people/taylor/"`));
    assert.doesNotMatch(team, /people\/alex-ops\//);
    const items = team.slice(team.indexOf('id="roadmap-items"'), team.indexOf('id="members"'));
    assert.match(team, /id="owned-items"/);
    assert.match(team, /id="contributing"/);
    assert.equal(items.match(/>Publish updates<\/a>/g)?.length, 1);
    assert.match(items, /Owner \(from feature set\)<\/span>/);
    assert.match(items, /Contributing team<\/span>/);
    assert.doesNotMatch(team, /request/i);
    assert.match(items, /Get a design review/);
    assert.doesNotMatch(items, /Write release copy/);
  });
});

/**
 * Reads the value of a fact that must be shown.
 *
 * @param values Parsed values keyed by term.
 * @param term Fact term.
 * @returns The value element.
 */
function shownFact(values: Record<string, Element>, term: string): Element {
  const value = values[term];
  assert.ok(value, `${term} is shown`);
  return value;
}
