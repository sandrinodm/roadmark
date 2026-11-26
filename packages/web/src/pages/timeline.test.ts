import { compile } from '@roadmark/compiler/compile';
import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { siteData } from '../data.ts';
import { profileView } from '../profile-view.ts';
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
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { timelinePage } from './timeline.ts';

/**
 * Two releases, a set, a team, dated and undated items, and a dependency whose dates conflict.
 */
const DATA = dataFor(
  [
    entity({
      kind: 'release',
      id: 'spring',
      title: 'Spring',
      status: 'planned',
      start: '2027-03-01',
      target: '2027-05',
    }),
    entity({
      kind: 'release',
      id: 'empty',
      title: 'Empty release',
      status: 'planned',
      target: '2027-Q4',
    }),
    entity({ kind: 'set', id: 'onboarding', title: 'Onboarding', target: '2027-01' }),
    entity({
      id: 'events',
      title: 'Events',
      status: 'done',
      target: '2027-04-20',
      pm: 'maya',
    }),
    entity({
      id: 'setup',
      title: HOSTILE,
      status: 'in-progress',
      release: 'spring',
      set: 'onboarding',
      start: '2027-04-01',
      target: '2027-04-30',
      contributors: ['maya'],
      depends_on: [{ item: 'events', reason: 'Reads the events.' }, { item: 'gone' }],
    }),
    entity({ id: 'someday', title: 'Someday', status: 'proposed', release: 'spring' }),
  ],
  { teams: { growth: 'Growth' }, people: { maya: 'Maya Chen', idle: 'Idle' } },
);

