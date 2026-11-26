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
  nth,
  textOf,
} from '../test-support.test.ts';
import { directoryHeader, viewsPage } from './directory.ts';

/**
 * A set with items, a set without, a shipped release with an item and a planned release.
 */
const DATA = dataFor([
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding', target: '2027-04' }),
  entity({ kind: 'set', id: 'empty', title: HOSTILE }),
  entity({
    kind: 'release',
    id: 'spring',
    title: 'Spring',
    status: 'shipped',
    target: '2027-Q2',
    shipped_on: '2027-05-03',
  }),
  entity({ kind: 'release', id: 'summer', title: 'Summer', status: 'planned' }),
  entity({ id: 'a', title: 'A', set: 'onboarding', release: 'spring' }),
  entity({ id: 'b', title: 'B', set: 'onboarding' }),
]);

void describe('viewsPage', () => {
  void it('lists feature sets and releases with their item counts, linking their item lists', () => {
    const root = fragment(viewsPage(DATA));
    assert.equal(textOf(findOne(root, 'h1')), 'Work scopes');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '4 scopes');
    const [sets, releases] = findAll(root, 'section', { class: 'page-section' });
    assert.ok(sets && releases);
    assert.equal(textOf(findOne(sets, 'h2', { id: 'scopes-set' })), 'Feature sets');
    assert.equal(textOf(findOne(releases, 'h2', { id: 'scopes-release' })), 'Releases');

    const setRows = findAll(sets, 'li', { class: 'row' });
    assert.deepEqual(
      setRows.map((row) => attr(findOne(row, 'a'), 'href')),
      [`${BASE}sets/empty/items/`, `${BASE}sets/onboarding/items/`],
    );
    assert.equal(textOf(findOne(nth(setRows, 0), 'a')), HOSTILE);
    assert.equal(textOf(findOne(nth(setRows, 1), 'span', { class: 'num' })), '2 items');
    assert.equal(attr(findOne(nth(setRows, 1), 'time'), 'datetime'), '2027-04');
    assert.deepEqual(findAll(sets, 'span', { class: 'pill' }), []);

    const releaseRows = findAll(releases, 'li', { class: 'row' });
    assert.deepEqual(
      releaseRows.map((row) => attr(findOne(row, 'a'), 'href')),
      [`${BASE}releases/spring/#roadmap-items`, `${BASE}releases/summer/#roadmap-items`],
    );
    assert.equal(attr(findOne(nth(releaseRows, 0), 'time'), 'datetime'), '2027-05-03');
    assert.equal(textOf(findOne(nth(releaseRows, 0), 'span', { class: 'pill' })), 'Shipped');
    assert.equal(textOf(findOne(nth(releaseRows, 1), 'span', { class: 'num' })), '0 items');
    assert.deepEqual(findAll(nth(releaseRows, 1), 'time'), []);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('leaves out a kind without records', () => {
    const root = fragment(viewsPage(dataFor([entity({ kind: 'release', id: 'r', title: 'R' })])));
    assert.deepEqual(findAll(root, 'h2', { id: 'scopes-set' }), []);
    assert.equal(findAll(root, 'h2', { id: 'scopes-release' }).length, 1);
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '1 scope');
  });

  void it('explains how to add a scope to an empty roadmap', () => {
    const root = fragment(viewsPage(dataFor([])));
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '0 scopes');
    assert.equal(
      textOf(findOne(root, 'p', { class: 'empty' })),
      'No work scopes yet. Add a feature set or a release.',
    );
  });
});

void describe('directoryHeader', () => {
  void it('titles the page by its section and links the three tabs under the base path', () => {
    for (const [current, title] of [
      ['people', 'People'],
      ['teams', 'Teams'],
      ['scopes', 'Work scopes'],
    ] as const) {
      const root = fragment(directoryHeader(DATA, current, '3 things'));
      assert.equal(textOf(findOne(root, 'h1')), title);
      assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '3 things');
      const nav = findOne(root, 'nav', { 'aria-label': 'Directory' });
      assert.deepEqual(
        findAll(nav, 'a').map((link) => [attr(link, 'href'), textOf(link)]),
        [
          [`${BASE}people/`, 'People'],
          [`${BASE}teams/`, 'Teams'],
          [`${BASE}views/scopes/`, 'Work scopes'],
        ],
      );
      assert.deepEqual(
        findAll(nav, 'a', { 'aria-current': 'page' }).map((link) => textOf(link)),
        [title],
      );
    }
  });
});
