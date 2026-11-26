import type { Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { groupReleases, releaseSpan } from './release-groups.ts';

void describe('release groups', () => {
  void it('keeps a quarter target as a quarter and turns month and day targets into months', () => {
    assert.equal(releaseSpan(release('a', { target: '2027-Q3' })).key, '2027-Q3');
    assert.equal(releaseSpan(release('b', { target: '2027-05' })).key, '2027-05');
    assert.equal(releaseSpan(release('c', { target: '2027-05-20' })).key, '2027-05');
    assert.equal(releaseSpan(release('d', {})).key, 'none');
  });

  void it('files a shipped release under its ship month, or its target when the date is missing', () => {
    const shipped = { status: 'shipped', target: '2027-Q3' } as const;
    assert.equal(
      releaseSpan(release('a', { ...shipped, shipped_on: '2027-08-02' })).key,
      '2027-08',
    );
    assert.equal(releaseSpan(release('b', shipped)).key, '2027-Q3');
    assert.equal(
      releaseSpan(release('c', { target: '2027-Q3', shipped_on: '2027-08-02' })).key,
      '2027-Q3',
    );
  });

  void it('orders groups by start, a month before the quarter it opens, and undated last', () => {
    const groups = groupReleases([
      release('none', {}),
      release('quarter', { target: '2027-Q3' }),
      release('july', { target: '2027-07-31' }),
      release('july-early', { target: '2027-07-02' }),
      release('june', { target: '2027-06' }),
    ]);
    assert.deepEqual(
      groups.map(({ label, releases }) => [label, releases.map(({ id }) => id)]),
      [
        ['Jun 2027', ['june']],
        ['Jul 2027', ['july-early', 'july']],
        ['Q3 2027', ['quarter']],
        ['No target', ['none']],
      ],
    );
  });

  void it('orders releases landing on the same day by title, and returns no groups for none', () => {
    const groups = groupReleases([
      release('Zeta', { target: '2027-05-20' }),
      release('Alpha', { target: '2027-05-20' }),
      release('Month', { target: '2027-05' }),
    ]);
    assert.deepEqual(
      groups.map(({ key, releases }) => [key, releases.map(({ id }) => id)]),
      [['2027-05', ['Month', 'Alpha', 'Zeta']]],
    );
    assert.deepEqual(groupReleases([]), []);
  });

  void it('spans the whole quarter or month a release lands in', () => {
    assert.deepEqual(releaseSpan(release('a', { target: '2027-Q3' })), {
      key: '2027-Q3',
      start: Date.UTC(2027, 6, 1),
      end: Date.UTC(2027, 9, 1),
    });
    assert.deepEqual(releaseSpan(release('b', { target: '2027-12-24' })), {
      key: '2027-12',
      start: Date.UTC(2027, 11, 1),
      end: Date.UTC(2028, 0, 1),
    });
    assert.deepEqual(releaseSpan(release('c', {})), {
      key: 'none',
      start: Infinity,
      end: Infinity,
    });
  });
});

/**
 * Builds a release fixture.
 *
 * @param id Release ID, also its title.
 * @param fields Dates and status.
 * @returns Release.
 */
function release(id: string, fields: Partial<Entity>): Entity {
  return {
    kind: 'release',
    id,
    title: id,
    description: '',
    source: `${id}.md`,
    html: '',
    text: '',
    contributing_teams: [],
    depends_on: [],
    jira: [],
    status: 'planned',
    ...fields,
  };
}
