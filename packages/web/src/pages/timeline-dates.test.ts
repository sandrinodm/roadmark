import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, entity, findAll, fragment, textOf } from '../test-support.test.ts';
import {
  dateConflict,
  datesHtml,
  datesText,
  groupId,
  incidentEdges,
  NO_DATES,
} from './timeline-dates.ts';

/**
 * A shipped release with every date.
 */
const SHIPPED = entity({
  kind: 'release',
  id: 'spring',
  title: 'Spring',
  start: '2027-03-01',
  target: '2027-Q2',
  shipped_on: '2027-05-03',
});

void describe('datesHtml', () => {
  void it('labels start, target and ship dates in order, as time elements where precise', () => {
    const root = fragment(datesHtml(SHIPPED));
    assert.equal(textOf(root), 'Start Mar 1, 2027 · Target Q2 2027 · Shipped May 3, 2027');
    assert.deepEqual(
      findAll(root, 'time').map((time) => attr(time, 'datetime')),
      ['2027-03-01', '2027-05-03'],
    );
  });

  void it('says when there are no dates', () => {
    assert.equal(datesHtml(entity({ id: 'a', title: 'A' })).value, NO_DATES);
    assert.equal(NO_DATES, 'No dates set');
  });

  void it('shows only the dates a record has', () => {
    const root = fragment(datesHtml(entity({ id: 'a', title: 'A', target: '2027-04' })));
    assert.equal(textOf(root), 'Target Apr 2027');
  });
});

void describe('datesText', () => {
  void it('labels the same dates as plain text', () => {
    assert.equal(datesText(SHIPPED), 'Start Mar 1, 2027 · Target Q2 2027 · Shipped May 3, 2027');
    assert.equal(datesText(entity({ id: 'a', title: 'A', start: '2027-01' })), 'Start Jan 2027');
    assert.equal(datesText(entity({ id: 'a', title: 'A' })), 'No dates set');
  });
});

void describe('groupId', () => {
  void it('puts releases in their own lane and items in their release, set or team lane', () => {
    const item = entity({
      id: 'a',
      title: 'A',
      release: 'spring',
      set: 'onboarding',
      engineering_team: 'growth',
    });
    assert.equal(groupId(SHIPPED, 'release'), 'spring');
    assert.equal(groupId(item, 'release'), 'spring');
    assert.equal(groupId(item, 'set'), 'onboarding');
    assert.equal(groupId(item, 'team'), 'growth');
  });

  void it('uses the unassigned lane for missing fields and for non-items by set or team', () => {
    const bare = entity({ id: 'b', title: 'B' });
    assert.equal(groupId(bare, 'release'), '');
    assert.equal(groupId(bare, 'set'), '');
    assert.equal(groupId(bare, 'team'), '');
    const set = entity({
      kind: 'set',
      id: 's',
      title: 'S',
      engineering_team: 'growth',
      release: 'r',
    });
    assert.equal(groupId(set, 'team'), '');
    assert.equal(groupId(set, 'set'), '');
    assert.equal(groupId(set, 'release'), 'r');
  });
});

void describe('dateConflict', () => {
  void it('flags a prerequisite that finishes after the dependent starts', () => {
    const from = entity({ id: 'a', title: 'A', target: '2027-04' });
    const to = entity({ id: 'b', title: 'B', start: '2027-03-15', target: '2027-06' });
    assert.equal(
      dateConflict(from, to),
      'The prerequisite is scheduled to finish after the dependent item starts.',
    );
  });

  void it('flags a prerequisite target after the dependent target', () => {
    const from = entity({ id: 'a', title: 'A', target: '2027-Q3' });
    const to = entity({ id: 'b', title: 'B', target: '2027-06-30' });
    assert.equal(
      dateConflict(from, to),
      "The prerequisite target is after the dependent item's target.",
    );
  });

  void it('accepts dates that agree, including a prerequisite inside the dependent’s target period', () => {
    const from = entity({ id: 'a', title: 'A', target: '2027-04-10' });
    assert.equal(dateConflict(from, entity({ id: 'b', title: 'B', target: '2027-04' })), '');
    assert.equal(dateConflict(from, entity({ id: 'b', title: 'B', start: '2027-04-10' })), '');
    assert.equal(dateConflict(from, entity({ id: 'b', title: 'B' })), '');
  });

  void it('cannot conflict without a prerequisite target', () => {
    const from = entity({ id: 'a', title: 'A', start: '2027-09-01' });
    assert.equal(dateConflict(from, entity({ id: 'b', title: 'B', start: '2027-01-01' })), '');
  });
});

void describe('incidentEdges', () => {
  void it('indexes each dependency under both endpoints', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => entity({ id, title: id }));
    assert.ok(a && b && c);
    const ab = { from: a, to: b, reason: undefined };
    const bc = { from: b, to: c, reason: 'Why' };
    const edges = incidentEdges([ab, bc]);
    assert.deepEqual(edges.get('a'), [ab]);
    assert.deepEqual(edges.get('b'), [ab, bc]);
    assert.deepEqual(edges.get('c'), [bc]);
    assert.equal(incidentEdges([]).size, 0);
  });
});
