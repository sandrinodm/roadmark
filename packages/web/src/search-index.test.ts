import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { siteData } from './data.ts';
import { renderSite } from './render.ts';
import { searchIndex } from './search-index.ts';
import { BASE, dataFor, entity, fixture, pageText, TEAM_BASE } from './test-support.test.ts';

/**
 * Records covering links, involvement, a target and a record without optional fields.
 */
const RECORDS = [
  entity({
    id: 'setup',
    title: 'Guided "setup"',
    description: 'Walks admins through setup.',
    outcome: 'Admins finish setup.',
    target: '2027-04',
    release: 'spring',
    set: 'onboarding',
    pm: 'maya',
    contributors: ['noor', 'maya'],
    engineering_team: 'growth',
    contributing_teams: ['platform'],
    jira: ['ONB-1'],
    text: 'Body text',
    links: [{ label: 'Spec', url: 'https://docs.example.com/spec' }],
  }),
  entity({ kind: 'release', id: 'spring', title: 'Spring', target: '2027-Q2', text: '' }),
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding' }),
];

/**
 * The records with people and teams, one of them without details.
 */
const DATA = dataFor(RECORDS, {
  people: { maya: 'Maya Chen', noor: 'Noor Patel', sam: 'Sam' },
  teams: { growth: 'Growth', platform: 'Platform' },
  person_details: {
    maya: { avatar: 'avatars/maya.webp', role: 'Product Manager', teams: ['growth', 'platform'] },
  },
  team_details: { growth: { description: 'Owns activation.' } },
});

void describe('searchIndex', () => {
  void it('indexes records with their memberships, labels and base-prefixed links', () => {
    const index = searchIndex(DATA);
    assert.ok(index.startsWith('[{'), 'the index is a JSON array of entries, records first');
    assert.ok(
      index.includes(
        JSON.stringify({
          type: 'item',
          status: '',
          release: ['spring'],
          set: ['onboarding'],
          teams: ['growth', 'platform'],
          kind: 'Item',
          href: `${BASE}items/setup/`,
          title: 'Guided "setup"',
          description: 'Walks admins through setup.',
          outcome: 'Admins finish setup.',
          target: 'Apr 2027',
          id: 'setup',
          jira: ['ONB-1'],
          text: 'Body text Spec https://docs.example.com/spec',
          involvement: 'growth Growth platform Platform noor Noor Patel maya Maya Chen',
        }),
      ),
    );
  });

  void it('gives scopes the memberships of their items and empty optional fields', () => {
    const index = searchIndex(DATA);
    assert.ok(
      index.includes(
        JSON.stringify({
          type: 'release',
          status: '',
          release: ['spring'],
          set: ['onboarding'],
          teams: ['growth', 'platform'],
          kind: 'Release',
          href: `${BASE}releases/spring/`,
          title: 'Spring',
          description: 'Fixture description',
          outcome: '',
          target: 'Q2 2027',
          id: 'spring',
          jira: [],
          text: '',
          involvement: 'growth Growth platform Platform',
        }),
      ),
    );
    assert.ok(index.includes(`"kind":"Feature set","href":"${BASE}sets/onboarding/"`));
  });

  void it('indexes teams with their description, or an empty one', () => {
    const index = searchIndex(DATA);
    assert.ok(
      index.includes(
        JSON.stringify({
          kind: 'Team',
          type: 'team',
          status: '',
          release: [],
          set: [],
          teams: ['growth'],
          href: `${BASE}teams/growth/`,
          title: 'Growth',
          description: 'Owns activation.',
          id: 'growth',
          jira: [],
          text: 'growth',
        }),
      ),
    );
    assert.ok(
      index.includes(`"href":"${BASE}teams/platform/","title":"Platform","description":""`),
    );
  });

  void it('indexes people with their avatar, role and team names', () => {
    const index = searchIndex(DATA);
    assert.ok(
      index.includes(
        JSON.stringify({
          avatar: { initials: 'MC', src: `${BASE}avatars/maya.webp` },
          kind: 'Person',
          type: 'person',
          status: '',
          release: [],
          set: [],
          teams: ['growth', 'platform'],
          href: `${BASE}people/maya/`,
          title: 'Maya Chen',
          description: 'Product Manager · Growth · Platform',
          id: 'maya',
          jira: [],
          text: '',
        }),
      ),
    );
    assert.ok(
      index.includes(
        `{"avatar":{"initials":"SA"},"kind":"Person","type":"person","status":"","release":[],"set":[],"teams":[],"href":"${BASE}people/sam/","title":"Sam","description":""`,
      ),
    );
  });

  void it('orders records by title, then teams and people by name', () => {
    const index = searchIndex(DATA);
    const order = [...index.matchAll(/"title":"((?:[^"\\]|\\.)*)"/g)].map(([, title]) => title);
    assert.deepEqual(order, [
      String.raw`Guided \"setup\"`,
      'Onboarding',
      'Spring',
      'Growth',
      'Platform',
      'Maya Chen',
      'Noor Patel',
      'Sam',
    ]);
  });

  void it('writes an empty array for an empty roadmap', () => {
    assert.equal(searchIndex(dataFor([])), '[]');
  });

  void it('keeps hostile text as JSON data rather than markup', () => {
    const index = searchIndex(dataFor([entity({ id: 'x', title: '</script><b>"' })]));
    assert.ok(index.includes(String.raw`"title":"</script><b>\""`));
  });

  void it('indexes records, people and teams', async () => {
    const files = await renderSite(fixture, TEAM_BASE);
    const index = pageText(files, 'search-index.json');
    assert.match(index, /"outcome":"Distinguishable release outcome"/);
    assert.doesNotMatch(index, /team request|"type":"request"|"type":"milestone"/i);
    assert.match(index, /"kind":"Team","type":"team"/);
    assert.equal(index, searchIndex(siteData(fixture, TEAM_BASE)));
  });
});
