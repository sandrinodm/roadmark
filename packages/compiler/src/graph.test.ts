import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Diagnostic, Entity } from './model.ts';
import type { Source } from './source.ts';
import type { WorkspaceSource } from './workspace.ts';

import { validateGraph } from './graph.ts';

/**
 * Registries shared by the ownership checks: one person and one team are registered.
 */
const WORKSPACE: WorkspaceSource = {
  workspace: {
    schema_version: 1,
    title: 'Graph',
    people: { alex: 'Alex Park' },
    teams: { core: 'Core' },
  },
  avatars: [],
  registryFiles: { people: 'roadmap.yaml', teams: 'teams.yaml' },
};

/**
 * Builds a parsed source whose field locator encodes the requested path after a `#`, so a test can
 * assert exactly which field a finding points to.
 */
function source(entity: Partial<Entity> & Pick<Entity, 'kind' | 'id'>): Source<Entity> {
  const file = entity.source ?? `${entity.kind}/${entity.id}.md`;
  return {
    data: {
      title: entity.id,
      description: 'Description.',
      source: file,
      html: '',
      text: '',
      contributing_teams: [],
      depends_on: [],
      jira: [],
      ...entity,
    },
    field: (path) => ({ file: `${file}#${path.map(String).join('.')}`, line: 1, column: 1 }),
    file,
    markdown: '',
    bodyLineOffset: 0,
  };
}

/**
 * A feature set owned by the registered person and team.
 */
function featureSet(id = 'set'): Source<Entity> {
  return source({ kind: 'set', id, pm: 'alex', engineering_team: 'core' });
}

/**
 * An item inside the default feature set.
 */
function item(id: string, fields: Partial<Entity> = {}): Source<Entity> {
  return source({ kind: 'item', id, set: 'set', status: 'planned', ...fields });
}

/**
 * Runs the graph checks and returns the diagnostics they produced.
 */
function validate(sources: Array<Source<Entity>>, workspace?: WorkspaceSource): Array<Diagnostic> {
  const diagnostics: Array<Diagnostic> = [];
  validateGraph(workspace, sources, diagnostics);
  return diagnostics;
}

/**
 * Reduces diagnostics to their rule and the encoded field location.
 */
function located(diagnostics: Array<Diagnostic>): Array<[string, string]> {
  return diagnostics.map(({ rule, file }) => [rule, file]);
}

