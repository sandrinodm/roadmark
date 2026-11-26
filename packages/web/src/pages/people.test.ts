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
import { peoplePage, personList, personPage } from './people.ts';

/**
 * Homonyms, a person with a portrait, role and teams, a set owned by Maya and her items.
 */
const DATA = dataFor(
  [
    entity({ kind: 'set', id: 'onboarding', title: 'Onboarding', pm: 'maya' }),
    entity({ kind: 'set', id: 'billing', title: 'Billing', contributors: ['maya'] }),
    entity({
      id: 'setup',
      title: 'Setup',
      set: 'onboarding',
      pm: 'maya',
      inherited_pm: true,
      release: 'spring',
    }),
    entity({ id: 'copy', title: 'Copy', contributors: ['maya'] }),
    entity({ kind: 'release', id: 'spring', title: 'Spring' }),
  ],
  {
    people: { maya: 'Maya Chen', alex: 'Alex Reed', 'alex-ops': 'Alex Reed', hostile: HOSTILE },
    teams: { growth: 'Growth', billing: 'Billing' },
    person_details: {
      maya: { avatar: 'avatars/maya.webp', role: 'Product Manager', teams: ['growth', 'billing'] },
      hostile: { role: HOSTILE },
    },
  },
);

void describe('peoplePage', () => {
  void it('counts people and lists them with their teams', () => {
    const root = fragment(peoplePage(DATA));
    assert.equal(textOf(findOne(root, 'h1')), 'People');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '4 people');
    const rows = findAll(root, 'li', { class: 'row' });
    assert.equal(rows.length, 4);
    const maya = rows.find((row) => hrefs(row).includes(`${BASE}people/maya/`));
    assert.ok(maya);
    assert.deepEqual(hrefs(findOne(maya, 'span', { class: 'row-teams' })), [
      `${BASE}teams/growth/`,
      `${BASE}teams/billing/`,
    ]);
    assert.equal(attr(findOne(maya, 'img'), 'src'), `${BASE}avatars/maya.webp`);
  });

  void it('uses the singular for one person and explains an empty directory', () => {
    const one = fragment(peoplePage(dataFor([], { people: { sam: 'Sam' } })));
    assert.equal(textOf(findOne(one, 'p', { role: 'status' })), '1 person');
    const none = fragment(peoplePage(dataFor([])));
    assert.equal(textOf(findOne(none, 'p', { role: 'status' })), '0 people');
    assert.equal(
      textOf(findOne(none, 'p', { class: 'empty' })),
      'No people yet. Add them to people.yaml.',
    );
  });
});

void describe('personList', () => {
  void it('tells homonyms apart by ID and describes links by role', () => {
    const root = fragment(personList(DATA, ['alex', 'alex-ops', 'maya', 'hostile'], 'None'));
    const [alex, ops, maya, hostile] = findAll(root, 'li', { class: 'row' });
    assert.ok(alex && ops && maya && hostile);
    assert.equal(attr(findOne(alex, 'a'), 'aria-describedby'), 'person-context-alex');
    assert.equal(textOf(findOne(alex, 'code')), 'alex');
    assert.equal(textOf(findOne(ops, 'span', { id: 'person-context-alex-ops' })), 'alex-ops');
    assert.equal(textOf(findOne(maya, 'span', { id: 'person-context-maya' })), 'Product Manager');
    assert.deepEqual(findAll(maya, 'code'), []);
    assert.equal(textOf(findOne(hostile, 'span', { id: 'person-context-hostile' })), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.deepEqual(findAll(root, 'span', { class: 'row-teams' }), []);
  });

  void it('leaves a person without role or homonym undescribed and without a detail line', () => {
    const root = fragment(personList(dataFor([], { people: { sam: 'Sam' } }), ['sam'], 'None'));
    const link = findOne(root, 'a');
    assert.equal(attr(link, 'aria-describedby'), undefined);
    assert.deepEqual(findAll(root, 'div', { class: 'row-detail' }), []);
    assert.equal(textOf(findOne(root, 'span', { class: 'person-avatar' })), 'SA');
  });

  void it('shows the empty state for nobody', () => {
    assert.equal(
      textOf(findOne(fragment(personList(DATA, [], 'Nobody here.')), 'p')),
      'Nobody here.',
    );
  });
});

void describe('personPage', () => {
  void it('heads the profile with the portrait, name and role, and links the timeline', () => {
    const root = fragment(personPage(DATA, profileView(DATA, 'person', 'maya')));
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-kind' })), 'Person');
    assert.equal(textOf(findOne(root, 'h1')), 'Maya Chen');
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-lead' })), 'Product Manager');
    assert.equal(attr(findOne(root, 'img'), 'src'), `${BASE}avatars/maya.webp`);
    const rail = findOne(root, 'aside', { id: 'record-facts' });
    assert.equal(
      attr(findOne(rail, 'a', { class: 'facts-link' }), 'href'),
      `${BASE}people/maya/timeline/`,
    );
    assert.equal(textOf(findOne(rail, 'a', { class: 'facts-link' })), 'View personal timeline');
  });

  void it('lists teams and the item count in the facts', () => {
    const rail = findOne(fragment(personPage(DATA, profileView(DATA, 'person', 'maya'))), 'aside');
    const facts = findAll(rail, 'div').filter((entry) => findAll(entry, 'dt').length === 1);
    assert.deepEqual(
      facts.map((entry) => textOf(findOne(entry, 'dt'))),
      ['Teams', 'Assigned items'],
    );
    assert.deepEqual(hrefs(nth(facts, 0)), [`${BASE}teams/growth/`, `${BASE}teams/billing/`]);
    assert.equal(textOf(findOne(nth(facts, 1), 'dd')), '2 items');
  });

  void it('lists assigned items and only the feature sets the person manages', () => {
    const root = fragment(personPage(DATA, profileView(DATA, 'person', 'maya')));
    const work = findOne(root, 'section', { id: 'roadmap-items' });
    assert.deepEqual(
      findAll(work, 'li', { class: 'row' }).map((row) => attr(row, 'data-filter-entry')),
      ['copy', 'setup'],
    );
    const owned = findAll(root, 'section', { class: 'doc-section' }).find(
      (section) =>
        textOf(findOne(section, 'div', { class: 'section-head' })) === 'Owned feature sets',
    );
    assert.ok(owned);
    assert.deepEqual(
      hrefs(owned).filter((href) => href.includes('/sets/')),
      [`${BASE}sets/onboarding/`],
    );
  });

  void it('shows empty states for a person without details or work', () => {
    const data = dataFor([], { people: { sam: 'Sam <Admin>' } });
    const root = fragment(personPage(data, profileView(data, 'person', 'sam')));
    assert.equal(textOf(findOne(root, 'h1')), 'Sam <Admin>');
    assert.deepEqual(findAll(root, 'p', { class: 'doc-lead' }), []);
    assert.equal(
      textOf(findOne(root, 'p', { class: 'empty' })),
      'No roadmap items assigned to this person.',
    );
    assert.deepEqual(
      findAll(root, 'dt').map((term) => textOf(term)),
      ['Assigned items'],
    );
    assert.ok(!textOf(root).includes('Owned feature sets'));
  });
});
