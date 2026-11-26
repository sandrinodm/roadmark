import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { profileView } from '../profile-view.ts';
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
  textOf,
} from '../test-support.test.ts';
import { html } from '../ui/html.ts';
import { profileHeading, profileRail, workSection } from './profile-work.ts';

/**
 * Items assigned to Maya in different ways, one with a set and a release.
 */
const DATA = dataFor(
  [
    entity({ kind: 'set', id: 'onboarding', title: 'Onboarding' }),
    entity({ kind: 'release', id: 'spring', title: HOSTILE }),
    entity({
      id: 'setup',
      title: 'Setup',
      target: '2027-06',
      set: 'onboarding',
      release: 'spring',
      pm: 'maya',
      inherited_pm: true,
      contributors: ['maya'],
    }),
    entity({ id: 'copy', title: 'Copy', target: '2027-02', contributors: ['maya'] }),
  ],
  { people: { maya: 'Maya Chen' } },
);

/**
 * Maya's profile.
 */
const VIEW = profileView(DATA, 'person', 'maya');

void describe('workSection', () => {
  void it('lists each item once by target with its roles and planning links', () => {
    const root = fragment(workSection(DATA, VIEW, 'None'));
    const section = findOne(root, 'section', { id: 'roadmap-items' });
    assert.equal(textOf(findOne(section, 'h2')), 'Roadmap items');
    assert.equal(textOf(findOne(section, 'p', { role: 'status' })), '2 items');
    const rows = findAll(section, 'li', { class: 'row' });
    assert.deepEqual(
      rows.map((row) => [attr(row, 'data-filter-entry'), attr(row, 'data-role')]),
      [
        ['copy', 'contributor'],
        ['setup', 'product-manager contributor'],
      ],
    );
    const setup = nth(rows, 1);
    assert.deepEqual(
      findAll(setup, 'span', { class: 'tag' }).map((tag) => textOf(tag)),
      ['Product manager (from feature set)', 'Contributor'],
    );
    const relations = findOne(setup, 'span', { class: 'relations' });
    assert.deepEqual(hrefs(relations), [`${BASE}sets/onboarding/`, `${BASE}releases/spring/`]);
    assert.deepEqual(
      findAll(relations, 'span', { class: 'relation-label' }).map((label) => textOf(label)),
      ['Feature set', 'Release'],
    );
    assert.equal(findAll(relations, 'span', { class: 'relation-dot' }).length, 1);
    assert.deepEqual(findAll(nth(rows, 0), 'span', { class: 'relations' }), []);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('offers the involvement filter', () => {
    const root = fragment(workSection(DATA, VIEW, 'None'));
    const role = findOne(root, 'ui-select', { 'data-filter': 'role' });
    assert.deepEqual(
      findAll(role, 'ui-select-item').map((item) => attr(item, 'value')),
      ['contributor', 'product-manager'],
    );
  });

  void it('shows the given empty state for a profile without items', () => {
    const view = profileView(DATA, 'person', 'nobody');
    const root = fragment(workSection(DATA, view, 'No roadmap items assigned to this person.'));
    assert.equal(
      textOf(findOne(root, 'p', { class: 'empty' })),
      'No roadmap items assigned to this person.',
    );
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '0 items');
  });
});

void describe('profileRail', () => {
  void it('links the profile timeline and lists the facts', () => {
    const root = fragment(
      profileRail(VIEW, [{ term: 'Teams', value: html`Growth` }], 'View personal timeline'),
    );
    const link = findOne(root, 'a', { class: 'facts-link' });
    assert.equal(attr(link, 'href'), `${BASE}people/maya/timeline/`);
    assert.equal(textOf(link), 'View personal timeline');
    assert.equal(textOf(findOne(root, 'dt')), 'Teams');
  });
});

void describe('profileHeading', () => {
  void it('shows the kind, mark, escaped name and lead', () => {
    const root = fragment(
      profileHeading('Team', html`<span class="mark"></span>`, HOSTILE, 'Owns things.'),
    );
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-kind' })), 'Team');
    assert.equal(findAll(root, 'span', { class: 'mark' }).length, 1);
    assert.equal(textOf(findOne(root, 'h1')), HOSTILE);
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-lead' })), 'Owns things.');
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('leaves out an empty lead', () => {
    for (const lead of ['', undefined]) {
      const root = fragment(profileHeading('Person', html``, 'Sam', lead));
      assert.deepEqual(findAll(root, 'p', { class: 'doc-lead' }), []);
    }
  });
});
