import type { Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, entity, findAll, findOne, fragment, HOSTILE, textOf } from '../test-support.test.ts';
import { progressBar } from './progress.ts';

void describe('progressBar', () => {
  void it('draws done and active shares and words the same counts', () => {
    const root = fragment(progressBar(items('done', 'in-progress', 'planned', 'planned')));
    const track = findOne(root, 'span', { class: 'progress-track' });
    assert.equal(attr(track, 'role'), 'img');
    assert.equal(attr(track, 'aria-label'), '1 of 4 items done, 1 in progress');
    assert.equal(attr(track, 'style'), '--done: 25.00%; --active: 25.00%');
    const caption = findOne(root, 'span', { class: 'progress-text num' });
    assert.equal(attr(caption, 'aria-hidden'), 'true');
    assert.equal(textOf(caption), '1 in progress · 1 of 4 done');
  });

  void it('says "Not started" when nothing is done or active', () => {
    const root = fragment(progressBar(items('planned', 'proposed', 'planned')));
    assert.equal(textOf(findOne(root, 'span', { class: 'progress-text num' })), 'Not started');
    const track = findOne(root, 'span', { class: 'progress-track' });
    assert.equal(attr(track, 'aria-label'), '0 of 3 items done');
    assert.equal(attr(track, 'style'), '--done: 0.00%; --active: 0.00%');
  });

  void it('rounds shares to two decimals and uses the singular for one item', () => {
    const thirds = fragment(progressBar(items('done', 'planned', 'planned')));
    assert.equal(
      attr(findOne(thirds, 'span', { class: 'progress-track' }), 'style'),
      '--done: 33.33%; --active: 0.00%',
    );
    const single = fragment(progressBar(items('done')));
    const track = findOne(single, 'span', { class: 'progress-track' });
    assert.equal(attr(track, 'aria-label'), '1 of 1 item done');
    assert.equal(attr(track, 'style'), '--done: 100.00%; --active: 0.00%');
    assert.equal(textOf(findOne(single, 'span', { class: 'progress-text num' })), '1 of 1 done');
  });

  void it('leaves cancelled work out of the total and counts it separately', () => {
    const root = fragment(progressBar(items('done', 'cancelled', 'cancelled', 'planned')));
    const track = findOne(root, 'span', { class: 'progress-track' });
    assert.equal(attr(track, 'aria-label'), '1 of 2 items done');
    assert.equal(attr(track, 'style'), '--done: 50.00%; --active: 0.00%');
    assert.equal(textOf(findOne(root, 'span', { class: 'progress-extra num' })), '2 cancelled');
  });

  void it('shows an empty state without a track when nothing counts', () => {
    const none = fragment(progressBar([]));
    const wrapper = findOne(none, 'div', { class: 'progress' });
    assert.equal(attr(wrapper, 'data-empty'), '');
    assert.equal(textOf(wrapper), 'No items yet');
    assert.deepEqual(findAll(none, 'span', { class: 'progress-track' }), []);

    const cancelled = fragment(progressBar(items('cancelled')));
    assert.equal(textOf(findOne(cancelled, 'span', { class: 'progress-text' })), 'No active items');
    assert.equal(
      textOf(findOne(cancelled, 'span', { class: 'progress-extra num' })),
      '1 cancelled',
    );
  });

  void it('names what is measured with an escaped label', () => {
    const root = fragment(progressBar(items('done'), HOSTILE));
    assert.equal(textOf(findOne(root, 'span', { class: 'progress-label' })), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.equal(
      textOf(findOne(fragment(progressBar([], 'Exit items')), 'span', { class: 'progress-label' })),
      'Exit items',
    );
  });
});

/**
 * Builds one item per status.
 *
 * @param statuses Statuses in order.
 * @returns Items.
 */
function items(...statuses: Array<string>): Array<Entity> {
  return statuses.map((status, index) => entity({ id: `item-${index}`, title: 'Item', status }));
}
