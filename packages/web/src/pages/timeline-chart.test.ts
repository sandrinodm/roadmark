import type { Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Element } from '../test-support.test.ts';
import type { Axis } from './timeline-chart.ts';

import { utcMonth } from '../data.ts';
import { profileView } from '../profile-view.ts';
import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  textOf,
} from '../test-support.test.ts';
import { axisRulers, chartAxis, chartRow } from './timeline-chart.ts';

/**
 * Milliseconds in a day.
 */
const DAY = 86_400_000;

/**
 * A 100-day axis from 1 January 2027, so a day's offset is its position in percent.
 */
const AXIS: Axis = {
  start: Date.UTC(2027, 0, 1),
  end: Date.UTC(2027, 0, 1) + 100 * DAY,
  months: 4,
};

void describe('chartAxis', () => {
  void it('spans whole months around every start, target and ship date', () => {
    const axis = chartAxis([
      entity({ id: 'a', title: 'A', start: '2027-02-03', target: '2027-04' }),
      entity({ kind: 'release', id: 'r', title: 'R', target: '2027-03', shipped_on: '2027-05-31' }),
    ]);
    assert.deepEqual(axis, { start: utcMonth(2027, 1), end: utcMonth(2027, 5), months: 4 });
  });

  void it('crosses years and widens a quarter to its three months', () => {
    const axis = chartAxis([
      entity({ id: 'a', title: 'A', start: '2026-11-15', target: '2027-Q1' }),
    ]);
    assert.deepEqual(axis, { start: utcMonth(2026, 10), end: utcMonth(2027, 3), months: 5 });
  });

  void it('handles a roadmap with hundreds of thousands of dates', () => {
    // Each record gives two bounds per date: 35,000 records give 210,000 bounds, more than a
    // spread call can pass as arguments.
    const entities = Array.from({ length: 35_000 }, (_, index) =>
      entity({
        id: `item-${index}`,
        title: 'Item',
        start: '2027-02-03',
        target: index === 0 ? '2028-06' : '2027-04',
        shipped_on: index === 1 ? '2026-12-01' : '2027-03-15',
      }),
    );
    assert.deepEqual(chartAxis(entities), {
      start: utcMonth(2026, 11),
      end: utcMonth(2028, 6),
      months: 19,
    });
  });

  void it('covers one month for a single day', () => {
    assert.deepEqual(chartAxis([entity({ id: 'a', title: 'A', target: '2027-12-31' })]), {
      start: utcMonth(2027, 11),
      end: utcMonth(2028, 0),
      months: 1,
    });
  });

  void it('has no axis without dates', () => {
    assert.equal(chartAxis([]), undefined);
    assert.equal(chartAxis([entity({ id: 'a', title: 'A' })]), undefined);
  });
});

void describe('axisRulers', () => {
  void it('labels every month, adding the year at the start and in January', () => {
    const axis = { start: utcMonth(2026, 10), end: utcMonth(2027, 3), months: 5 };
    const month = ticks(axis, 'month');
    assert.deepEqual(
      month.map(([label]) => label),
      ['Nov 2026', 'Dec', 'Jan 2027', 'Feb', 'Mar'],
    );
    assert.equal(month[0]?.[1], 0);
    assert.ok(month.every(([, at], index) => index === 0 || at > (month[index - 1]?.[1] ?? 0)));
    assert.ok(month.every(([, at]) => at >= 0 && at < 100));
  });

  void it('labels quarters on quarter boundaries after the first tick', () => {
    const axis = { start: utcMonth(2026, 10), end: utcMonth(2027, 3), months: 5 };
    assert.deepEqual(
      ticks(axis, 'quarter').map(([label]) => label),
      ['Q4 2026', 'Q1 2027'],
    );
    const aligned = { start: utcMonth(2027, 0), end: utcMonth(2028, 0), months: 12 };
    assert.deepEqual(
      ticks(aligned, 'quarter').map(([label]) => label),
      ['Q1 2027', 'Q2', 'Q3', 'Q4'],
    );
  });

  void it('thins month labels on long ranges and switches to years on very long ones', () => {
    const long = { start: utcMonth(2020, 0), end: utcMonth(2020, 100), months: 100 };
    const month = ticks(long, 'month').map(([label]) => label);
    assert.equal(month.length, 34);
    assert.deepEqual(month.slice(0, 5), ['Jan 2020', 'Apr', 'Jul', 'Oct', 'Jan 2021']);

    const decades = { start: utcMonth(2000, 0), end: utcMonth(2000, 480), months: 480 };
    for (const ruler of ['month', 'quarter'] as const) {
      const labels = ticks(decades, ruler).map(([label]) => label);
      assert.ok(labels.length <= 36, ruler);
      assert.ok(
        labels.every((label) => /^\d{4}$/.test(label)),
        ruler,
      );
    }
  });
});

