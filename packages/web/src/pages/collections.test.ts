import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  dataFor,
  entity,
  findAll,
  findOne,
  fixture,
  fragment,
  HOSTILE,
  hrefs,
  nth,
  pageText,
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { featureSetsPage, releasePlan } from './collections.ts';

/**
 * Two sets, three releases (one shipped, one undated) and items spread over them.
 */
const DATA = dataFor(
  [
    entity({
      kind: 'set',
      id: 'onboarding',
      title: 'Onboarding',
      outcome: 'Admins finish setup.',
      engineering_team: 'growth',
    }),
    entity({ kind: 'set', id: 'empty', title: HOSTILE }),
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
      id: 'summer',
      title: 'Summer',
      status: 'planned',
      target: '2027-07-15',
    }),
    entity({ kind: 'release', id: 'someday', title: 'Someday', status: 'proposed' }),
    entity({ id: 'a', title: 'A', set: 'onboarding', release: 'summer', status: 'done' }),
    entity({ id: 'b', title: 'B', set: 'onboarding', release: 'spring' }),
    entity({ id: 'c', title: 'C', set: 'onboarding' }),
    entity({ id: 'd', title: 'D' }),
  ],
  { teams: { growth: 'Growth' } },
);

void describe('featureSetsPage', () => {
  void it('lists feature sets with their outcome, releases, item count and progress', () => {
    const root = fragment(featureSetsPage(DATA));
    assert.equal(textOf(findOne(root, 'h1')), 'Feature sets');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '2 feature sets');
    const rows = findAll(root, 'article', { class: 'row' });
    assert.deepEqual(
      rows.map((row) => attr(row, 'data-filter-entry')),
      ['empty', 'onboarding'],
    );
    const onboarding = nth(rows, 1);
    assert.deepEqual(hrefs(findOne(onboarding, 'h2')), [`${BASE}sets/onboarding/`]);
    assert.equal(
      textOf(findOne(onboarding, 'p', { class: 'row-summary' })),
      'Admins finish setup.',
    );
    assert.equal(attr(onboarding, 'data-team'), 'growth');
    const detail = findOne(onboarding, 'div', { class: 'row-detail' });
    assert.deepEqual(hrefs(detail), [`${BASE}releases/spring/`, `${BASE}releases/summer/`]);
    const meta = findOne(onboarding, 'div', { class: 'row-meta' });
    assert.equal(textOf(findOne(meta, 'span', { class: 'num' })), '3 items');
    assert.equal(
      attr(findOne(meta, 'span', { class: 'progress-track' }), 'aria-label'),
      '1 of 3 items done',
    );
  });

  void it('shows an empty set without releases and escapes its title', () => {
    const root = fragment(featureSetsPage(DATA));
    const empty = nth(findAll(root, 'article', { class: 'row' }), 0);
    assert.equal(textOf(findOne(empty, 'h2')), HOSTILE);
    assert.equal(textOf(findOne(empty, 'p', { class: 'row-summary' })), 'Fixture description');
    assert.deepEqual(findAll(empty, 'div', { class: 'row-detail' }), []);
    assert.equal(textOf(findOne(empty, 'span', { class: 'num' })), '0 items');
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('adds the team filter and a hidden filtered empty state', () => {
    const root = fragment(featureSetsPage(DATA));
    assert.equal(findAll(root, 'ui-select', { 'data-filter': 'collection-team' }).length, 1);
    const empty = findOne(root, 'p', { class: 'catalogue-empty' });
    assert.equal(attr(empty, 'hidden'), '');
    assert.equal(textOf(empty), 'No feature sets match these filters.');
  });

  void it('explains how to add a feature set to an empty roadmap', () => {
    const root = fragment(featureSetsPage(dataFor([])));
    assert.deepEqual(findAll(root, 'article'), []);
    assert.deepEqual(findAll(root, 'div', { 'data-filter-bar': true }), []);
    const empty = findOne(root, 'p', { class: 'catalogue-empty' });
    assert.equal(attr(empty, 'hidden'), undefined);
    assert.equal(textOf(empty), 'No feature sets yet. Add a feature set folder with a README.md.');
  });
});

void describe('releasePlan', () => {
  void it('groups releases in one table by landing month or quarter, undated last', () => {
    const root = fragment(releasePlan(DATA, []));
    assert.equal(textOf(findOne(root, 'h1')), 'Releases');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '3 releases');
    const table = findOne(root, 'table', { 'aria-label': 'Releases' });
    assert.deepEqual(
      findAll(table, 'tbody').map((group) => [
        attr(group, 'aria-labelledby'),
        textOf(findOne(group, 'h2')),
        findAll(group, 'tr', { class: 'catalogue-item' }).map((row) =>
          attr(row, 'data-filter-entry'),
        ),
      ]),
      [
        ['releases-2027-05', 'May 2027', ['spring']],
        ['releases-2027-07', 'Jul 2027', ['summer']],
        ['releases-none', 'No target', ['someday']],
      ],
    );
  });

  void it('links the timeline and the items without a release under the base path', () => {
    const root = fragment(releasePlan(DATA, []));
    const actions = findOne(root, 'div', { class: 'page-actions' });
    assert.deepEqual(hrefs(actions), [`${BASE}timeline/`]);
    const note = findOne(root, 'p', { class: 'page-note' });
    assert.deepEqual(hrefs(note), [`${BASE}items/?release=~unassigned&type=item#browse`]);
    assert.equal(textOf(note), '2 items without a release');
  });

  void it('lists the Items anchors it forwards', () => {
    const root = fragment(releasePlan(DATA, ['browse', 'queue-unassigned']));
    const page = findOne(root, 'div', { class: 'page catalogue' });
    assert.equal(attr(page, 'data-items-forward'), `${BASE}items/`);
    assert.equal(attr(page, 'data-items-anchors'), 'browse queue-unassigned');
  });

  void it('filters releases by the statuses they use', () => {
    const select = findOne(fragment(releasePlan(DATA, [])), 'ui-select', {
      'data-filter': 'collection-status',
    });
    assert.deepEqual(
      findAll(select, 'ui-select-item').map((item) => attr(item, 'value')),
      ['proposed', 'planned', 'shipped'],
    );
  });

  void it('explains how to add a release and leaves out the unassigned note when all work is scheduled', () => {
    const root = fragment(
      releasePlan(dataFor([entity({ id: 'x', title: 'X', release: 'gone' })]), []),
    );
    assert.deepEqual(findAll(root, 'table'), []);
    assert.deepEqual(findAll(root, 'div', { 'data-filter-bar': true }), []);
    assert.equal(
      textOf(findOne(root, 'p', { class: 'catalogue-empty' })),
      'No releases yet. Add a release file under releases/.',
    );
    assert.deepEqual(findAll(root, 'p', { class: 'page-note' }), []);
    const one = fragment(releasePlan(dataFor([entity({ id: 'x', title: 'X' })]), []));
    assert.equal(textOf(findOne(one, 'p', { class: 'page-note' })), '1 item without a release');
  });

  void it('groups the home page releases by quarter or month, shipped by ship month, undated last', async () => {
    const releases = [
      entity({ kind: 'release', id: 'q3', title: 'Quarter', status: 'planned', target: '2027-Q3' }),
      entity({ kind: 'release', id: 'may', title: 'Month', status: 'planned', target: '2027-05' }),
      entity({ kind: 'release', id: 'day', title: 'Day', status: 'planned', target: '2027-05-20' }),
      entity({
        kind: 'release',
        id: 'early',
        title: 'Shipped early',
        status: 'shipped',
        target: '2027-Q3',
        shipped_on: '2027-02-10',
      }),
      entity({ kind: 'release', id: 'later', title: 'Someday', status: 'proposed' }),
    ];
    const page = pageText(
      await renderSite({ ...fixture, entities: releases }, TEAM_BASE),
      'index.html',
    );
    const banners = [
      ...page.matchAll(/<h2 id="releases-([^"]+)">([^<]+)<\/h2>\s*<span[^>]*>([^<]+)</g),
    ].map(([, key, label, count]) => `${key}|${label}|${count}`);
    assert.deepEqual(banners, [
      '2027-02|Feb 2027|1 release',
      '2027-05|May 2027|2 releases',
      '2027-Q3|Q3 2027|1 release',
      'none|No target|1 release',
    ]);
    assert.match(page, /role="columnheader">Release</);
    assert.ok(page.indexOf('>Month<') < page.indexOf('>Day<'));
  });
});
