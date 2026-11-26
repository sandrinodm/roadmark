import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RankedResult, SearchEntry } from './search-rank.ts';

import { assertSameNode, installDom, query } from './test-dom.ts';

installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { resultGroups } = await import('./palette-view.ts');

/**
 * The ranking the palette feeds into the view.
 */
const { HEADLINE_SCORE, prepareEntry, rank } = await import('./search-rank.ts');

/**
 * Builds an index record with defaults for the fields a test does not care about.
 *
 * @param fields Fields that matter to the test.
 * @returns Index record.
 */
function entry(fields: Partial<SearchEntry> & Pick<SearchEntry, 'id' | 'title'>): SearchEntry {
  return {
    kind: 'Item',
    type: 'item',
    status: '',
    release: [],
    set: [],
    teams: [],
    href: `/items/${fields.id}/`,
    description: '',
    jira: [],
    text: '',
    ...fields,
  };
}

/**
 * Builds a ranked result with plain text and a given score.
 *
 * @param fields Index record fields.
 * @param score Rank score.
 * @returns Ranked result.
 */
function result(
  fields: Partial<SearchEntry> & Pick<SearchEntry, 'id' | 'title'>,
  score: number,
): RankedResult {
  return {
    entry: entry(fields),
    score,
    title: [{ text: fields.title, match: false }],
    snippet: [],
    keys: [],
  };
}

/**
 * Reads each group's heading and its results' labels.
 *
 * @param groups Rendered groups.
 * @returns Heading and labels per group.
 */
function outline(groups: ReadonlyArray<HTMLElement>): Array<[string, Array<string>]> {
  return groups.map((group) => [
    query('ui-command-group-label', HTMLElement, group).textContent,
    [...group.querySelectorAll('ui-command-item')].map((item) => item.getAttribute('label') ?? ''),
  ]);
}

void describe('resultGroups', () => {
  void it('puts headline matches first in rank order, then groups the rest by type', () => {
    const groups = resultGroups([
      result({ id: 'a', title: 'Alpha' }, HEADLINE_SCORE + 100),
      result({ id: 'maya', title: 'Maya', type: 'person', kind: 'Person' }, HEADLINE_SCORE - 1),
      result({ id: 'b', title: 'Beta' }, HEADLINE_SCORE - 2),
      result(
        { id: 'spring', title: 'Spring', type: 'release', kind: 'Release' },
        HEADLINE_SCORE - 3,
      ),
      result({ id: 'c', title: 'Gamma', type: 'release', kind: 'Release' }, HEADLINE_SCORE),
      result({ id: 'noor', title: 'Noor', type: 'person', kind: 'Person' }, HEADLINE_SCORE - 4),
    ]);
    assert.deepEqual(outline(groups), [
      ['Best matches', ['Alpha', 'Gamma']],
      ['People', ['Maya', 'Noor']],
      ['Items', ['Beta']],
      ['Releases', ['Spring']],
    ]);
  });

  void it('files unknown record types under Items and returns nothing for no results', () => {
    assert.deepEqual(outline(resultGroups([result({ id: 'x', title: 'Odd', type: 'memo' }, 5)])), [
      ['Items', ['Odd']],
    ]);
    assert.deepEqual(resultGroups([]), []);
  });

  void it('renders each result as a link command with marked title, snippet and Jira keys', () => {
    const index = [
      entry({
        id: 'guided',
        title: 'Guided setup',
        status: 'in-progress',
        outcome: 'Setup in minutes.',
        jira: ['ONB-142'],
      }),
    ].map(prepareEntry);
    const [group] = resultGroups(rank(index, 'setup onb'));
    assert.ok(group);
    const item = query('ui-command-item', HTMLElement, group);
    assert.equal(item.getAttribute('value'), '/items/guided/');
    assert.equal(item.getAttribute('label'), 'Guided setup');
    assert.equal(item.hasAttribute('as-child'), true);
    const link = query('a.palette-row', HTMLAnchorElement, item);
    assert.equal(link.getAttribute('href'), '/items/guided/');
    assert.equal(query('.palette-title mark', HTMLElement, link).textContent, 'setup');
    assert.equal(query('.palette-snippet', HTMLElement, link).textContent, 'Setup in minutes.');
    assert.equal(query('.palette-key mark', HTMLElement, link).textContent, 'ONB');
    const pill = query('.pill', HTMLElement, link);
    assert.equal(pill.textContent, 'In progress');
    assert.equal(pill.dataset['tone'], 'progress');
    assert.equal(query('.glyph', HTMLElement, link).dataset['kind'], 'item');
    assert.ok(link.querySelector('.glyph svg'));
  });

  void it('omits the snippet, pill and keys a result does not have', () => {
    const [group] = resultGroups([result({ id: 'plain', title: 'Plain' }, 1)]);
    assert.ok(group);
    assertSameNode(group.querySelector('.palette-snippet, .pill, .palette-key'), null);
  });

  void it('shows a portrait or initials for people, as decoration', () => {
    const [group] = resultGroups([
      result(
        { id: 'maya', title: 'Maya', type: 'person', avatar: { initials: 'MK', src: '/m.webp' } },
        2,
      ),
      result({ id: 'noor', title: 'Noor', type: 'person', avatar: { initials: 'NA' } }, 1),
    ]);
    assert.ok(group);
    const [portrait, initials] = group.querySelectorAll<HTMLElement>('.avatar');
    assert.equal(portrait?.getAttribute('aria-hidden'), 'true');
    const image = query('img', HTMLImageElement, portrait);
    assert.equal(image.getAttribute('src'), '/m.webp');
    assert.equal(image.alt, '');
    assert.equal(initials?.textContent, 'NA');
  });

  void it('sets author text as text, never as markup', () => {
    const [group] = resultGroups([result({ id: 'x', title: '<img src=x onerror=alert(1)>' }, 1)]);
    assert.ok(group);
    assertSameNode(group.querySelector('.palette-title img'), null);
    assert.equal(
      query('.palette-title', HTMLElement, group).textContent,
      '<img src=x onerror=alert(1)>',
    );
  });
});
