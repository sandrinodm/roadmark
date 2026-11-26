import type { Compilation, Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  avatarFor,
  byDate,
  dateBounds,
  dateLabel,
  getStatus,
  KIND_LABELS,
  personName,
  progress,
  route,
  siteData,
  STATUS_LABELS,
  teamIds,
  teamName,
  utcMonth,
} from './data.ts';
import { BASE, compilation, dataFor, entity, profilesFixture } from './test-support.test.ts';
import { STATUS_LABELS as UI_STATUS_LABELS } from './ui/status.ts';

/**
 * Records with sets, releases and dependencies in an order that is not their display order.
 */
const RECORDS = [
  entity({ id: 'b-item', title: 'beta', set: 'set-a', release: 'rel-late', pm: 'maya' }),
  entity({
    id: 'a-item',
    title: 'Alpha',
    set: 'set-a',
    contributors: ['maya', 'noor'],
    pm: 'maya',
    depends_on: [{ item: 'b-item' }],
  }),
  entity({ id: 'c-item', title: 'Gamma', depends_on: [{ item: 'b-item' }, { item: 'a-item' }] }),
  entity({ kind: 'set', id: 'set-a', title: 'Set', pm: 'noor' }),
  entity({ kind: 'release', id: 'rel-late', title: 'Late', target: '2027-Q4' }),
  entity({ kind: 'release', id: 'rel-none', title: 'Undated' }),
  entity({ kind: 'release', id: 'rel-early', title: 'Early', target: '2027-02-10' }),
];

void describe('siteData', () => {
  void it('sorts records by title and releases by target, undated last', () => {
    const data = dataFor(RECORDS);
    assert.equal(data.base, BASE);
    assert.deepEqual(ids(data.items), ['a-item', 'b-item', 'c-item']);
    assert.deepEqual(ids(data.sets), ['set-a']);
    assert.deepEqual(ids(data.releases), ['rel-early', 'rel-late', 'rel-none']);
    assert.equal(data.entities.length, RECORDS.length);
    assert.equal(data.byId.get('set-a')?.title, 'Set');
  });

  void it('groups items by set and release, with an empty key for none', () => {
    const data = dataFor(RECORDS);
    assert.deepEqual(ids(data.itemsBySet.get('set-a') ?? []), ['a-item', 'b-item']);
    assert.deepEqual(ids(data.itemsBySet.get('') ?? []), ['c-item']);
    assert.deepEqual(ids(data.itemsByRelease.get('rel-late') ?? []), ['b-item']);
    assert.deepEqual(ids(data.itemsByRelease.get('') ?? []), ['a-item', 'c-item']);
    assert.equal(data.itemsByRelease.get('rel-early'), undefined);
  });

  void it('indexes the dependents of each prerequisite', () => {
    const data = dataFor(RECORDS);
    assert.deepEqual(ids(data.blockedByItem.get('b-item') ?? []), ['a-item', 'c-item']);
    assert.deepEqual(ids(data.blockedByItem.get('a-item') ?? []), ['c-item']);
    assert.equal(data.blockedByItem.get('c-item'), undefined);
  });

  void it('sorts registries by name then ID and inverts team memberships', () => {
    const data = dataFor([], {
      people: { zed: 'Alex Reed', alex: 'Alex Reed', bo: 'Bo' },
      teams: { z: 'Analytics', a: 'Platform' },
      person_details: { zed: { teams: ['a'] }, alex: { teams: ['a', 'z'] } },
    });
    assert.deepEqual(data.people, [
      ['alex', 'Alex Reed'],
      ['zed', 'Alex Reed'],
      ['bo', 'Bo'],
    ]);
    assert.deepEqual(data.teams, [
      ['z', 'Analytics'],
      ['a', 'Platform'],
    ]);
    assert.deepEqual(data.peopleByTeam.get('a'), ['alex', 'zed']);
    assert.deepEqual(data.peopleByTeam.get('z'), ['alex']);
    assert.equal(data.peopleByTeam.get('missing'), undefined);
  });

  void it('assigns each record once per person across PM and contributor roles', () => {
    const data = dataFor(RECORDS);
    assert.deepEqual(ids(data.workByPerson.get('maya') ?? []), ['a-item', 'b-item']);
    assert.deepEqual(ids(data.workByPerson.get('noor') ?? []), ['a-item', 'set-a']);
  });

  void it('handles an empty roadmap', () => {
    const data = dataFor([]);
    assert.deepEqual(
      [data.items, data.sets, data.releases, data.people, data.teams],
      [[], [], [], [], []],
    );
    assert.equal(data.itemsBySet.size, 0);
    assert.equal(data.workByPerson.size, 0);
  });

  void it('passes the workspace, brand and diagnostics through', () => {
    const model: Compilation = {
      ...compilation([]),
      brand: { config: { schema_version: 1 }, fonts: {} },
      diagnostics: [
        {
          severity: 'warning',
          rule: 'r',
          file: 'f.md',
          line: 1,
          column: 1,
          message: 'm',
          fix: 'f',
        },
      ],
    };
    const data = siteData(model, '/');
    assert.equal(data.workspace, model.workspace);
    assert.equal(data.brand, model.brand);
    assert.equal(data.diagnostics, model.diagnostics);
  });
});

