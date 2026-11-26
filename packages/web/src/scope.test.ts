import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entryFields, filterAttributes, roleKey, roleLabel, UNASSIGNED_RELEASE } from './scope.ts';
import { attr, dataFor, entity, findOne, fragment } from './test-support.test.ts';

/**
 * A release and a set sharing items, an unscheduled item and an empty set.
 */
const DATA = dataFor([
  entity({ kind: 'release', id: 'spring', title: 'Spring', status: 'planned' }),
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding', engineering_team: 'growth' }),
  entity({ kind: 'set', id: 'empty', title: 'Empty' }),
  entity({
    id: 'setup',
    title: 'Setup',
    status: 'in-progress',
    set: 'onboarding',
    release: 'spring',
    engineering_team: 'growth',
    contributing_teams: ['platform'],
  }),
  entity({ id: 'later', title: 'Later', set: 'onboarding', contributing_teams: ['analytics'] }),
  entity({ id: 'loose', title: 'Loose' }),
]);

void describe('entryFields', () => {
  void it('lists an item’s own release, set and teams', () => {
    assert.deepEqual(entryFields(DATA, record('setup')), {
      type: 'item',
      status: 'in-progress',
      release: ['spring'],
      set: ['onboarding'],
      teams: ['growth', 'platform'],
    });
  });

  void it('marks items without a release as unassigned and leaves empty fields empty', () => {
    assert.deepEqual(entryFields(DATA, record('loose')), {
      type: 'item',
      status: '',
      release: [UNASSIGNED_RELEASE],
      set: [],
      teams: [],
    });
  });

  void it('gives a feature set the releases and teams of its items', () => {
    assert.deepEqual(entryFields(DATA, record('onboarding')), {
      type: 'set',
      status: '',
      release: [UNASSIGNED_RELEASE, 'spring'],
      set: ['onboarding'],
      teams: ['growth', 'analytics', 'platform'],
    });
    assert.deepEqual(entryFields(DATA, record('empty')).release, []);
  });

  void it('gives a release the sets and teams of its items', () => {
    assert.deepEqual(entryFields(DATA, record('spring')), {
      type: 'release',
      status: 'planned',
      release: ['spring'],
      set: ['onboarding'],
      teams: ['growth', 'platform'],
    });
  });

  void it('uses a sentinel no authored ID can collide with', () => {
    assert.equal(UNASSIGNED_RELEASE, '~unassigned');
  });
});

void describe('filterAttributes', () => {
  void it('writes the record’s memberships as data attributes', () => {
    const row = findOne(
      fragment(`<div ${String(filterAttributes(DATA, record('onboarding')))}></div>`),
      'div',
    );
    assert.equal(attr(row, 'data-filter-entry'), 'onboarding');
    assert.equal(attr(row, 'data-type'), 'set');
    assert.equal(attr(row, 'data-status'), '');
    assert.equal(attr(row, 'data-release'), '~unassigned spring');
    assert.equal(attr(row, 'data-set'), 'onboarding');
    assert.equal(attr(row, 'data-team'), 'growth analytics platform');
    assert.equal(attr(row, 'data-role'), undefined);
  });

  void it('adds the profile roles of the record as keys', () => {
    const roles = new Map([
      ['setup', ['Product manager (from feature set)', 'Contributor']],
      ['loose', []],
    ]);
    const setup = findOne(
      fragment(`<div ${String(filterAttributes(DATA, record('setup'), roles))}></div>`),
      'div',
    );
    assert.equal(attr(setup, 'data-role'), 'product-manager contributor');
    const loose = findOne(
      fragment(`<div ${String(filterAttributes(DATA, record('loose'), roles))}></div>`),
      'div',
    );
    assert.equal(attr(loose, 'data-role'), undefined);
  });

  void it('escapes hostile IDs in attribute values', () => {
    const data = dataFor([entity({ id: '"><script>', title: 'x' })]);
    const markup = filterAttributes(data, entity({ id: '"><script>', title: 'x' })).value;
    assert.match(markup, /data-filter-entry="&quot;&gt;&lt;script&gt;"/);
  });
});

void describe('roleLabel and roleKey', () => {
  void it('merges inherited ownership with direct ownership', () => {
    assert.equal(roleLabel('Product manager (from feature set)'), 'Product manager');
    assert.equal(roleLabel('Owner (from feature set)'), 'Owner');
    assert.equal(roleLabel('Contributing team'), 'Contributing team');
  });

  void it('turns a label into a lowercase hyphenated key', () => {
    assert.equal(roleKey('Product manager (from feature set)'), 'product-manager');
    assert.equal(roleKey('Contributing team'), 'contributing-team');
    assert.equal(roleKey('Owner'), 'owner');
  });
});

/**
 * Looks up a fixture record.
 *
 * @param id Record ID.
 * @returns The record.
 */
function record(id: string) {
  const found = DATA.byId.get(id);
  assert.ok(found, id);
  return found;
}