void describe('timelinePage', () => {
  void it('counts releases and items and shows the overall range', () => {
    const root = fragment(timelinePage(DATA));
    assert.equal(textOf(findOne(root, 'h1')), 'Timeline');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '5 entries');
    assert.deepEqual(findAll(root, 'div', { class: 'page-actions' }), []);
    const range = textOf(findOne(root, 'p', { class: 'minor num' }));
    assert.match(range, /^Mar.*2027$/);
    assert.match(range, /Dec/);
  });

  void it('groups dated records into release lanes in release order, unassigned last', () => {
    const root = fragment(timelinePage(DATA));
    const lanes = findAll(findOne(root, 'div', { 'data-gantt-lanes': true }), 'details');
    assert.deepEqual(
      lanes.map((lane) => [
        attr(lane, 'data-lane'),
        textOf(findOne(lane, 'summary')),
        findAll(lane, 'div', { class: 'gantt-row' }).map((row) => attr(row, 'data-timeline-id')),
      ]),
      [
        ['spring', 'Spring', ['setup', 'spring']],
        ['empty', 'Empty release', ['empty']],
        ['', 'Unassigned release', ['events']],
      ],
    );
    assert.ok(lanes.every((lane) => attr(lane, 'open') === ''));
  });

  void it('lists every lane name for regrouping', () => {
    const root = fragment(timelinePage(DATA));
    const names = (mode: string) =>
      findAll(findOne(root, 'div', { 'data-lanes': mode }), 'span').map((name) => [
        attr(name, 'data-lane-id'),
        textOf(name),
      ]);
    assert.deepEqual(names('release'), [
      ['spring', 'Spring'],
      ['empty', 'Empty release'],
    ]);
    assert.deepEqual(names('set'), [['onboarding', 'Onboarding']]);
    assert.deepEqual(names('team'), [['growth', 'Growth']]);
  });

  void it('offers the view and grouping tools and the roadmap filters', () => {
    const root = fragment(timelinePage(DATA));
    const tools = findOne(root, 'div', { 'data-timeline-tools': true });
    assert.deepEqual(
      findAll(tools, 'ui-segmented-control-item').map((item) => attr(item, 'value')),
      ['chart', 'list'],
    );
    assert.deepEqual(
      findAll(tools, 'ui-select').map((select) => attr(select, 'data-setting')),
      ['group', 'zoom'],
    );
    assert.equal(attr(findOne(root, 'div', { 'aria-label': 'Timeline filters' }), 'role'), 'group');
  });

  void it('lists dated work as the chart’s alternative and undated work apart', () => {
    const root = fragment(timelinePage(DATA));
    const dated = findOne(root, 'section', { id: 'dated-list' });
    assert.deepEqual(
      findAll(dated, 'li', { class: 'row' }).map((row) => attr(row, 'data-filter-entry')),
      ['events', 'setup', 'spring', 'empty'],
    );
    const undated = findAll(root, 'section', { class: 'page-section' }).find(
      (section) => textOf(findOne(section, 'h2')) === 'Undated',
    );
    assert.ok(undated);
    const [someday] = findAll(undated, 'li', { class: 'row' });
    assert.ok(someday);
    assert.equal(attr(someday, 'data-filter-entry'), 'someday');
    assert.equal(textOf(findOne(someday, 'div', { class: 'row-detail' })), 'No dates set');
  });

  void it('shows dependencies with their reason and date conflicts, skipping missing prerequisites', () => {
    const root = fragment(timelinePage(DATA));
    const dated = findOne(root, 'section', { id: 'dated-list' });
    const setup = nth(findAll(dated, 'li', { class: 'row' }), 1);
    assert.equal(textOf(findOne(setup, 'summary')), 'Dependencies (1)');
    const edge = findOne(setup, 'li', { 'data-edge-from': 'events' });
    assert.equal(attr(edge, 'data-edge-to'), 'setup');
    assert.equal(attr(edge, 'data-conflict'), 'true');
    assert.equal(
      textOf(findOne(edge, 'p', { class: 'edge-conflict' })),
      'The prerequisite is scheduled to finish after the dependent item starts.',
    );
    assert.ok(textOf(edge).includes('Reads the events.'));
    assert.deepEqual(hrefs(edge), [`${BASE}items/events/`, `${BASE}items/setup/`]);
    assert.ok(!textOf(root).includes('gone'));
  });

  void it('renders a hidden selection panel per record', () => {
    const root = fragment(timelinePage(DATA));
    const panels = findAll(root, 'section', { class: 'timeline-record' });
    assert.deepEqual(
      panels.map((panel) => attr(panel, 'data-selection')),
      ['events', 'setup', 'spring', 'empty', 'someday'],
    );
    assert.ok(panels.every((panel) => attr(panel, 'hidden') === ''));
    const setup = nth(panels, 1);
    assert.equal(textOf(findOne(setup, 'h2')), HOSTILE);
    assert.equal(textOf(findOne(setup, 'p', { class: 'doc-kind' })), 'Item');
    assert.equal(findAll(setup, 'li', { 'data-edge-from': 'events' }).length, 1);
    assert.equal(attr(findOne(setup, 'a', { class: 'facts-link' }), 'href'), `${BASE}items/setup/`);
    assert.equal(textOf(nth(findAll(nth(panels, 4), 'p', { class: 'minor' }), 0)), 'No dates set');
    assert.ok(textOf(nth(panels, 3)).includes('No item dependencies.'));
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('explains how to add dates when nothing has one', () => {
    const root = fragment(timelinePage(dataFor([entity({ id: 'a', title: 'A' })])));
    assert.deepEqual(findAll(root, 'section', { 'data-timeline-chart': true }), []);
    assert.deepEqual(findAll(root, 'div', { 'data-timeline-tools': true }), []);
    assert.deepEqual(findAll(root, 'section', { id: 'dated-list' }), []);
    assert.deepEqual(
      findAll(root, 'p', { class: 'empty' }).map((paragraph) => [
        textOf(paragraph),
        attr(paragraph, 'hidden'),
      ]),
      [
        ['No dates are set yet. Add target dates to show them here.', undefined],
        ['No entries match these filters.', ''],
      ],
    );
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '1 entry');
  });

  void it('limits a profile timeline to its items, with its filters and a link back', () => {
    const view = profileView(DATA, 'person', 'maya');
    const root = fragment(timelinePage(DATA, view));
    assert.equal(textOf(findOne(root, 'h1')), 'Maya Chen timeline');
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '2 entries');
    const back = findOne(findOne(root, 'div', { class: 'page-actions' }), 'a');
    assert.equal(attr(back, 'href'), `${BASE}people/maya/#roadmap-items`);
    assert.equal(attr(back, 'data-preserve-filters'), '');
    assert.equal(findAll(root, 'div', { 'aria-label': 'Item filters' }).length, 1);
    assert.deepEqual(
      findAll(root, 'div', { class: 'gantt-row' }).map((row) => [
        attr(row, 'data-timeline-id'),
        attr(row, 'data-role'),
      ]),
      [
        ['setup', 'contributor'],
        ['events', 'product-manager'],
      ],
    );
  });

  void it('says a profile without items has nothing to show', () => {
    const root = fragment(timelinePage(DATA, profileView(DATA, 'person', 'idle')));
    assert.equal(textOf(findOne(root, 'p', { role: 'status' })), '0 entries');
    assert.equal(textOf(findOne(root, 'p', { class: 'empty' })), 'No roadmap items in this view.');
    assert.deepEqual(findAll(root, 'div', { 'data-filter-bar': true }), []);
  });

  void it('lays out the compiled Atlas roadmap in release lanes with its real dependency', async () => {
    const data = siteData(await compile(ATLAS_DIRECTORY, BASE), BASE);
    const root = fragment(timelinePage(data));
    const range = textOf(findOne(root, 'p', { class: 'minor num' }));
    assert.match(range, /^Feb.*Sep 2027$/);
    const lanes = findAll(findOne(root, 'div', { 'data-gantt-lanes': true }), 'details');
    assert.deepEqual(
      lanes.map((lane) => [
        textOf(findOne(lane, 'summary')),
        findAll(lane, 'div', { class: 'gantt-row' }).map((row) => attr(row, 'data-timeline-id')),
      ]),
      [
        ['Event foundation', ['item-setup-events', 'rel-foundation']],
        ['Spring onboarding launch', ['item-setup-recovery', 'item-guided-setup', 'rel-spring']],
        ['Summer billing release', ['rel-summer', 'item-invoice-preview']],
      ],
    );
    const edge = nth(findAll(root, 'li', { 'data-edge-from': 'item-setup-events' }), 0);
    assert.equal(attr(edge, 'data-edge-to'), 'item-guided-setup');
    assert.equal(attr(edge, 'data-conflict'), 'false');
    const undated = findAll(root, 'section', { class: 'page-section' }).find(
      (section) => textOf(findOne(section, 'h2')) === 'Undated',
    );
    assert.ok(undated);
    assert.deepEqual(hrefs(undated), [`${BASE}items/item-starter-templates/`]);
  });

  void it('renders dated rows with the same filter identity and static dependency links', async () => {
    const files = await renderSite(fixture, TEAM_BASE);
    const page = files.get('timeline/index.html');
    assert.ok(typeof page === 'string');
    assert.equal(page.match(/data-filter-entry="done"/g)?.length, 2);
    assert.match(page, /<details open data-filter-group/);
    assert.match(page, /<summary>Dependencies \(1\)<\/summary>/);
    assert.match(page, /Needs the update log\./);
    assert.match(page, /datetime="2027-04">Apr 2027/);
    assert.doesNotMatch(page, /Apr 1, 2027/);
  });
});
