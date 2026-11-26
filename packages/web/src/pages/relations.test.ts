import type { Compilation, Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from '../data.ts';

import { siteData } from '../data.ts';
import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  compilation,
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
import { html } from '../ui/html.ts';
import { related, relationshipSection } from './relations.ts';

/**
 * Two releases, items with dependencies inside and across them, and a set.
 */
const RECORDS = [
  entity({ kind: 'release', id: 'spring', title: 'Spring', source: 'releases/spring.md' }),
  entity({ kind: 'release', id: 'winter', title: 'Winter' }),
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding' }),
  entity({
    id: 'events',
    title: 'Events',
    release: 'winter',
    engineering_team: 'platform',
    status: 'done',
    target: '2027-02-22',
  }),
  entity({ id: 'schema', title: 'Schema', release: 'spring', status: 'planned' }),
  entity({ id: 'loose', title: 'Loose prerequisite' }),
  entity({
    id: 'setup',
    title: 'Setup',
    release: 'spring',
    set: 'onboarding',
    source: 'items/setup.md',
    depends_on: [
      { item: 'events', reason: HOSTILE },
      { item: 'schema' },
      { item: 'loose', reason: 'Needs the loose one.' },
      { item: 'missing' },
    ],
  }),
  entity({
    id: 'follow-up',
    title: 'Follow-up',
    depends_on: [{ item: 'setup', reason: 'After setup.' }],
  }),
];

/**
 * The records with schedule diagnostics on the release, an item, another file and an error.
 */
const MODEL: Compilation = {
  ...compilation(RECORDS, { teams: { platform: 'Platform' } }),
  diagnostics: [
    {
      severity: 'warning',
      rule: 'schedule-conflict',
      file: 'items/setup.md',
      line: 1,
      column: 1,
      message: 'Setup is late.',
      fix: 'Adjust the dates.',
    },
    {
      severity: 'warning',
      rule: 'shipped-release-open-item',
      file: 'releases/spring.md',
      line: 1,
      column: 1,
      message: 'Spring has open work.',
      fix: 'Adjust the dates.',
    },
    {
      severity: 'warning',
      rule: 'dependency-schedule-conflict',
      file: 'other.md',
      line: 1,
      column: 1,
      message: 'Elsewhere.',
      fix: 'Adjust the dates.',
    },
    {
      severity: 'warning',
      rule: 'unknown-person',
      file: 'items/setup.md',
      line: 1,
      column: 1,
      message: 'Not a schedule rule.',
      fix: 'Adjust the dates.',
    },
    {
      severity: 'error',
      rule: 'schedule-conflict',
      file: 'items/setup.md',
      line: 1,
      column: 1,
      message: 'An error.',
      fix: 'Adjust the dates.',
    },
  ],
};

/**
 * The model indexed under the nested base.
 */
const DATA = siteData(MODEL, BASE);

void describe('related', () => {
  void it('shows an item’s prerequisites and dependents with reasons, targets and statuses', () => {
    const root = fragment(related(DATA, record(DATA, 'setup')));
    const section = nth(findAll(root, 'section', { class: 'doc-section' }), 0);
    assert.equal(textOf(findOne(section, 'h2')), 'Related work');
    assert.equal(attr(section, 'id'), undefined);
    const headings = findAll(section, 'h3').map((heading) => textOf(heading));
    assert.deepEqual(headings, ['Depends on', 'Required by']);

    const rows = findAll(section, 'li', { class: 'request-row' });
    assert.equal(rows.length, 5);
    const events = nth(rows, 0);
    assert.deepEqual(hrefs(events), [`${BASE}items/events/`]);
    assert.equal(textOf(nth(findAll(events, 'p'), 0)), HOSTILE);
    assert.equal(textOf(findOne(events, 'p', { class: 'minor' })), 'Target Feb 22, 2027');
    assert.equal(textOf(findOne(events, 'span', { class: 'pill' })), 'Done');
    assert.deepEqual(findAll(nth(rows, 1), 'p'), []);
    const missing = nth(rows, 3);
    assert.equal(textOf(missing), 'missing');
    assert.deepEqual(findAll(missing, 'span', { class: 'pill' }), []);
    assert.deepEqual(hrefs(nth(rows, 4)), [`${BASE}items/follow-up/`]);
    assert.equal(textOf(findOne(nth(rows, 4), 'p')), 'After setup.');
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('shows only the side that has relationships, and nothing for an unrelated item', () => {
    const root = fragment(related(DATA, record(DATA, 'events')));
    assert.deepEqual(
      findAll(root, 'h3').map((heading) => textOf(heading)),
      ['Required by'],
    );
    assert.equal(related(DATA, record(DATA, 'follow-up')).value.includes('Required by'), false);
    const lone = entity({ id: 'lone', title: 'Lone' });
    assert.equal(related(siteData(compilation([lone]), BASE), lone).value, '');
  });

  void it('shows a release scope, prerequisites from outside it and its schedule warnings', () => {
    const root = fragment(related(DATA, record(DATA, 'spring')));
    const scope = findOne(root, 'section', { id: 'roadmap-items' });
    assert.equal(textOf(findOne(scope, 'h2')), 'Release scope');
    const headings = findAll(root, 'h2').map((heading) => textOf(heading));
    assert.deepEqual(headings, [
      'Release scope',
      'Cross-release prerequisites',
      'Schedule warnings',
    ]);
  });

  void it('names each outside prerequisite with its release and engineering team', () => {
    const section = sectionTitled(
      fragment(related(DATA, record(DATA, 'spring'))),
      'Cross-release prerequisites',
    );
    const rows = findAll(section, 'li', { class: 'request-row' });
    assert.equal(rows.length, 2);
    const [events, loose] = rows;
    assert.ok(events && loose);
    assert.equal(textOf(nth(findAll(events, 'p'), 0)), 'Setup depends on Events');
    assert.equal(textOf(nth(findAll(events, 'p'), 1)), HOSTILE);
    const minor = findOne(events, 'p', { class: 'minor' });
    assert.equal(textOf(minor), 'Prerequisite release Winter · Platform');
    assert.deepEqual(hrefs(minor), [`${BASE}releases/winter/`, `${BASE}teams/platform/`]);
    assert.equal(
      textOf(findOne(loose, 'p', { class: 'minor' })),
      'Prerequisite release Unassigned',
    );
    assert.equal(textOf(findOne(events, 'span', { class: 'pill' })), 'Done');
  });

  void it('keeps only schedule warnings about the release and its items', () => {
    const section = sectionTitled(
      fragment(related(DATA, record(DATA, 'spring'))),
      'Schedule warnings',
    );
    const rows = findAll(section, 'li', { class: 'request-row' });
    assert.deepEqual(
      rows.map((row) => textOf(findOne(row, 'p'))),
      ['Setup is late.', 'Spring has open work.'],
    );
    assert.deepEqual(hrefs(nth(rows, 0)), [`${BASE}items/setup/`]);
    assert.deepEqual(findAll(nth(rows, 1), 'strong'), []);
  });

  void it('leaves out empty release sections', () => {
    const root = fragment(related(DATA, record(DATA, 'winter')));
    assert.deepEqual(
      findAll(root, 'h2').map((heading) => textOf(heading)),
      ['Release scope'],
    );
  });

  void it('lists a feature set’s items on its own tab instead', () => {
    assert.equal(related(DATA, record(DATA, 'onboarding')).value, '');
  });

  void it('excludes cancelled items from release progress and surfaces schedule warnings', async () => {
    const files = await renderSite(fixture, TEAM_BASE);
    const page = files.get('releases/unassigned/index.html');
    assert.ok(typeof page === 'string');
    assert.match(page, /1 of 1 item done/);
    assert.match(page, /1 cancelled/);
    assert.match(page, /<h2>Schedule warnings<\/h2>/);
    assert.match(page, /Check the target date\./);
  });
});

void describe('relationshipSection', () => {
  void it('lists entries under an escaped heading at the requested level', () => {
    const rows = [html`<li>One</li>`, html`<li>Two</li>`];
    const second = fragment(relationshipSection(HOSTILE, rows));
    assert.equal(textOf(findOne(second, 'h2')), HOSTILE);
    assert.equal(attr(findOne(second, 'ul'), 'role'), 'list');
    assert.equal(findAll(second, 'li').length, 2);
    assert.deepEqual(findAll(second, 'script'), []);
    const third = fragment(relationshipSection('Depends on', rows, 3));
    assert.equal(textOf(findOne(third, 'h3')), 'Depends on');
    assert.deepEqual(findAll(third, 'h2'), []);
  });

  void it('renders nothing without entries', () => {
    assert.equal(relationshipSection('Depends on', []), '');
  });
});

/**
 * Looks up a record.
 *
 * @param data Indexed roadmap.
 * @param id Record ID.
 * @returns The record.
 */
function record(data: SiteData, id: string): Entity {
  const found = data.byId.get(id);
  assert.ok(found, id);
  return found;
}

/**
 * Finds the relationship section with a heading.
 *
 * @param root Parsed sections.
 * @param title Heading text.
 * @returns The section.
 */
function sectionTitled(root: ReturnType<typeof fragment>, title: string) {
  const section = findAll(root, 'section', { class: 'doc-section' }).find(
    (candidate) => textOf(findOne(candidate, 'div', { class: 'section-head' })) === title,
  );
  assert.ok(section, title);
  return section;
}
