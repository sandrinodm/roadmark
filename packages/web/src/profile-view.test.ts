import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { profileView } from './profile-view.ts';
import { BASE, dataFor, entity } from './test-support.test.ts';

/**
 * A set owned by Alex and Design, an item inheriting both, and items with direct assignments.
 */
const DATA = dataFor(
  [
    entity({
      kind: 'set',
      id: 'design-system',
      title: 'Design system',
      pm: 'alex',
      engineering_team: 'design',
    }),
    entity({
      id: 'inherited',
      title: 'Inherited',
      set: 'design-system',
      pm: 'alex',
      inherited_pm: true,
      engineering_team: 'design',
      inherited_engineering_team: true,
      contributors: ['alex'],
      contributing_teams: ['design'],
    }),
    entity({
      id: 'direct',
      title: 'Direct',
      pm: 'alex',
      engineering_team: 'design',
      contributing_teams: ['platform'],
    }),
    entity({
      id: 'helping',
      title: 'Helping',
      contributors: ['alex'],
      contributing_teams: ['design'],
    }),
    entity({ id: 'other', title: 'Other', pm: 'sam', engineering_team: 'platform' }),
  ],
  { people: { alex: 'Alex Reed', sam: 'Sam' }, teams: { design: 'Design', platform: 'Platform' } },
);

void describe('profileView', () => {
  void it('lists a person’s items once with every role, leaving out feature sets', () => {
    const view = profileView(DATA, 'person', 'alex');
    assert.equal(view.id, 'alex');
    assert.equal(view.name, 'Alex Reed');
    assert.equal(view.href, `${BASE}people/alex/`);
    assert.deepEqual(
      view.items.map(({ id }) => id),
      ['direct', 'helping', 'inherited'],
    );
    assert.deepEqual(Object.fromEntries(view.roles), {
      direct: ['Product manager'],
      helping: ['Contributor'],
      inherited: ['Product manager (from feature set)', 'Contributor'],
    });
  });

  void it('lists a team’s owned and contributed items with their roles', () => {
    const view = profileView(DATA, 'team', 'design');
    assert.equal(view.name, 'Design');
    assert.equal(view.href, `${BASE}teams/design/`);
    assert.deepEqual(
      view.items.map(({ id }) => id),
      ['direct', 'helping', 'inherited'],
    );
    assert.deepEqual(Object.fromEntries(view.roles), {
      direct: ['Owner'],
      helping: ['Contributing team'],
      inherited: ['Owner (from feature set)', 'Contributing team'],
    });
    assert.deepEqual(profileView(DATA, 'team', 'platform').roles.get('direct'), [
      'Contributing team',
    ]);
  });

  void it('returns an empty view named by the ID for an unregistered or idle profile', () => {
    const person = profileView(DATA, 'person', 'nobody');
    assert.equal(person.name, 'nobody');
    assert.deepEqual(person.items, []);
    assert.equal(person.roles.size, 0);
    const team = profileView(DATA, 'team', 'ops team');
    assert.equal(team.href, `${BASE}teams/ops%20team/`);
    assert.deepEqual(team.items, []);
  });
});