void describe('labels and routes', () => {
  void it('labels kinds and re-exports the status labels', () => {
    assert.deepEqual(KIND_LABELS, { set: 'Feature set', item: 'Item', release: 'Release' });
    assert.equal(STATUS_LABELS, UI_STATUS_LABELS);
  });

  void it('routes each kind to its folder and encodes the ID', () => {
    assert.equal(route('item', 'a'), 'items/a/');
    assert.equal(route('set', 'a'), 'sets/a/');
    assert.equal(route('release', 'a'), 'releases/a/');
    assert.equal(route('team', 'a'), 'teams/a/');
    assert.equal(route('person', 'a'), 'people/a/');
    assert.equal(route('item', 'a b/c?'), 'items/a%20b%2Fc%3F/');
  });

  void it('names teams and people, falling back to the ID', () => {
    const data = dataFor([], { people: { maya: 'Maya Chen' }, teams: { growth: 'Growth' } });
    assert.equal(teamName(data, 'growth'), 'Growth');
    assert.equal(teamName(data, 'ops'), 'ops');
    assert.equal(personName(data, 'maya'), 'Maya Chen');
    assert.equal(personName(data, 'sam'), 'sam');
  });
});

void describe('avatarFor', () => {
  void it('forms two or three initials from names and preserves Unicode characters', () => {
    const model = profilesFixture();
    Object.assign(model.workspace.people, {
      two: 'Maya Chen',
      three: 'Ana María López',
      four: 'Ana María Luisa Santos',
      mono: 'Noor',
      han: '李明',
      accent: 'E\u0301lodie',
      single: '李',
    });
    const data = siteData(model, BASE);
    for (const [id, expected] of Object.entries({
      two: 'MC',
      three: 'AML',
      four: 'AMS',
      mono: 'NO',
      han: '李明',
      accent: 'ÉL',
      single: '李',
    })) {
      assert.deepEqual(avatarFor(data, id), { initials: expected });
    }
  });

  void it('drops apostrophes from a single name and falls back to the ID without letters', () => {
    const data = dataFor([], { people: { o: "O'Neil", dots: '…', apostrophe: "D'Arcy Smith" } });
    assert.deepEqual(avatarFor(data, 'o'), { initials: 'ON' });
    assert.deepEqual(avatarFor(data, 'dots'), { initials: 'DO' });
    assert.deepEqual(avatarFor(data, 'apostrophe'), { initials: 'DS' });
    assert.deepEqual(avatarFor(data, 'unregistered'), { initials: 'UN' });
  });

  void it('adds the portrait under the base path when the person has one', () => {
    const data = dataFor([], {
      people: { maya: 'Maya Chen' },
      person_details: { maya: { avatar: 'avatars/maya.webp' } },
    });
    assert.deepEqual(avatarFor(data, 'maya'), {
      initials: 'MC',
      src: `${BASE}avatars/maya.webp`,
    });
  });
});

