import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attr,
  findAll,
  findOne,
  fragment,
  HOSTILE,
  hrefs,
  nth,
  textOf,
} from '../test-support.test.ts';
import { factList, factsRail, timelineLink } from './facts.ts';
import { html } from './html.ts';

void describe('factList', () => {
  void it('renders facts in order as a definition list, marking wide ones', () => {
    const root = fragment(
      factList([
        { term: 'Start', value: html`Mar 2027` },
        { term: 'Owner', value: html`<a href="/people/maya/">Maya</a>`, wide: true },
      ]),
    );
    const list = findOne(root, 'dl');
    const entries = findAll(list, 'div');
    assert.deepEqual(
      entries.map((entry) => textOf(findOne(entry, 'dt'))),
      ['Start', 'Owner'],
    );
    assert.equal(attr(nth(entries, 0), 'class'), undefined);
    assert.equal(attr(nth(entries, 1), 'class'), 'fact-wide');
    assert.deepEqual(hrefs(findOne(nth(entries, 1), 'dd')), ['/people/maya/']);
  });

  void it('leaves out empty values, and renders nothing when every value is empty', () => {
    const root = fragment(
      factList([
        { term: 'Start', value: '' },
        { term: 'Target', value: html`` },
        { term: 'ID', value: html`<code>a</code>` },
      ]),
    );
    assert.deepEqual(
      findAll(root, 'dt').map((term) => textOf(term)),
      ['ID'],
    );
    assert.equal(factList([{ term: 'Start', value: '' }]), '');
    assert.equal(factList([]), '');
  });

  void it('escapes terms', () => {
    const root = fragment(factList([{ term: HOSTILE, value: html`x` }]));
    assert.equal(textOf(findOne(root, 'dt')), HOSTILE);
    assert.deepEqual(findAll(root, 'script'), []);
  });
});

void describe('factsRail', () => {
  void it('renders a labelled aside with the head, facts and footer', () => {
    const root = fragment(
      factsRail(
        html`<span class="pill">Done</span>`,
        [{ term: 'Start', value: html`Mar 2027` }],
        html`<nav>Footer</nav>`,
      ),
    );
    const rail = findOne(root, 'aside');
    assert.equal(attr(rail, 'id'), 'record-facts');
    assert.equal(attr(rail, 'aria-label'), 'Facts');
    assert.equal(textOf(findOne(rail, 'div', { class: 'facts-head' })), 'Done');
    assert.equal(findAll(rail, 'dl').length, 1);
    assert.equal(textOf(findOne(rail, 'nav')), 'Footer');
  });

  void it('keeps the head when there are no facts', () => {
    const root = fragment(factsRail('', [{ term: 'Start', value: '' }]));
    assert.equal(findAll(root, 'div', { class: 'facts-head' }).length, 1);
    assert.deepEqual(findAll(root, 'dl'), []);
  });
});

void describe('timelineLink', () => {
  void it('links to the timeline with the icon and keeps the page filters', () => {
    const root = fragment(
      timelineLink('/product/roadmap/timeline/?selected=a&b', 'Show on timeline'),
    );
    const link = findOne(root, 'a');
    assert.equal(attr(link, 'href'), '/product/roadmap/timeline/?selected=a&b');
    assert.equal(attr(link, 'class'), 'facts-link');
    assert.equal(attr(link, 'data-preserve-filters'), '');
    assert.equal(findAll(link, 'svg').length, 1);
    assert.equal(textOf(link), 'Show on timeline');
  });
});
