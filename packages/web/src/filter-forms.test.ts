import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Element, Parent } from './test-support.test.ts';

import {
  catalogueFilters,
  catalogueSearch,
  itemFilters,
  itemSection,
  releaseChoices,
  timelineFilters,
  toChoice,
} from './filter-forms.ts';
import {
  attr,
  dataFor,
  entity,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  textOf,
} from './test-support.test.ts';
import { html } from './ui/html.ts';

/**
 * Two releases (one shipped), two sets, two teams and items using some of them.
 */
const RECORDS = [
  entity({ kind: 'release', id: 'spring', title: 'Spring', status: 'shipped', target: '2027-03' }),
  entity({ kind: 'release', id: 'summer', title: HOSTILE, status: 'planned', target: '2027-Q3' }),
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding' }),
  entity({ kind: 'set', id: 'billing', title: 'Billing' }),
  entity({ id: 'a', title: 'A', status: 'done', release: 'spring', set: 'onboarding' }),
  entity({ id: 'b', title: 'B', status: 'planned' }),
];

/**
 * The records indexed with a team registry.
 */
const DATA = dataFor(RECORDS, { teams: { growth: 'Growth', platform: 'Platform' } });

void describe('timelineFilters', () => {
  void it('offers types without sets, every status, releases, sets and teams', () => {
    const chips = chipChoices(fragment(timelineFilters(DATA)));
    assert.equal(
      attr(findOne(fragment(timelineFilters(DATA)), 'div'), 'aria-label'),
      'Timeline filters',
    );
    assert.deepEqual(chips['type'], ['item:Item', 'release:Release']);
    assert.deepEqual(chips['status'], [
      'proposed:Proposed',
      'planned:Planned',
      'in-progress:In progress',
      'done:Done',
      'shipped:Shipped',
      'cancelled:Cancelled',
    ]);
    assert.deepEqual(chips['release'], [
      'spring:Spring',
      `summer:${HOSTILE}`,
      '~unassigned:Unassigned',
    ]);
    assert.deepEqual(chips['set'], ['billing:Billing', 'onboarding:Onboarding']);
    assert.deepEqual(chips['team'], ['growth:Growth', 'platform:Platform']);
  });

  void it('leaves out the set and team chips on a roadmap without them', () => {
    const chips = chipChoices(fragment(timelineFilters(dataFor([]))));
    assert.deepEqual(Object.keys(chips), ['type', 'status', 'release']);
    assert.deepEqual(chips['release'], ['~unassigned:Unassigned']);
  });
});

void describe('itemFilters', () => {
  void it('offers only the statuses, releases and sets present in the scope', () => {
    const items = RECORDS.filter(({ kind }) => kind === 'item');
    const chips = chipChoices(fragment(itemFilters(DATA, items)));
    assert.deepEqual(chips['status'], ['planned:Planned', 'done:Done']);
    assert.deepEqual(chips['release'], ['spring:Spring', '~unassigned:Unassigned']);
    assert.deepEqual(chips['set'], ['onboarding:Onboarding']);
    assert.equal(chips['role'], undefined);
  });

  void it('offers involvement roles, merging inherited ownership and sorting labels', () => {
    const roles = new Map([
      ['a', ['Product manager (from feature set)', 'Contributor']],
      ['b', ['Product manager']],
    ]);
    const chips = chipChoices(fragment(itemFilters(DATA, RECORDS.slice(4), roles)));
    assert.deepEqual(chips['role'], ['contributor:Contributor', 'product-manager:Product manager']);
  });

  void it('renders no chips for an empty scope', () => {
    const root = fragment(itemFilters(DATA, []));
    assert.equal(textOf(findOne(root, 'div', { 'aria-label': 'Item filters' })), 'Clear');
    assert.deepEqual(findAll(root, 'ui-select'), []);
  });
});

void describe('catalogueSearch', () => {
  void it('adds an index search and a type chip that defaults to items', () => {
    const root = fragment(catalogueSearch(DATA));
    const input = findOne(root, 'input', { type: 'search' });
    assert.equal(attr(input, 'name'), 'q');
    assert.equal(attr(input, 'data-filter-text'), 'index');
    const type = findOne(root, 'ui-select', { 'data-filter': 'type' });
    assert.equal(attr(type, 'placeholder'), 'Items');
    const chips = chipChoices(root);
    assert.deepEqual(chips['type'], [
      'item:Items',
      'all:All records',
      'set:Feature sets',
      'release:Releases',
      'person:People',
      'team:Teams',
    ]);
    assert.equal(chips['status']?.length, 6);
    assert.deepEqual(Object.keys(chips), ['type', 'status', 'release', 'set', 'team']);
  });
});

