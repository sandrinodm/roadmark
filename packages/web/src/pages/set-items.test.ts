import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fixture,
  fragment,
  HOSTILE,
  pageText,
  rowTitles,
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { html } from '../ui/html.ts';
import { setItemsPage, setTabs } from './set-items.ts';

/**
 * A feature set with a hostile title, two items in it and one elsewhere.
 */
const SET = entity({ kind: 'set', id: 'onboarding', title: HOSTILE });

/**
 * The set and its items, indexed under the nested base.
 */
const DATA = dataFor([
  SET,
  entity({ id: 'later', title: 'Later', set: SET.id, target: '2027-06' }),
  entity({ id: 'sooner', title: 'Sooner', set: SET.id, target: '2027-02', status: 'done' }),
  entity({ id: 'elsewhere', title: 'Elsewhere' }),
]);

void describe('setTabs', () => {
  void it('links Overview and Items under the base path and marks the current tab', () => {
    for (const current of ['overview', 'items'] as const) {
      const nav = findOne(fragment(setTabs(DATA, SET, current)), 'nav');
      assert.equal(attr(nav, 'aria-label'), `${HOSTILE} sections`);
      const links = findAll(nav, 'a');
      assert.deepEqual(
        links.map((link) => [textOf(link), attr(link, 'href'), attr(link, 'aria-current')]),
        [
          ['Overview', `${BASE}sets/onboarding/`, current === 'overview' ? 'page' : undefined],
          ['Items', `${BASE}sets/onboarding/items/`, current === 'items' ? 'page' : undefined],
        ],
      );
    }
  });
});

void describe('setItemsPage', () => {
  void it('lists the set’s items in one table without banners, by target', () => {
    const root = fragment(setItemsPage(DATA, SET, html`<header><h1>Heading</h1></header>`));
    assert.equal(textOf(findOne(root, 'h1')), 'Heading');
    const section = findOne(root, 'section');
    assert.equal(attr(section, 'aria-label'), `Items in ${HOSTILE}`);
    assert.equal(textOf(findOne(section, 'p', { class: 'section-count num' })), '2 items');
    const table = findOne(section, 'table');
    assert.equal(attr(table, 'aria-label'), `Items in ${HOSTILE}`);
    assert.deepEqual(findAll(table, 'tr', { class: 'catalogue-group-row' }), []);
    assert.deepEqual(
      findAll(table, 'th', { role: 'rowheader' }).map((title) => attr(findOne(title, 'a'), 'href')),
      [`${BASE}items/sooner/`, `${BASE}items/later/`],
    );
    assert.equal(
      attr(findOne(root, 'a', { 'aria-current': 'page' }), 'href'),
      `${BASE}sets/onboarding/items/`,
    );
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('explains how to add items to an empty set', () => {
    const empty = entity({ kind: 'set', id: 'empty', title: 'Empty' });
    const root = fragment(setItemsPage(dataFor([empty]), empty, html``));
    assert.equal(textOf(findOne(root, 'p', { class: 'section-count num' })), '0 items');
    assert.deepEqual(findAll(root, 'table'), []);
    assert.equal(
      textOf(findOne(root, 'p', { class: 'empty' })),
      'No items in this feature set yet. Add Markdown files to its items folder.',
    );
  });

  void it('sorts a feature set Items tab by target, not by start', async () => {
    const set = entity({ kind: 'set', id: 'publishing', title: 'Publishing' });
    const late = entity({
      id: 'late',
      title: 'Late',
      set: set.id,
      start: '2027-01-01',
      target: '2027-09',
    });
    const early = entity({
      id: 'early',
      title: 'Early',
      set: set.id,
      start: '2027-03-01',
      target: '2027-04-10',
    });
    const open = entity({ id: 'open', title: 'Open', set: set.id, start: '2026-01-01' });
    const files = await renderSite({ ...fixture, entities: [set, open, late, early] }, TEAM_BASE);
    assert.deepEqual(rowTitles(pageText(files, 'sets/publishing/items/index.html')), [
      'Early',
      'Late',
      'Open',
    ]);
  });
});
