import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SearchEntry } from './search-rank.ts';

import { highlight, prepareEntry, rank } from './search-rank.ts';

/**
 * Builds an index record with defaults for the fields a test does not care about.
 */
function entry(fields: Partial<SearchEntry> & Pick<SearchEntry, 'title'>): SearchEntry {
  return {
    kind: 'Item',
    type: 'item',
    status: '',
    release: [],
    set: [],
    teams: [],
    href: '/items/' + fields.title.toLowerCase().replaceAll(' ', '-') + '/',
    description: '',
    id: fields.title.toLowerCase().replaceAll(' ', '-'),
    jira: [],
    text: '',
    ...fields,
  };
}

void describe('search ranking', () => {
  const index = [
    entry({ title: 'Platform Engineering', type: 'team', kind: 'Team' }),
    entry({ title: 'Billing preview', text: 'Built on the platform event bus.' }),
    entry({ title: 'Guided setup', jira: ['ONB-142', 'PLAT-88'], outcome: 'Faster setup.' }),
    entry({ title: 'Setup events', jira: ['PLAT-88'] }),
  ].map(prepareEntry);

  void it('ranks Jira key prefixes above title words and body matches', () => {
    assert.deepEqual(
      rank(index, 'PLAT').map(({ entry: { title } }) => title),
      ['Guided setup', 'Setup events', 'Platform Engineering', 'Billing preview'],
    );
    assert.equal(rank(index, 'plat-88')[0]?.score, 10_600);
  });

  void it('quotes only the outcome or summary, never body text, even for a body match', () => {
    const [guided] = rank(index, 'guided');
    assert.deepEqual(guided?.snippet, [{ text: 'Faster setup.', match: false }]);
    const [billing] = rank(index, 'bus');
    assert.ok(billing);
    assert.equal(billing.entry.title, 'Billing preview');
    assert.deepEqual(billing.snippet, []);
    const [faster] = rank(index, 'faster');
    assert.deepEqual(faster?.snippet, [
      { text: 'Faster', match: true },
      { text: ' setup.', match: false },
    ]);
    assert.deepEqual(rank(index, 'guided nothing'), []);
  });

  void it('keeps a combining accent inside the mark of the letter it decorates', () => {
    assert.deepEqual(highlight('Cafe\u0301 menu', ['cafe']), [
      { text: 'Cafe\u0301', match: true },
      { text: ' menu', match: false },
    ]);
  });

  void it('covers a whole ligature when a match ends inside its expansion', () => {
    assert.deepEqual(highlight('Aﬃnity', ['af']), [
      { text: 'Aﬃ', match: true },
      { text: 'nity', match: false },
    ]);
    assert.deepEqual(highlight('Aﬃnity', ['ity']), [
      { text: 'Aﬃn', match: false },
      { text: 'ity', match: true },
    ]);
  });

  void it('marks matches in the original text after decomposing Hangul and accents', () => {
    const term = '검증';
    assert.deepEqual(highlight(`고유한${term}문구`, [term.normalize('NFKD')]), [
      { text: '고유한', match: false },
      { text: term, match: true },
      { text: '문구', match: false },
    ]);
    assert.deepEqual(highlight('Résumé', ['resume']), [{ text: 'Résumé', match: true }]);
  });
});
