import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  textOf,
} from '../test-support.test.ts';
import { entityLink, personAvatar, personChip, personLink, teamLink, time } from './links.ts';

/**
 * A roadmap with an item, a release whose ID needs encoding, a team and two people.
 */
const DATA = dataFor(
  [
    entity({ id: 'guided-setup', title: HOSTILE }),
    entity({ kind: 'release', id: 'spring launch', title: 'Spring' }),
  ],
  {
    people: { maya: 'Maya Chen', noor: 'Noor Patel' },
    teams: { growth: 'Growth & Activation' },
    person_details: { maya: { avatar: 'media/maya.webp' } },
  },
);

void describe('entityLink', () => {
  void it('links a record under the base path with its escaped title', () => {
    const root = fragment(entityLink(DATA, 'guided-setup'));
    const link = findOne(root, 'a');
    assert.equal(attr(link, 'href'), `${BASE}items/guided-setup/`);
    assert.equal(textOf(link), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.deepEqual(findAll(root, 'img'), []);
  });

  void it('encodes the ID in the route', () => {
    const link = findOne(fragment(entityLink(DATA, 'spring launch')), 'a');
    assert.equal(attr(link, 'href'), `${BASE}releases/spring%20launch/`);
  });

  void it('falls back to the escaped plain ID for an unknown record', () => {
    assert.equal(entityLink(DATA, 'missing').value, 'missing');
    assert.equal(entityLink(DATA, '<b>').value, '&lt;b&gt;');
  });
});

void describe('teamLink', () => {
  void it('links the team profile with its registered name, or the ID when unregistered', () => {
    const link = findOne(fragment(teamLink(DATA, 'growth')), 'a');
    assert.equal(attr(link, 'href'), `${BASE}teams/growth/`);
    assert.equal(textOf(link), 'Growth & Activation');
    assert.match(teamLink(DATA, 'growth').value, /Growth &amp; Activation/);
    assert.equal(textOf(findOne(fragment(teamLink(DATA, 'ops')), 'a')), 'ops');
  });
});

void describe('personLink', () => {
  void it('names an avatar link by the person and shows the portrait', () => {
    const root = fragment(personLink(DATA, 'maya'));
    const link = findOne(root, 'a', { class: 'person-link' });
    assert.equal(attr(link, 'href'), `${BASE}people/maya/`);
    assert.equal(attr(link, 'aria-label'), 'Maya Chen');
    assert.equal(attr(link, 'title'), 'Maya Chen');
    const image = findOne(link, 'img');
    assert.equal(attr(image, 'src'), `${BASE}media/maya.webp`);
    assert.equal(attr(image, 'alt'), '');
  });

  void it('reads the initials before the name when there is no portrait', () => {
    const link = findOne(fragment(personLink(DATA, 'noor')), 'a');
    assert.equal(attr(link, 'aria-label'), 'NP, Noor Patel');
    assert.equal(textOf(link), 'NP');
    assert.deepEqual(findAll(link, 'img'), []);
  });
});

void describe('personChip', () => {
  void it('pairs the avatar link with the visible name', () => {
    const root = fragment(personChip(DATA, 'noor'));
    const chip = findOne(root, 'span', { class: 'person-chip' });
    assert.equal(findAll(chip, 'a', { class: 'person-link' }).length, 1);
    assert.equal(textOf(findOne(chip, 'span', { class: 'person-chip-name' })), 'Noor Patel');
  });
});

void describe('personAvatar', () => {
  void it('hides the portrait or monogram from assistive technology', () => {
    const portrait = findOne(fragment(personAvatar({ initials: 'MC', src: '/a.webp' })), 'span');
    assert.equal(attr(portrait, 'aria-hidden'), 'true');
    assert.equal(attr(findOne(portrait, 'img'), 'src'), '/a.webp');
    const monogram = findOne(fragment(personAvatar({ initials: '<M>' })), 'span');
    assert.equal(textOf(monogram), '<M>');
    assert.deepEqual(findAll(monogram, 'img'), []);
  });
});

void describe('time', () => {
  void it('marks days and months up as time elements at their precision', () => {
    const day = findOne(fragment(time('2027-04-09')), 'time');
    assert.equal(attr(day, 'datetime'), '2027-04-09');
    assert.equal(textOf(day), 'Apr 9, 2027');
    const month = findOne(fragment(time('2027-04')), 'time');
    assert.equal(attr(month, 'datetime'), '2027-04');
    assert.equal(textOf(month), 'Apr 2027');
  });

  void it('shows quarters as plain text', () => {
    const root = fragment(time('2027-Q3'));
    assert.deepEqual(findAll(root, 'time'), []);
    assert.equal(textOf(findOne(root, 'span', { class: 'num' })), 'Q3 2027');
  });
});
