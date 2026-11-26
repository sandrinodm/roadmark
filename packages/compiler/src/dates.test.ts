import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dateRange, DAY_PATTERN, TARGET_PATTERN } from './dates.ts';

void describe('dateRange', () => {
  void it('resolves a calendar day to a one-day window', () => {
    assert.deepEqual(dateRange('2028-06-15'), { first: '2028-06-15', last: '2028-06-15' });
    assert.deepEqual(dateRange('2028-02-29'), { first: '2028-02-29', last: '2028-02-29' });
  });

  void it('rejects days that do not exist in their month or year', () => {
    assert.equal(dateRange('2027-02-29'), undefined);
    assert.equal(dateRange('2028-02-30'), undefined);
    assert.equal(dateRange('2028-04-31'), undefined);
    assert.equal(dateRange('1900-02-29'), undefined);
    assert.deepEqual(dateRange('2000-02-29'), { first: '2000-02-29', last: '2000-02-29' });
  });

  void it('expands a month to its first and last calendar day, including leap years', () => {
    assert.deepEqual(dateRange('2028-01'), { first: '2028-01-01', last: '2028-01-31' });
    assert.deepEqual(dateRange('2028-02'), { first: '2028-02-01', last: '2028-02-29' });
    assert.deepEqual(dateRange('2027-02'), { first: '2027-02-01', last: '2027-02-28' });
    assert.deepEqual(dateRange('2100-02'), { first: '2100-02-01', last: '2100-02-28' });
    assert.deepEqual(dateRange('2028-04'), { first: '2028-04-01', last: '2028-04-30' });
    assert.deepEqual(dateRange('2028-12'), { first: '2028-12-01', last: '2028-12-31' });
  });

  void it('expands each quarter to its three months', () => {
    assert.deepEqual(dateRange('2028-Q1'), { first: '2028-01-01', last: '2028-03-31' });
    assert.deepEqual(dateRange('2028-Q2'), { first: '2028-04-01', last: '2028-06-30' });
    assert.deepEqual(dateRange('2028-Q3'), { first: '2028-07-01', last: '2028-09-30' });
    assert.deepEqual(dateRange('2028-Q4'), { first: '2028-10-01', last: '2028-12-31' });
  });

  void it('rejects year zero and malformed or padded values', () => {
    for (const value of [
      '0000-01-01',
      '0000-01',
      '0000-Q1',
      '2028-Q0',
      '2028-Q5',
      '2028-q1',
      '2028-00',
      '2028-13',
      '2028-1-01',
      '2028-01-1',
      '28-01-01',
      ' 2028-01-01',
      '2028-01-01 ',
      '2028-01-01\n',
      '2028-01-01T00:00:00Z',
      '2028',
      '',
    ]) {
      assert.equal(dateRange(value), undefined, value);
    }
  });

  void it('produces bounds that order mixed-precision windows by plain string comparison', () => {
    const quarter = dateRange('2028-Q1');
    const lastDay = dateRange('2028-03-31');
    const nextMonth = dateRange('2028-04');
    assert.ok(quarter && lastDay && nextMonth);
    // A day inside the quarter does not start after it ends; the following month does.
    assert.ok(!(lastDay.first > quarter.last));
    assert.ok(nextMonth.first > quarter.last);
    assert.ok(quarter.first < lastDay.first);
  });
});

void describe('date patterns', () => {
  void it('accepts only exact days for a day field and leaves calendar checks to dateRange', () => {
    assert.ok(DAY_PATTERN.test('2028-02-29'));
    assert.ok(DAY_PATTERN.test('2027-02-31'));
    assert.ok(!DAY_PATTERN.test('2028-02'));
    assert.ok(!DAY_PATTERN.test('2028-Q1'));
    assert.ok(!DAY_PATTERN.test('2028-02-32'));
    assert.ok(!DAY_PATTERN.test('2028-02-29\n'));
  });

  void it('accepts day, month and quarter targets', () => {
    for (const value of ['2028-02-29', '2028-02', '2028-Q4']) {
      assert.ok(TARGET_PATTERN.test(value), value);
    }

    for (const value of ['2028-Q5', '2028-13', '2028-02-00', '2028/02', '2028-02\n']) {
      assert.ok(!TARGET_PATTERN.test(value), value);
    }
  });
});
