import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, findAll, findOne, fragment, HOSTILE, hrefs, textOf } from '../test-support.test.ts';
import { html } from './html.ts';
import { countLabel, pageHead } from './section.ts';

void describe('pageHead', () => {
  void it('renders the only heading and a status count', () => {
    const root = fragment(pageHead('Items', '3 items'));
    assert.equal(findAll(root, 'h1').length, 1);
    assert.equal(textOf(findOne(root, 'h1')), 'Items');
    const count = findOne(root, 'p', { role: 'status' });
    assert.equal(textOf(count), '3 items');
    assert.equal(findAll(root, 'div', { class: 'page-actions' }).length, 0);
  });

  void it('adds the count hook and actions when given', () => {
    const root = fragment(
      pageHead('Releases', '1 release', {
        countHook: html`data-filter-count data-unit="release"`,
        actions: html`<a href="/timeline/">View timeline</a>`,
      }),
    );
    const count = findOne(root, 'p', { role: 'status' });
    assert.equal(attr(count, 'data-filter-count'), '');
    assert.equal(attr(count, 'data-unit'), 'release');
    const actions = findOne(root, 'div', { class: 'page-actions' });
    assert.deepEqual(hrefs(actions), ['/timeline/']);
  });

  void it('escapes a hostile title and count', () => {
    const markup = pageHead(HOSTILE, HOSTILE);
    const root = fragment(markup);
    assert.equal(textOf(findOne(root, 'h1')), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
    assert.deepEqual(findAll(root, 'img'), []);
  });
});

void describe('countLabel', () => {
  void it('uses the singular noun only for one', () => {
    assert.equal(countLabel(0, 'item'), '0 items');
    assert.equal(countLabel(1, 'item'), '1 item');
    assert.equal(countLabel(2, 'feature set'), '2 feature sets');
  });
});
