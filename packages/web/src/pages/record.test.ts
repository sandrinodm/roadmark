import type { Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from '../data.ts';

import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  dataFor,
  done,
  entity,
  findAll,
  findOne,
  fixture,
  fragment,
  HOSTILE,
  hrefs,
  pageText,
  release,
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { entityPage, recordHeading } from './record.ts';

/**
 * A set, an item in it with compiled Markdown and a link, and two releases.
 */
const DATA = dataFor([
  entity({
    kind: 'set',
    id: 'onboarding set',
    title: 'Onboarding',
    status: 'planned',
    html: '<p>Set body</p>',
  }),
  entity({
    id: 'setup',
    title: HOSTILE,
    set: 'onboarding set',
    release: 'spring',
    outcome: ' Admins finish setup. ',
    description: 'Walks admins through setup.',
    html: '<h2 id="heading:plan">Plan</h2><p>Compiled <em>body</em></p>',
    status: 'in-progress',
    depends_on: [{ item: 'events' }],
    links: [{ label: 'Spec', url: 'https://docs.example.com/spec' }],
  }),
  entity({ id: 'events', title: 'Events' }),
  entity({ kind: 'release', id: 'spring', title: 'Spring', target: '2027-Q2' }),
  entity({ kind: 'release', id: 'summer', title: 'Summer', target: '2027-Q3' }),
]);

void describe('recordHeading', () => {
  void it('leads with the kind, the linked parent set, the escaped title and the outcome', () => {
    const root = fragment(recordHeading(DATA, record(DATA, 'setup')));
    const kind = findOne(root, 'p', { class: 'doc-kind' });
    assert.equal(attr(findOne(kind, 'span', { class: 'glyph' }), 'data-kind'), 'item');
    assert.equal(textOf(kind), 'Item · Onboarding');
    assert.deepEqual(hrefs(kind), [`${BASE}sets/onboarding%20set/`]);
    assert.equal(textOf(findOne(root, 'h1')), HOSTILE);
    assert.equal(textOf(findOne(root, 'p', { class: 'doc-lead' })), 'Admins finish setup.');
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('falls back to the description and drops an empty lead', () => {
    const set = fragment(recordHeading(DATA, record(DATA, 'onboarding set')));
    assert.equal(textOf(findOne(set, 'p', { class: 'doc-kind' })), 'Feature set');
    assert.equal(textOf(findOne(set, 'p', { class: 'doc-lead' })), 'Fixture description');
    const blank = entity({ id: 'blank', title: 'Blank', description: ' ', outcome: ' ' });
    assert.deepEqual(
      findAll(fragment(recordHeading(dataFor([blank]), blank)), 'p', { class: 'doc-lead' }),
      [],
    );
  });

  void it('shows the plain ID of a parent set that does not exist', () => {
    const orphan = entity({ id: 'orphan', title: 'Orphan', set: 'gone' });
    const kind = findOne(fragment(recordHeading(dataFor([orphan]), orphan)), 'p', {
      class: 'doc-kind',
    });
    assert.equal(textOf(kind), 'Item · gone');
    assert.deepEqual(hrefs(kind), []);
  });
});

void describe('entityPage', () => {
  void it('opens the brief with the description, then the trusted Markdown', () => {
    const root = fragment(entityPage(DATA, record(DATA, 'setup')));
    const brief = findOne(root, 'div', { id: 'record-brief' });
    assert.equal(attr(brief, 'data-item-gallery'), '');
    const paragraphs = findAll(brief, 'p').map((paragraph) => textOf(paragraph));
    assert.deepEqual(paragraphs, ['Walks admins through setup.', 'Compiled body']);
    assert.equal(findAll(brief, 'em').length, 1);
    assert.equal(findAll(brief, 'h2', { id: 'heading:plan' }).length, 1);
  });

  void it('rails the status and a timeline link that selects the record', () => {
    const root = fragment(entityPage(DATA, record(DATA, 'setup')));
    const rail = findOne(root, 'aside', { id: 'record-facts' });
    assert.equal(textOf(findOne(rail, 'span', { class: 'pill' })), 'In progress');
    assert.equal(
      attr(findOne(rail, 'a', { class: 'facts-link' }), 'href'),
      `${BASE}timeline/?selected=setup`,
    );
    assert.deepEqual(findAll(rail, 'nav'), []);
  });

  void it('adds related work and links for an item', () => {
    const root = fragment(entityPage(DATA, record(DATA, 'setup')));
    const work = findOne(root, 'div', { id: 'record-work' });
    assert.equal(textOf(findOne(work, 'h2')), 'Related work');
    assert.equal(findAll(root, 'section', { class: 'resource-links' }).length, 1);
  });

  void it('gives a feature set its tabs and a set timeline link, without related work', () => {
    const set = record(DATA, 'onboarding set');
    const root = fragment(entityPage(DATA, set));
    assert.equal(
      attr(findOne(root, 'a', { 'aria-current': 'page' }), 'href'),
      `${BASE}sets/onboarding%20set/`,
    );
    assert.equal(
      attr(findOne(root, 'a', { class: 'facts-link' }), 'href'),
      `${BASE}timeline/?set=onboarding%20set`,
    );
    assert.deepEqual(findAll(root, 'div', { id: 'record-work' }), []);
    const brief = findOne(root, 'div', { id: 'record-brief' });
    assert.equal(attr(brief, 'data-item-gallery'), undefined);
  });

  void it('gives a release its scope and neighbours', () => {
    const root = fragment(entityPage(DATA, record(DATA, 'spring')));
    assert.equal(findAll(root, 'section', { id: 'roadmap-items' }).length, 1);
    const neighbours = findOne(root, 'nav', { 'aria-label': 'Releases' });
    assert.deepEqual(hrefs(neighbours), [`${BASE}releases/summer/`]);
  });

  void it('leaves out the brief when there is neither body nor separate description', () => {
    const bare = entity({ id: 'bare', title: 'Bare', description: 'Same', outcome: 'Same' });
    const root = fragment(entityPage(dataFor([bare]), bare));
    assert.deepEqual(findAll(root, 'div', { id: 'record-brief' }), []);
    assert.deepEqual(findAll(root, 'div', { id: 'record-work' }), []);
    assert.deepEqual(findAll(root, 'section', { class: 'resource-links' }), []);
  });

  void it('opens items as a brief with planning facts in an always-visible rail', async () => {
    const item = { ...done, outcome: 'Readers can find the latest update.' };
    const files = await renderSite({ ...fixture, entities: [release, item] }, TEAM_BASE);
    const page = pageText(files, 'items/done/index.html');
    const lead = page.indexOf('>Readers can find the latest update.</p>');
    const brief = page.indexOf('<p>Fixture description</p>');
    assert.ok(lead >= 0 && brief > lead);
    assert.match(page, /<aside class="facts" id="record-facts" aria-label="Facts">/);
    assert.doesNotMatch(page, /item-planning|Planning details/);
    assert.ok(page.includes(`href="${TEAM_BASE}timeline/?selected=done"`));
    assert.doesNotMatch(page, /class="breadcrumbs"|class="section-tabs"|class="outcome"|<footer/);
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
