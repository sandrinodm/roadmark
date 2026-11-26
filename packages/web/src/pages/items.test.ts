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
  textOf,
} from '../test-support.test.ts';
import { itemsPage } from './items.ts';

/**
 * Two sets (one empty), items in a set and an item without one.
 */
const DATA = dataFor([
  entity({ kind: 'set', id: 'onboarding', title: HOSTILE }),
  entity({ kind: 'set', id: 'unused', title: 'Unused' }),
  entity({ id: 'setup', title: 'Setup', set: 'onboarding', status: 'planned' }),
  entity({ id: 'recovery', title: 'Recovery', set: 'onboarding' }),
  entity({ id: 'loose', title: 'Loose' }),
]);

void describe('itemsPage', () => {
  void it('counts items and points the page at the search index under the base path', () => {
    const root = fragment(itemsPage(DATA));
    const page = findOne(root, 'div', { class: 'page catalogue' });
    assert.equal(attr(page, 'data-index'), `${BASE}search-index.json`);
    assert.equal(textOf(findOne(root, 'h1')), 'Items');
    assert.equal(
      textOf(findOne(root, 'p', { role: 'status', 'data-filter-count': true })),
      '3 items',
    );
    assert.equal(findAll(root, 'input', { name: 'q' }).length, 1);
  });

  void it('groups items under their linked feature set, then items without one, skipping empty sets', () => {
    const root = fragment(itemsPage(DATA));
    const groups = findAll(root, 'tbody');
    assert.deepEqual(
      groups.map((group) => [attr(group, 'aria-labelledby'), attr(group, 'data-work-set')]),
      [
        ['queue-set-onboarding', 'onboarding'],
        ['queue-unassigned', ''],
      ],
    );
    const [set, loose] = groups;
    assert.ok(set && loose);
    const banner = findOne(set, 'h2', { id: 'queue-set-onboarding' });
    assert.deepEqual(hrefs(banner), [`${BASE}sets/onboarding/`]);
    assert.equal(textOf(banner), HOSTILE);
    assert.deepEqual(
      findAll(set, 'th', { role: 'rowheader' }).map((title) => attr(findOne(title, 'a'), 'href')),
      [`${BASE}items/recovery/`, `${BASE}items/setup/`],
    );
    assert.equal(textOf(findOne(loose, 'h2')), 'No feature set');
    assert.equal(textOf(findOne(set, 'span', { 'data-filter-group-count': true })), '2 items');
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('hides the filtered empty state while there are items', () => {
    const root = fragment(itemsPage(DATA));
    assert.equal(attr(findOne(root, 'div', { 'data-work-list': true }), 'hidden'), undefined);
    const empty = findOne(root, 'p', { 'data-filter-empty': true });
    assert.equal(attr(empty, 'hidden'), '');
    assert.equal(textOf(empty), 'No items match these filters.');
    const results = findOne(root, 'section', { 'data-inline-results': true });
    assert.equal(attr(results, 'hidden'), '');
  });

  void it('says no items have been added on an empty roadmap', () => {
    const root = fragment(itemsPage(dataFor([entity({ kind: 'set', id: 's', title: 'S' })])));
    assert.equal(
      textOf(findOne(root, 'p', { role: 'status', 'data-filter-count': true })),
      '0 items',
    );
    assert.equal(attr(findOne(root, 'div', { 'data-work-list': true }), 'hidden'), '');
    const empty = findOne(root, 'p', { 'data-filter-empty': true });
    assert.equal(attr(empty, 'hidden'), undefined);
    assert.equal(textOf(empty), 'No items have been added.');
    assert.deepEqual(findAll(root, 'tbody'), []);
  });
});
