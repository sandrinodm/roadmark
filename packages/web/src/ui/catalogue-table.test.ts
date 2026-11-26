import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  hrefs,
  nth,
  textOf,
} from '../test-support.test.ts';
import { catalogueRow, catalogueTable, tableGroup } from './catalogue-table.ts';
import { html } from './html.ts';

/**
 * Records covering every date cell: a target, a shipped release, a shipped release without its
 * date, and none.
 */
const RECORDS = [
  entity({
    id: 'setup',
    title: 'Guided setup',
    outcome: 'Admins finish setup.',
    status: 'planned',
    target: '2027-04',
    release: 'spring',
    set: 'onboarding',
    jira: ['ONB-1', 'PLAT-2'],
  }),
  entity({
    kind: 'release',
    id: 'spring',
    title: 'Spring',
    status: 'shipped',
    target: '2027-Q2',
    shipped_on: '2027-05-03',
  }),
  entity({
    kind: 'release',
    id: 'pending',
    title: 'Pending',
    status: 'shipped',
    target: '2027-Q3',
  }),
  entity({ id: 'bare', title: HOSTILE, description: '  ' }),
];

/**
 * The records indexed under the nested base.
 */
const DATA = dataFor(RECORDS);

void describe('catalogueTable', () => {
  void it('renders a labelled table with explicit roles and three column headers', () => {
    const root = fragment(catalogueTable('Roadmap items', 'Item', ''));
    const table = findOne(root, 'table');
    assert.equal(attr(table, 'role'), 'table');
    assert.equal(attr(table, 'aria-label'), 'Roadmap items');
    assert.equal(attr(findOne(table, 'thead'), 'role'), 'rowgroup');
    assert.deepEqual(
      findAll(table, 'th', { role: 'columnheader' }).map((header) => textOf(header)),
      ['Item', 'Status', 'Target'],
    );
  });
});

void describe('tableGroup', () => {
  void it('heads a group with a banner naming it and counting its rows', () => {
    const root = fragment(
      catalogueTable(
        'Releases',
        'Release',
        tableGroup({
          id: 'releases-2027-05',
          title: 'May 2027',
          rows: html`<tr>
            <td>row</td>
          </tr>`,
          count: 2,
          unit: 'release',
          attributes: html`data-work-set="x"`,
        }),
      ),
    );
    const group = findOne(root, 'tbody');
    assert.equal(attr(group, 'role'), 'rowgroup');
    assert.equal(attr(group, 'data-filter-group'), '');
    assert.equal(attr(group, 'data-work-set'), 'x');
    assert.equal(attr(group, 'aria-labelledby'), 'releases-2027-05');
    const banner = findOne(group, 'tr', { class: 'catalogue-group-row' });
    assert.equal(textOf(findOne(banner, 'h2', { id: 'releases-2027-05' })), 'May 2027');
    const count = findOne(banner, 'span', { 'data-filter-group-count': true });
    assert.equal(attr(count, 'data-unit'), 'release');
    assert.equal(textOf(count), '2 releases');
    assert.equal(findAll(group, 'tr').length, 2);
  });

  void it('uses the singular for one row', () => {
    const root = fragment(
      catalogueTable(
        'T',
        'Item',
        tableGroup({ id: 'g', title: 'G', rows: '', count: 1, unit: 'item' }),
      ),
    );
    assert.equal(textOf(findOne(root, 'span', { 'data-filter-group-count': true })), '1 item');
  });

  void it('renders a group without a banner or label when it has no ID', () => {
    const root = fragment(
      catalogueTable(
        'T',
        'Item',
        tableGroup({
          rows: html`<tr>
            <td>row</td>
          </tr>`,
          count: 1,
          unit: 'item',
        }),
      ),
    );
    const group = findOne(root, 'tbody');
    assert.equal(attr(group, 'aria-labelledby'), undefined);
    assert.deepEqual(findAll(group, 'tr', { class: 'catalogue-group-row' }), []);
    assert.deepEqual(findAll(group, 'h2'), []);
  });
});

void describe('catalogueRow', () => {
  void it('shows the linked title, outcome, Jira keys, status and target', () => {
    const row = rowOf(0);
    assert.equal(attr(row, 'data-filter-entry'), 'setup');
    assert.equal(attr(row, 'data-release'), 'spring');
    assert.equal(attr(row, 'data-set'), 'onboarding');
    assert.equal(attr(row, 'data-jira'), 'ONB-1 PLAT-2');
    const title = findOne(row, 'th', { role: 'rowheader' });
    assert.deepEqual(hrefs(title), [`${BASE}items/setup/`]);
    assert.equal(
      textOf(findOne(title, 'span', { class: 'catalogue-item-outcome' })),
      'Admins finish setup.',
    );
    assert.equal(
      textOf(findOne(title, 'span', { class: 'catalogue-item-context' })),
      'ONB-1 PLAT-2',
    );
    assert.equal(textOf(findOne(row, 'span', { class: 'pill' })), 'Planned');
    const target = findOne(row, 'td', { class: 'catalogue-item-target' });
    assert.equal(textOf(target), 'Target Apr 2027');
    assert.equal(attr(findOne(target, 'time'), 'datetime'), '2027-04');
  });

  void it('shows the ship date of a shipped release instead of its target', () => {
    const target = findOne(rowOf(1), 'td', { class: 'catalogue-item-target' });
    assert.equal(textOf(target), 'Shipped May 3, 2027');
    assert.equal(attr(findOne(target, 'time'), 'datetime'), '2027-05-03');
    const pending = findOne(rowOf(2), 'td', { class: 'catalogue-item-target' });
    assert.equal(textOf(pending), 'Target Q3 2027');
  });

  void it('says when a record has no status, target, outcome or Jira keys, and escapes its title', () => {
    const row = rowOf(3);
    assert.equal(attr(row, 'data-jira'), undefined);
    assert.equal(textOf(findOne(row, 'td', { class: 'catalogue-item-status' })), 'No status');
    assert.equal(textOf(findOne(row, 'td', { class: 'catalogue-item-target' })), 'No target');
    assert.deepEqual(findAll(row, 'span', { class: 'catalogue-item-outcome' }), []);
    assert.deepEqual(findAll(row, 'span', { class: 'catalogue-item-context' }), []);
    assert.equal(textOf(findOne(row, 'a')), HOSTILE);
    assert.deepEqual(findAll(row, 'script'), []);
  });
});

/**
 * Renders one fixture record as a catalogue row and parses it inside a table.
 *
 * @param index Position in the fixture records.
 * @returns The row element.
 */
function rowOf(index: number) {
  const root = fragment(
    catalogueTable(
      'T',
      'Item',
      html`<tbody>
        ${catalogueRow(DATA, nth(RECORDS, index))}
      </tbody>`,
    ),
  );
  return findOne(root, 'tr', { class: 'catalogue-item' });
}
