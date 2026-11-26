import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, findAll, findOne, fragment, HOSTILE, textOf } from '../test-support.test.ts';
import { chip, filterBar } from './filter-bar.ts';

/**
 * Nine choices, one more than a chip lists without a search field.
 */
const MANY = Array.from({ length: 9 }, (_, index) => [`v${index}`, `Value ${index}`] as const);

void describe('filterBar', () => {
  void it('renders a labelled group of chips with a hidden Clear button', () => {
    const root = fragment(
      filterBar('Item filters', [
        { param: 'status', label: 'Status', choices: [['done', 'Done']] },
        { param: 'team', label: 'Team', choices: [['growth', 'Growth']] },
      ]),
    );
    const bar = findOne(root, 'div', { class: 'filter-bar' });
    assert.equal(attr(bar, 'role'), 'group');
    assert.equal(attr(bar, 'aria-label'), 'Item filters');
    assert.equal(attr(bar, 'data-filter-bar'), '');
    assert.deepEqual(
      findAll(bar, 'ui-select').map((select) => attr(select, 'data-filter')),
      ['status', 'team'],
    );
    const clear = findOne(bar, 'button', { class: 'filter-clear' });
    assert.equal(attr(clear, 'hidden'), '');
    assert.deepEqual(findAll(bar, 'input', { type: 'search' }), []);
  });

  void it('leaves out chips without choices', () => {
    const root = fragment(
      filterBar('Filters', [
        { param: 'status', label: 'Status', choices: [] },
        { param: 'team', label: 'Team', choices: [['growth', 'Growth']] },
      ]),
    );
    assert.deepEqual(
      findAll(root, 'ui-select').map((select) => attr(select, 'data-filter')),
      ['team'],
    );
  });

  void it('adds a labelled search field in the requested mode', () => {
    const root = fragment(
      filterBar('Search', [], { param: 'q', label: 'Search items', mode: 'index' }),
    );
    const input = findOne(root, 'input', { type: 'search' });
    assert.equal(attr(input, 'name'), 'q');
    assert.equal(attr(input, 'placeholder'), 'Search items');
    assert.equal(attr(input, 'data-filter-text'), 'index');
    assert.equal(attr(input, 'autocomplete'), 'off');
    assert.equal(textOf(findOne(root, 'span', { class: 'visually-hidden' })), 'Search items');
  });
});

void describe('chip', () => {
  void it('renders a filter select with options, a remove button and the default placeholder', () => {
    const root = fragment(
      chip({
        param: 'collection-status',
        field: 'status',
        label: 'Status',
        choices: [
          ['done', 'Done'],
          ['planned', 'Planned'],
        ],
      }),
    );
    const select = findOne(root, 'ui-select');
    assert.equal(attr(select, 'data-filter'), 'collection-status');
    assert.equal(attr(select, 'data-field'), 'status');
    assert.equal(attr(select, 'placeholder'), 'Any');
    assert.equal(attr(select, 'data-label'), 'Status');
    assert.deepEqual(
      findAll(select, 'ui-select-item').map((item) => [attr(item, 'value'), attr(item, 'label')]),
      [
        ['done', 'Done'],
        ['planned', 'Planned'],
      ],
    );
    assert.equal(
      attr(findOne(select, 'button', { class: 'chip-trigger' }), 'aria-label'),
      'Status: Any',
    );
    assert.equal(
      attr(findOne(select, 'button', { class: 'chip-remove' }), 'aria-label'),
      'Clear Status',
    );
    assert.deepEqual(findAll(select, 'ui-select-input'), []);
    assert.deepEqual(findAll(select, '*', { id: true }), []);
  });

  void it('matches the parameter when no field is given', () => {
    const select = findOne(
      fragment(chip({ param: 'team', label: 'Team', choices: [['a', 'A']] })),
      'ui-select',
    );
    assert.equal(attr(select, 'data-field'), 'team');
  });

  void it('renders a setting without a remove button or filter attributes', () => {
    const root = fragment(
      chip(
        { param: 'zoom', label: 'Zoom', placeholder: 'Months', choices: [['month', 'Months']] },
        true,
      ),
    );
    const select = findOne(root, 'ui-select');
    assert.equal(attr(select, 'data-setting'), 'zoom');
    assert.equal(attr(select, 'data-filter'), undefined);
    assert.equal(attr(select, 'placeholder'), 'Months');
    assert.deepEqual(findAll(select, 'ui-select-clear'), []);
    assert.equal(attr(findOne(select, 'button'), 'aria-label'), 'Zoom: Months');
  });

  void it('adds a search field only to lists longer than eight', () => {
    const eight = fragment(chip({ param: 'set', label: 'Feature set', choices: MANY.slice(0, 8) }));
    assert.deepEqual(findAll(eight, 'ui-select-input'), []);
    const nine = fragment(chip({ param: 'set', label: 'Feature set', choices: MANY }));
    const input = findOne(findOne(nine, 'ui-select-input'), 'input');
    assert.equal(attr(input, 'aria-label'), 'Search Feature set');
    assert.equal(attr(input, 'placeholder'), 'Search feature set');
    assert.equal(textOf(findOne(nine, 'ui-select-empty')), 'No matches');
  });

  void it('escapes hostile choice labels in attributes and text', () => {
    const markup = chip({ param: 'release', label: 'Release', choices: [['r', HOSTILE]] });
    const root = fragment(markup);
    const item = findOne(root, 'ui-select-item');
    assert.equal(attr(item, 'label'), HOSTILE);
    assert.equal(textOf(findOne(item, 'ui-select-item-text')), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.deepEqual(findAll(root, 'img'), []);
  });
});