void describe('teamIds', () => {
  void it('collects engineering and contributing teams across a scope without duplicates', () => {
    const set = entity({ kind: 'set', id: 's', title: 'S', engineering_team: 'growth' });
    const scope = [
      entity({ id: 'a', title: 'A', engineering_team: 'growth', contributing_teams: ['platform'] }),
      entity({ id: 'b', title: 'B', contributing_teams: ['analytics', 'platform'] }),
    ];
    assert.deepEqual(teamIds(set, scope), ['growth', 'platform', 'analytics']);
    assert.deepEqual(teamIds(entity({ id: 'c', title: 'C' })), []);
  });
});

void describe('getStatus and progress', () => {
  void it('reads a missing status as empty', () => {
    assert.equal(getStatus(entity({ id: 'a', title: 'A' })), '');
    assert.equal(getStatus(entity({ id: 'a', title: 'A', status: 'done' })), 'done');
  });

  void it('counts done work against the total without cancelled work', () => {
    const items = ['done', 'done', 'cancelled', 'planned', 'in-progress'].map((status, index) =>
      entity({ id: String(index), title: 'I', status }),
    );
    assert.deepEqual(progress(items), { done: 2, total: 4, cancelled: 1 });
    assert.deepEqual(progress([]), { done: 0, total: 0, cancelled: 0 });
  });
});

void describe('dates', () => {
  void it('bounds days, months and quarters as UTC half-open ranges', () => {
    assert.deepEqual(dateBounds('2027-04-09'), [Date.UTC(2027, 3, 9), Date.UTC(2027, 3, 10)]);
    assert.deepEqual(dateBounds('2027-02'), [Date.UTC(2027, 1, 1), Date.UTC(2027, 2, 1)]);
    assert.deepEqual(dateBounds('2027-Q4'), [Date.UTC(2027, 9, 1), Date.UTC(2028, 0, 1)]);
  });

  void it('returns NaN bounds for text that is not a date', () => {
    const [start, end] = dateBounds('soon');
    assert.ok(Number.isNaN(start) && Number.isNaN(end));
  });

  void it('labels dates at their authored precision', () => {
    assert.equal(dateLabel('2027-04-09'), 'Apr 9, 2027');
    assert.equal(dateLabel('2027-04'), 'Apr 2027');
    assert.equal(dateLabel('2027-Q3'), 'Q3 2027');
    assert.equal(dateLabel('2027-12-31'), 'Dec 31, 2027');
    assert.equal(dateLabel('someday'), 'someday');
  });

  void it('builds UTC month starts with rollover in both directions', () => {
    assert.equal(utcMonth(2027, 0), Date.UTC(2027, 0, 1));
    assert.equal(utcMonth(2027, 12), Date.UTC(2028, 0, 1));
    assert.equal(utcMonth(2027, -1), Date.UTC(2026, 11, 1));
    assert.equal(new Date(utcMonth(50, 0)).getUTCFullYear(), 50);
  });

  void it('orders by target start, then title and ID, with undated records last', () => {
    const records = [
      entity({ id: 'z', title: 'Undated' }),
      entity({ id: 'q', title: 'Quarter', target: '2027-Q2' }),
      entity({ id: 'm2', title: 'Same', target: '2027-04' }),
      entity({ id: 'm1', title: 'Same', target: '2027-04-01' }),
      entity({ id: 'a', title: 'Alpha', target: '2027-05' }),
      entity({ id: 'y', title: 'Another undated' }),
    ];
    assert.deepEqual(ids(records.toSorted(byDate)), ['q', 'm1', 'm2', 'a', 'y', 'z']);
  });
});

/**
 * Lists record IDs in order.
 *
 * @param records Records.
 * @returns IDs.
 */
function ids(records: ReadonlyArray<Entity>): Array<string> {
  return records.map(({ id }) => id);
}