void describe('chartRow', () => {
  void it('labels the row with its kind, linked title and status, and its filter identity', () => {
    const item = entity({
      id: 'setup',
      title: HOSTILE,
      status: 'in-progress',
      release: 'spring',
      set: 'onboarding',
      engineering_team: 'growth',
      target: '2027-03',
    });
    const row = rowOf([item], item);
    assert.equal(attr(row, 'data-timeline-id'), 'setup');
    assert.equal(attr(row, 'data-filter-entry'), 'setup');
    assert.equal(attr(row, 'data-zoom-release'), 'spring');
    assert.equal(attr(row, 'data-zoom-set'), 'onboarding');
    assert.equal(attr(row, 'data-zoom-team'), 'growth');
    const label = findOne(row, 'div', { class: 'gantt-label' });
    assert.equal(
      findAll(findOne(label, 'span', { class: 'gantt-kind gantt-kind-item' }), 'svg').length,
      1,
    );
    assert.equal(textOf(findOne(label, 'a')), HOSTILE);
    assert.equal(textOf(findOne(label, 'span', { class: 'pill' })), 'In progress');
    assert.equal(
      textOf(findOne(row, 'span', { class: 'gantt-date visually-hidden' })),
      'Target Mar 2027',
    );
    assert.deepEqual(findAll(row, 'script'), []);
  });

  void it('draws a linked bar with a tooltip naming the record, status and dates', () => {
    const item = entity({
      id: 'setup',
      title: 'Setup',
      status: 'planned',
      start: '2027-02-01',
      target: '2027-03',
    });
    const bar = findOne(rowOf([item], item), 'ui-tooltip-trigger');
    assert.equal(attr(bar, 'for'), 'timeline-tip');
    assert.equal(attr(bar, 'class'), 'gantt-bar exact-span');
    assert.equal(attr(bar, 'data-tip'), 'Setup · Planned · Start Feb 1, 2027 · Target Mar 2027');
    const mark = findOne(bar, 'a');
    assert.equal(attr(mark, 'href'), `${BASE}items/setup/`);
    assert.equal(attr(mark, 'class'), 'gantt-mark gantt-mark-item');
    assert.equal(attr(mark, 'data-status'), 'planned');
    assert.equal(attr(mark, 'data-mark'), 'setup');
    assert.equal(attr(mark, 'aria-label'), 'Setup · Start Feb 1, 2027 · Target Mar 2027');
  });

  void it('spans from the start to the end of the target period with the target window inside', () => {
    const item = entity({ id: 'a', title: 'A', start: '2027-02-01', target: '2027-03' });
    const vars = styleOf(rowOf([item], item));
    assertClose(vars['--at'], 31);
    assertClose(vars['--end'], 90);
    assertClose(vars['--window'], ((59 - 31) / (90 - 31)) * 100);
  });

  void it('fills a span whose target period starts the bar, or that ends on an exact day', () => {
    const month = entity({ id: 'a', title: 'A', target: '2027-03' });
    const monthVars = styleOf(rowOf([month], month));
    assertClose(monthVars['--at'], 59);
    assertClose(monthVars['--end'], 90);
    assertClose(monthVars['--window'], 0);

    const exact = entity({ id: 'b', title: 'B', start: '2027-01-11', target: '2027-02-20' });
    const exactVars = styleOf(rowOf([exact], exact));
    assertClose(exactVars['--at'], 10);
    assertClose(exactVars['--end'], 51);
    assertClose(exactVars['--window'], 100);
  });

  void it('keeps a span at least as wide as its start when the target ends earlier', () => {
    const item = entity({ id: 'a', title: 'A', start: '2027-03-15', target: '2027-02' });
    const vars = styleOf(rowOf([item], item));
    assertClose(vars['--at'], 73);
    assertClose(vars['--end'], 73);
    assertClose(vars['--window'], 0);
  });

  void it('draws a point in the middle of an exact day, or at a lone start', () => {
    const day = entity({ id: 'a', title: 'A', target: '2027-02-20' });
    const dayBar = findOne(rowOf([day], day), 'ui-tooltip-trigger');
    assert.equal(attr(dayBar, 'class'), 'gantt-bar exact-point');
    assertClose(styleOf(rowOf([day], day))['--at'], 50.5);

    const start = entity({ id: 'b', title: 'B', start: '2027-01-21' });
    assertClose(styleOf(rowOf([start], start))['--at'], 20);
  });

  void it('pins the actual ship date of a release', () => {
    const shipped = entity({
      kind: 'release',
      id: 'spring',
      title: 'Spring',
      status: 'shipped',
      target: '2027-03',
      shipped_on: '2027-02-20',
    });
    const row = rowOf([shipped], shipped);
    const pin = findOne(row, 'span', { class: 'actual-pin' });
    assertClose(Number.parseFloat((attr(pin, 'style') ?? '').replace('--at:', '')), 50.5);
    assert.equal(
      attr(findOne(row, 'a', { class: 'gantt-mark gantt-mark-release' }), 'href'),
      `${BASE}releases/spring/`,
    );
    assert.equal(attr(row, 'data-zoom-release'), 'spring');
    assert.equal(attr(row, 'data-zoom-set'), '');
  });

  void it('draws nothing on the track of a record without dates', () => {
    const bare = entity({ id: 'a', title: 'A' });
    const row = rowOf([bare], bare);
    assert.deepEqual(findAll(row, 'ui-tooltip-trigger'), []);
    assert.equal(textOf(findOne(row, 'div', { class: 'gantt-track' })), 'No dates set');
  });

  void it('adds the profile roles as filter attributes', () => {
    const item = entity({ id: 'a', title: 'A', pm: 'maya', target: '2027-03' });
    const data = dataFor([item], { people: { maya: 'Maya' } });
    const row = findOne(
      fragment(chartRow(data, AXIS, item, profileView(data, 'person', 'maya'))),
      'div',
      { class: 'gantt-row' },
    );
    assert.equal(attr(row, 'data-role'), 'product-manager');
  });
});

