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
import { scopeSection } from './scope-groups.ts';

/**
 * Two sets and two releases, with items spread over them and some in neither.
 */
const RECORDS = [
  entity({ kind: 'set', id: 'zeta', title: 'Alpha set' }),
  entity({ kind: 'set', id: 'alpha', title: `Zeta ${HOSTILE}` }),
  entity({ kind: 'release', id: 'late', title: 'Late', target: '2027-Q4' }),
  entity({ kind: 'release', id: 'early', title: 'Early', target: '2027-Q1' }),
  entity({ id: 'b', title: 'B', set: 'zeta', release: 'early', target: '2027-06', status: 'done' }),
  entity({ id: 'a', title: 'A', set: 'zeta', release: 'late', target: '2027-03' }),
  entity({ id: 'c', title: 'C', set: 'alpha', status: 'in-progress' }),
  entity({ id: 'd', title: 'D', release: 'late' }),
];

/**
 * The records indexed under the nested base.
 */
const DATA = dataFor(RECORDS);

/**
 * Every item in the fixture.
 */
const ITEMS = RECORDS.filter(({ kind }) => kind === 'item');

void describe('scopeSection', () => {
  void it('groups items by feature set in set order, with ungrouped items last', () => {
    const root = fragment(scopeSection(DATA, 'Release scope', ITEMS, 'set'));
    const groups = findAll(root, 'section', { class: 'scope-group' });
    assert.deepEqual(
      groups.map((group) => textOf(findOne(group, 'h3'))),
      ['Alpha set', `Zeta ${HOSTILE}`, 'No feature set'],
    );
    assert.deepEqual(hrefs(findOne(nth(groups, 0), 'h3')), [`${BASE}sets/zeta/`]);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('sorts each group by target and gives rows their filter identity', () => {
    const root = fragment(scopeSection(DATA, 'Release scope', ITEMS, 'set'));
    const [first] = findAll(root, 'section', { class: 'scope-group' });
    assert.ok(first);
    const rows = findAll(first, 'li', { class: 'row' });
    assert.deepEqual(
      rows.map((row) => attr(row, 'data-filter-entry')),
      ['a', 'b'],
    );
    assert.equal(attr(nth(rows, 0), 'data-release'), 'late');
    assert.equal(attr(first, 'data-filter-group'), '');
  });

  void it('groups items by release in release order, with unassigned items last', () => {
    const root = fragment(scopeSection(DATA, 'Items', ITEMS, 'release'));
    assert.deepEqual(
      findAll(root, 'h3').map((heading) => textOf(heading)),
      ['Early', 'Late', 'Unassigned'],
    );
  });

  void it('shows progress over the whole scope inside the filterable section', () => {
    const root = fragment(scopeSection(DATA, 'Release scope', ITEMS, 'set'));
    const section = findOne(root, 'section', { id: 'roadmap-items' });
    assert.equal(textOf(findOne(section, 'h2')), 'Release scope');
    assert.equal(textOf(findOne(section, 'p', { role: 'status' })), '4 items');
    const track = findOne(findOne(section, 'div', { class: 'scope-progress' }), 'span', {
      class: 'progress-track',
    });
    assert.equal(attr(track, 'aria-label'), '1 of 4 items done, 1 in progress');
  });

  void it('tells an empty release and an empty feature set how to add items', () => {
    const release = fragment(scopeSection(DATA, 'Release scope', [], 'set'));
    assert.equal(
      textOf(findOne(release, 'p', { class: 'empty' })),
      'No items in this release yet. Set release: in an item’s frontmatter.',
    );
    assert.equal(textOf(findOne(release, 'code')), 'release:');
    assert.deepEqual(findAll(release, 'div', { class: 'scope-progress' }), []);
    const set = fragment(scopeSection(DATA, 'Items', [], 'release'));
    assert.equal(
      textOf(findOne(set, 'p', { class: 'empty' })),
      'No items in this feature set yet. Add Markdown files to its items folder.',
    );
  });
});
