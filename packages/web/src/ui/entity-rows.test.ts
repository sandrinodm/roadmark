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
  hrefs,
  nth,
  textOf,
} from '../test-support.test.ts';
import { entityRows } from './entity-rows.ts';
import { html } from './html.ts';

/**
 * An item with an outcome and dates, a release without one, and a set without a status.
 */
const RECORDS = [
  entity({
    id: 'setup',
    title: 'Guided setup',
    outcome: '  Admins finish setup.  ',
    status: 'in-progress',
    target: '2027-04',
  }),
  entity({ kind: 'release', id: 'spring', title: 'Spring', description: 'Release summary' }),
  entity({ kind: 'set', id: 'onboarding', title: HOSTILE, outcome: '   ' }),
];

/**
 * The records indexed under the nested base.
 */
const DATA = dataFor(RECORDS);

void describe('entityRows', () => {
  void it('lists linked records with glyph, outcome, target and status', () => {
    const root = fragment(entityRows(DATA, RECORDS, { empty: 'None' }));
    const rows = findAll(root, 'li', { class: 'row' });
    assert.equal(rows.length, 3);
    const first = nth(rows, 0);
    assert.equal(attr(findOne(first, 'span', { class: 'glyph' }), 'data-kind'), 'item');
    assert.deepEqual(hrefs(first), [`${BASE}items/setup/`]);
    assert.equal(textOf(findOne(first, 'p', { class: 'row-summary' })), 'Admins finish setup.');
    assert.equal(attr(findOne(first, 'time'), 'datetime'), '2027-04');
    assert.equal(textOf(findOne(first, 'span', { class: 'pill' })), 'In progress');
  });

  void it('falls back to the description and leaves out absent targets and statuses', () => {
    const root = fragment(entityRows(DATA, RECORDS, { empty: 'None' }));
    const [, release, set] = findAll(root, 'li', { class: 'row' });
    assert.ok(release && set);
    assert.equal(textOf(findOne(release, 'p', { class: 'row-summary' })), 'Release summary');
    assert.deepEqual(findAll(release, 'time'), []);
    assert.deepEqual(findAll(release, 'span', { class: 'pill' }), []);
    assert.equal(textOf(findOne(set, 'p', { class: 'row-summary' })), 'Fixture description');
    assert.equal(textOf(findOne(set, 'a')), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('adds detail and filter attributes per record', () => {
    const root = fragment(
      entityRows(DATA, RECORDS.slice(0, 1), {
        empty: 'None',
        detail: (record) => html`<em>${record.id} detail</em>`,
        attributes: (record) => html`data-filter-entry="${record.id}"`,
      }),
    );
    const item = findOne(root, 'li');
    assert.equal(attr(item, 'data-filter-entry'), 'setup');
    assert.equal(textOf(findOne(item, 'div', { class: 'row-detail' })), 'setup detail');
  });

  void it('shows the empty state for no records', () => {
    const root = fragment(entityRows(DATA, [], { empty: 'No roadmap items yet.' }));
    assert.equal(textOf(findOne(root, 'p', { class: 'empty' })), 'No roadmap items yet.');
    assert.deepEqual(findAll(root, 'ul'), []);
  });
});
