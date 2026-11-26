import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, findAll, findOne, fragment, HOSTILE, textOf } from '../test-support.test.ts';
import { statusPill, tag } from './pill.ts';

void describe('statusPill', () => {
  void it('renders a dot and the label on the tone of the status', () => {
    const root = fragment(statusPill('in-progress'));
    const pill = findOne(root, 'span', { class: 'pill' });
    assert.equal(attr(pill, 'data-tone'), 'progress');
    assert.equal(findAll(pill, 'span', { class: 'pill-dot' }).length, 1);
    assert.equal(textOf(pill), 'In progress');
  });

  void it('maps finished, withdrawn and unknown statuses to their tones', () => {
    assert.equal(tone('done'), 'ok');
    assert.equal(tone('shipped'), 'ok');
    assert.equal(tone('cancelled'), 'quiet');
    assert.equal(tone('planned'), 'neutral');
    assert.equal(tone('on-hold'), 'neutral');
    assert.equal(textOf(fragment(statusPill('on-hold'))), 'On hold');
  });

  void it('renders nothing for an empty status', () => {
    assert.equal(statusPill('').value, '');
  });
});

void describe('tag', () => {
  void it('renders a quiet tag without a dot and escapes its label', () => {
    const markup = tag(HOSTILE);
    const root = fragment(markup);
    const element = findOne(root, 'span', { class: 'tag' });
    assert.equal(textOf(element), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.deepEqual(findAll(root, 'img'), []);
    assert.doesNotMatch(markup.value, /pill-dot/);
  });
});

/**
 * Reads the tone a status pill is drawn in.
 *
 * @param status Status value.
 * @returns The pill's tone.
 */
function tone(status: string): string | undefined {
  return attr(findOne(fragment(statusPill(status)), 'span', { class: 'pill' }), 'data-tone');
}