void describe('itemSection', () => {
  void it('counts the items and adds filters and a hidden filtered empty state', () => {
    const items = RECORDS.slice(4);
    const root = fragment(
      itemSection(DATA, { items, title: 'Release scope', content: html`<ul></ul>` }),
    );
    const section = findOne(root, 'section', { id: 'roadmap-items' });
    assert.equal(attr(section, 'data-filter-scope'), '');
    assert.equal(textOf(findOne(section, 'h2')), 'Release scope');
    const count = findOne(section, 'p', { role: 'status' });
    assert.equal(textOf(count), '2 items');
    assert.equal(attr(count, 'data-unit'), 'item');
    assert.equal(findAll(section, 'div', { 'data-filter-bar': true }).length, 1);
    const empty = findOne(section, 'p', { 'data-filter-empty': true });
    assert.equal(attr(empty, 'hidden'), '');
    assert.equal(textOf(empty), 'No items match these filters.');
  });

  void it('shows only the content for an empty scope, with a singular count for one', () => {
    const empty = fragment(
      itemSection(DATA, { items: [], title: 'Items', content: html`<p class="empty">None</p>` }),
    );
    assert.equal(textOf(findOne(empty, 'p', { role: 'status' })), '0 items');
    assert.deepEqual(findAll(empty, 'div', { 'data-filter-bar': true }), []);
    assert.deepEqual(findAll(empty, 'p', { 'data-filter-empty': true }), []);
    assert.equal(textOf(findOne(empty, 'p', { class: 'empty' })), 'None');

    const one = fragment(
      itemSection(DATA, { items: RECORDS.slice(4, 5), title: 'Items', content: '' }),
    );
    assert.equal(textOf(findOne(one, 'p', { role: 'status' })), '1 item');
  });

  void it('escapes the heading', () => {
    const root = fragment(itemSection(DATA, { items: [], title: HOSTILE, content: '' }));
    assert.equal(textOf(findOne(root, 'h2')), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
  });
});

void describe('catalogueFilters', () => {
  void it('filters releases by the statuses they use', () => {
    const root = fragment(catalogueFilters(DATA, 'release'));
    assert.equal(attr(findOne(root, 'div'), 'aria-label'), 'Filter releases');
    const input = findOne(root, 'input', { type: 'search' });
    assert.equal(attr(input, 'name'), 'collection-q');
    assert.equal(attr(input, 'placeholder'), 'Search releases');
    assert.equal(attr(input, 'data-filter-text'), 'contains');
    const select = findOne(root, 'ui-select');
    assert.equal(attr(select, 'data-filter'), 'collection-status');
    assert.equal(attr(select, 'data-field'), 'status');
    assert.deepEqual(chipChoices(root)['collection-status'], [
      'planned:Planned',
      'shipped:Shipped',
    ]);
  });

  void it('filters feature sets by team', () => {
    const root = fragment(catalogueFilters(DATA, 'set'));
    assert.equal(attr(findOne(root, 'div'), 'aria-label'), 'Filter feature sets');
    assert.equal(attr(findOne(root, 'input'), 'placeholder'), 'Search feature sets');
    const select = findOne(root, 'ui-select');
    assert.equal(attr(select, 'data-field'), 'team');
    assert.deepEqual(chipChoices(root)['collection-team'], ['growth:Growth', 'platform:Platform']);
  });

  void it('keeps the search but drops a chip without choices', () => {
    const root = fragment(catalogueFilters(dataFor([]), 'set'));
    assert.deepEqual(findAll(root, 'ui-select'), []);
    assert.equal(findAll(root, 'input', { type: 'search' }).length, 1);
  });
});

void describe('releaseChoices and toChoice', () => {
  void it('lists releases in target order, then Unassigned', () => {
    assert.deepEqual(releaseChoices(DATA), [
      ['spring', 'Spring'],
      ['summer', HOSTILE],
      ['~unassigned', 'Unassigned'],
    ]);
  });

  void it('pairs a record’s ID with its title', () => {
    assert.deepEqual(toChoice(entity({ id: 'x', title: 'Title' })), ['x', 'Title']);
  });
});

/**
 * Reads each chip's options keyed by its parameter.
 *
 * @param root Parsed filter bar.
 * @returns `value:label` options per chip.
 */
function chipChoices(root: Parent): Record<string, Array<string>> {
  return Object.fromEntries(
    findAll(root, 'ui-select').map((select: Element) => [
      attr(select, 'data-filter') ?? '',
      findAll(select, 'ui-select-item').map(
        (item) => `${attr(item, 'value') ?? ''}:${attr(item, 'label') ?? ''}`,
      ),
    ]),
  );
}