/**
 * Renders the ticks of one ruler.
 *
 * @param axis Chart range.
 * @param ruler Ruler to read.
 * @returns Label and position of each tick.
 */
function ticks(axis: Axis, ruler: 'month' | 'quarter'): Array<[string, number]> {
  const root = fragment(axisRulers(axis));
  return findAll(findOne(root, 'div', { 'data-axis': ruler }), 'span').map((tick) => [
    textOf(tick),
    Number.parseFloat((attr(tick, 'style') ?? '').replace('--at:', '')),
  ]);
}

/**
 * Renders one record's chart row on the 100-day axis.
 *
 * @param records Records to index.
 * @param record Record to draw.
 * @returns The row element.
 */
function rowOf(records: Array<Entity>, record: Entity): Element {
  return findOne(fragment(chartRow(dataFor(records), AXIS, record)), 'div', { class: 'gantt-row' });
}

/**
 * Reads the position custom properties of a row's bar.
 *
 * @param row Chart row.
 * @returns Percentages keyed by property.
 */
function styleOf(row: Element): Record<string, number> {
  const style = attr(findOne(row, 'ui-tooltip-trigger'), 'style') ?? '';
  return Object.fromEntries(
    [...style.matchAll(/(--[a-z]+):([\d.e-]+)%/g)].map(([, key = '', value = '']) => [
      key,
      Number(value),
    ]),
  );
}

/**
 * Asserts that a percentage matches up to floating-point rounding.
 *
 * @param actual Rendered value.
 * @param expected Expected value.
 */
function assertClose(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
}