void describe('validateGraph', () => {
  void it('accepts a consistent graph without findings', () => {
    const diagnostics = validate(
      [
        featureSet(),
        source({ kind: 'release', id: 'summer', status: 'planned', target: '2028-Q3' }),
        item('first', { release: 'summer', start: '2028-04-01', target: '2028-06' }),
        item('second', {
          release: 'summer',
          target: '2028-09-30',
          depends_on: [{ item: 'first' }],
          contributors: ['alex'],
          contributing_teams: ['core'],
        }),
      ],
      WORKSPACE,
    );
    assert.deepEqual(diagnostics, []);
  });

  void it('reports a repeated ID at the later record and skips references to it', () => {
    const first = item('shared');
    const diagnostics = validate([
      featureSet(),
      first,
      source({ kind: 'release', id: 'shared', status: 'planned', target: '2028-Q1' }),
      item('user', { depends_on: [{ item: 'shared' }], release: 'shared' }),
    ]);
    assert.deepEqual(located(diagnostics), [['duplicate-id', 'release/shared.md#id']]);
    assert.match(diagnostics[0]?.message ?? '', /already used in item\/shared\.md/);
    assert.deepEqual(diagnostics[0]?.related, [first.field(['id'])]);
  });

  void it('inherits missing owners from the parent set and marks them as inherited', () => {
    const own = item('own', { pm: 'stevie' });
    const inherited = item('inherited');
    assert.deepEqual(validate([featureSet(), own, inherited]), []);

    assert.equal(own.data.pm, 'stevie');
    assert.equal(own.data.inherited_pm, undefined);
    assert.equal(own.data.engineering_team, 'core');
    assert.equal(own.data.inherited_engineering_team, true);
    assert.equal(inherited.data.pm, 'alex');
    assert.equal(inherited.data.inherited_pm, true);
  });

  void it('requires each item to belong to a feature set, but not when the set ID is ambiguous', () => {
    const orphan = source({ kind: 'item', id: 'orphan', status: 'planned' });
    const wrongKind = item('wrong-kind', { set: 'summer' });
    const ambiguous = item('ambiguous', { set: 'twice' });
    const diagnostics = validate([
      source({ kind: 'release', id: 'summer', status: 'planned', target: '2028-Q1' }),
      featureSet('twice'),
      featureSet('twice'),
      orphan,
      wrongKind,
      ambiguous,
    ]);
    assert.deepEqual(located(diagnostics), [
      ['duplicate-id', 'set/twice.md#id'],
      ['missing-feature-set', 'item/orphan.md#id'],
      ['missing-feature-set', 'item/wrong-kind.md#id'],
    ]);
    assert.equal(ambiguous.data.pm, undefined);
  });

  void it('reports impossible dates and a start after the end of the target window', () => {
    const diagnostics = validate([
      featureSet(),
      item('boundary', { start: '2028-03-31', target: '2028-Q1' }),
      item('late-start', { start: '2028-04-01', target: '2028-Q1' }),
      item('impossible', { start: '2027-02-29', target: '2027-01' }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['invalid-schedule', 'item/late-start.md#target'],
      ['invalid-date', 'item/impossible.md#start'],
    ]);
    assert.deepEqual(diagnostics[0]?.related, [
      { file: 'item/late-start.md#start', line: 1, column: 1 },
    ]);
    assert.match(diagnostics[1]?.message ?? '', /"2027-02-29" is not a real calendar date/);
  });

  void it('keeps ship dates consistent with the release status', () => {
    const diagnostics = validate([
      source({ kind: 'release', id: 'missing', status: 'shipped', target: '2028-Q1' }),
      source({
        kind: 'release',
        id: 'early',
        status: 'planned',
        target: '2028-Q1',
        shipped_on: '2028-02-01',
      }),
      source({
        kind: 'release',
        id: 'done',
        status: 'shipped',
        target: '2028-Q1',
        shipped_on: '2028-02-01',
      }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['missing-shipped-on', 'release/missing.md#status'],
      ['unexpected-shipped-on', 'release/early.md#shipped_on'],
    ]);
    assert.deepEqual(diagnostics[1]?.related, [
      { file: 'release/early.md#status', line: 1, column: 1 },
    ]);
  });

  void it('reports missing and wrong-kind references at the referencing field', () => {
    const diagnostics = validate([
      featureSet(),
      item('a', { release: 'set', depends_on: [{ item: 'summer' }, { item: 'ghost' }] }),
      item('b', { release: 'nowhere' }),
      source({ kind: 'release', id: 'summer', status: 'planned', target: '2028-Q1' }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['wrong-reference-kind', 'item/a.md#release'],
      ['wrong-reference-kind', 'item/a.md#depends_on.0.item'],
      ['unknown-reference', 'item/a.md#depends_on.1.item'],
      ['unknown-reference', 'item/b.md#release'],
    ]);
    assert.equal(diagnostics[0]?.message, '"set" is a set, expected a release.');
    assert.deepEqual(diagnostics[0].related, [{ file: 'set/set.md#id', line: 1, column: 1 }]);
    assert.equal(diagnostics[2]?.message, 'No item uses ID "ghost".');
    assert.equal(diagnostics[2].related, undefined);
  });

  void it('warns about open items in a shipped release and items scheduled after their release', () => {
    const release = source({
      kind: 'release',
      id: 'spring',
      status: 'shipped',
      target: '2028-Q1',
      shipped_on: '2028-03-20',
    });
    const diagnostics = validate([
      featureSet(),
      release,
      item('open', { release: 'spring', status: 'in-progress', target: '2028-03-15' }),
      item('closed', { release: 'spring', status: 'cancelled', target: '2028-Q1' }),
      item('late', { release: 'spring', status: 'done', target: '2028-04' }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['shipped-release-open-item', 'item/open.md#release'],
      ['schedule-conflict', 'item/late.md#target'],
    ]);
    assert.ok(diagnostics.every(({ severity }) => severity === 'warning'));
    assert.deepEqual(diagnostics[0]?.related, [release.field(['status'])]);
    assert.deepEqual(diagnostics[1]?.related, [release.field(['target'])]);
    assert.match(diagnostics[1].message, /after the release "spring" target window/);
  });

  void it('compares prerequisite targets with the item start, or else its target window', () => {
    const diagnostics = validate([
      featureSet(),
      item('prerequisite', { target: '2028-Q2' }),
      item('overlapping', { target: '2028-Q2', depends_on: [{ item: 'prerequisite' }] }),
      item('starts-early', {
        start: '2028-03-01',
        target: '2028-Q4',
        depends_on: [{ item: 'prerequisite' }],
      }),
      item('ends-early', { target: '2028-03', depends_on: [{ item: 'prerequisite' }] }),
      item('unscheduled', { depends_on: [{ item: 'prerequisite' }] }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['dependency-schedule-conflict', 'item/starts-early.md#depends_on.0.item'],
      ['dependency-schedule-conflict', 'item/ends-early.md#depends_on.0.item'],
    ]);
    assert.match(diagnostics[0]?.message ?? '', /targeted after this item starts/);
    assert.deepEqual(
      diagnostics[0]?.related?.map(({ file }) => file),
      ['item/starts-early.md#start', 'item/prerequisite.md#target'],
    );
    assert.match(diagnostics[1]?.message ?? '', /after this item’s target window/);
    assert.deepEqual(
      diagnostics[1]?.related?.map(({ file }) => file),
      ['item/ends-early.md#target', 'item/prerequisite.md#target'],
    );
  });

  void it('warns when completed work depends on incomplete work', () => {
    const diagnostics = validate([
      featureSet(),
      item('open'),
      item('finished', { status: 'done' }),
      item('claimed', { status: 'done', depends_on: [{ item: 'open' }, { item: 'finished' }] }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['incomplete-dependency', 'item/claimed.md#depends_on.0.item'],
    ]);
    assert.deepEqual(diagnostics[0]?.related, [
      { file: 'item/open.md#status', line: 1, column: 1 },
    ]);
  });

  void it('reports each dependency cycle once at the edge that closes it', () => {
    const diagnostics = validate([
      featureSet(),
      item('a', { depends_on: [{ item: 'b' }] }),
      item('b', { depends_on: [{ item: 'c' }] }),
      item('c', { depends_on: [{ item: 'a' }] }),
      item('self', { depends_on: [{ item: 'self' }] }),
    ]);
    assert.deepEqual(located(diagnostics), [
      ['dependency-cycle', 'item/c.md#depends_on.0.item'],
      ['dependency-cycle', 'item/self.md#depends_on.0.item'],
    ]);
    assert.equal(diagnostics[0]?.message, 'Item dependency cycle: a → b → c → a.');
    assert.deepEqual(
      diagnostics[0].related?.map(({ file }) => file),
      ['item/a.md#id', 'item/b.md#id', 'item/c.md#id'],
    );
    assert.equal(diagnostics[1]?.message, 'Item dependency cycle: self → self.');
  });

  void it('does not mistake shared prerequisites for cycles', () => {
    const diagnostics = validate([
      featureSet(),
      item('top', { depends_on: [{ item: 'left' }, { item: 'right' }] }),
      item('left', { depends_on: [{ item: 'bottom' }] }),
      item('right', { depends_on: [{ item: 'bottom' }] }),
      item('bottom'),
    ]);
    assert.deepEqual(diagnostics, []);
  });

  void it('checks authored owners and contributors against the registries', () => {
    const diagnostics = validate(
      [
        source({ kind: 'set', id: 'set', pm: 'ghost', engineering_team: 'core' }),
        item('inherits'),
        item('overrides', {
          engineering_team: 'web',
          contributors: ['alex', 'alex', 'stevie'],
          contributing_teams: ['core', 'mobile'],
        }),
      ],
      WORKSPACE,
    );
    assert.deepEqual(located(diagnostics), [
      ['unknown-owner', 'set/set.md#pm'],
      ['unknown-owner', 'item/overrides.md#engineering_team'],
      ['duplicate-registry-reference', 'item/overrides.md#contributors.1'],
      ['unknown-owner', 'item/overrides.md#contributors.2'],
      ['unknown-owner', 'item/overrides.md#contributing_teams.1'],
    ]);
    assert.match(diagnostics[0]?.message ?? '', /people registry in roadmap\.yaml/);
    assert.match(diagnostics[1]?.message ?? '', /teams registry in teams\.yaml/);
  });

  void it('skips registry checks when the workspace could not be loaded', () => {
    const diagnostics = validate([
      source({ kind: 'set', id: 'set', pm: 'ghost', engineering_team: 'nobody' }),
      item('work', { contributors: ['ghost'] }),
    ]);
    assert.deepEqual(diagnostics, []);
  });
});
