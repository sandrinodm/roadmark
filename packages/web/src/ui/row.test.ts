import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, findAll, findOne, fragment, HOSTILE, textOf } from '../test-support.test.ts';
import { html } from './html.ts';
import { row, rowList } from './row.ts';

void describe('row', () => {
  void it('lays out lead, title, badges, summary, detail and meta in a list item', () => {
    const root = fragment(
      html`<ul>
        ${row({
          lead: html`<i>G</i>`,
          title: html`<a href="/a/">A</a>`,
          badges: html`<span class="pill">Done</span>`,
          summary: 'One line',
          detail: html`<em>Detail</em>`,
          meta: html`<time>Apr</time>`,
          attributes: html`data-filter-entry="a"`,
        })}
      </ul>`,
    );
    const item = findOne(root, 'li', { class: 'row' });
    assert.equal(attr(item, 'data-filter-entry'), 'a');
    assert.equal(textOf(findOne(item, 'span', { class: 'row-lead' })), 'G');
    assert.equal(textOf(findOne(item, 'div', { class: 'row-title' })), 'ADone');
    assert.equal(textOf(findOne(item, 'p', { class: 'row-summary' })), 'One line');
    assert.equal(textOf(findOne(item, 'div', { class: 'row-detail' })), 'Detail');
    assert.equal(textOf(findOne(item, 'div', { class: 'row-meta' })), 'Apr');
  });

  void it('leaves out the optional parts that are missing or empty', () => {
    const root = fragment(
      html`<ul>
        ${row({ title: 'Plain', summary: '', detail: '' })}
      </ul>`,
    );
    const item = findOne(root, 'li');
    assert.deepEqual(item.attrs, [{ name: 'class', value: 'row' }]);
    for (const part of ['row-lead', 'row-summary', 'row-detail', 'row-meta']) {
      assert.deepEqual(
        findAll(item, '*').filter((element) => attr(element, 'class') === part),
        [],
        part,
      );
    }

    assert.equal(textOf(findOne(item, 'div', { class: 'row-title' })), 'Plain');
  });

  void it('renders an article for stand-alone records', () => {
    const root = fragment(row({ tag: 'article', title: 'Set' }));
    assert.equal(findAll(root, 'article', { class: 'row' }).length, 1);
    assert.deepEqual(findAll(root, 'li'), []);
  });

  void it('escapes a hostile summary', () => {
    const root = fragment(
      html`<ul>
        ${row({ title: 'T', summary: HOSTILE })}
      </ul>`,
    );
    assert.equal(textOf(findOne(root, 'p', { class: 'row-summary' })), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
  });
});

void describe('rowList', () => {
  void it('wraps rows in a labelled list', () => {
    const root = fragment(rowList([row({ title: 'A' }), row({ title: 'B' })], 'Empty', 'Work'));
    const list = findOne(root, 'ul', { class: 'list' });
    assert.equal(attr(list, 'role'), 'list');
    assert.equal(attr(list, 'aria-label'), 'Work');
    assert.equal(findAll(list, 'li').length, 2);
  });

  void it('omits the label when none is given', () => {
    const list = findOne(fragment(rowList([row({ title: 'A' })], 'Empty')), 'ul');
    assert.equal(attr(list, 'aria-label'), undefined);
  });

  void it('shows the escaped empty state when there are no rows', () => {
    const root = fragment(rowList([], 'Nothing <here>'));
    assert.deepEqual(findAll(root, 'ul'), []);
    assert.equal(textOf(findOne(root, 'p', { class: 'empty' })), 'Nothing <here>');
  });
});
