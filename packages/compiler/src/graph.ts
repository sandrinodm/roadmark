import type { DateRange } from './dates.ts';
import type { Diagnostic, Entity, Kind } from './model.ts';
import type { Position, Source } from './source.ts';
import type { WorkspaceSource } from './workspace.ts';

import { dateRange } from './dates.ts';
import { addDiagnostic } from './source.ts';
import { uniqueRegistryIds } from './workspace.ts';

/**
 * Nested frontmatter keys and indexes used to locate a finding.
 */
type FieldPath = ReadonlyArray<PropertyKey>;

/**
 * Index of declared IDs and the IDs that cannot be resolved uniquely.
 */
type References = {
  /**
   * Maps each stable ID to its first declaration so duplicate diagnostics can point back to it.
   */
  byId: Map<string, Source<Entity>>;

  /**
   * Identifiers claimed by multiple source files.
   */
  ambiguous: Set<string>;
};

/**
 * Diagnostic details before attaching a source location.
 */
type Report = Pick<Diagnostic, 'severity' | 'rule' | 'message' | 'fix' | 'related'>;

/**
 * Field names shared by authored ownership values and generated inheritance markers.
 */
type OwnershipField = 'pm' | 'engineering_team';

/**
 * Fields with calendar semantics checked after decoding.
 */
type DateField = 'start' | 'target' | 'shipped_on';

/**
 * Date fields considered when validating a record's schedule.
 */
const DATE_FIELDS: Array<DateField> = ['start', 'target', 'shipped_on'];

/**
 * Owner references that may inherit from the enclosing set.
 */
const OWNERSHIP_FIELDS: Array<OwnershipField> = ['pm', 'engineering_team'];

/**
 * Item states considered settled for release consistency checks.
 */
const CLOSED_ITEM_STATES = new Set(['done', 'cancelled']);

/**
 * Inherits item owners from their parent sets and validates schedule and dependency references.
 *
 * @param workspace Resolved registries, if the workspace configuration could be loaded.
 * @param sources Parsed sources whose item owners may be filled from their parent sets.
 * @param diagnostics Receives graph errors and warnings at their authored fields.
 */
export function validateGraph(
  workspace: WorkspaceSource | undefined,
  sources: Array<Source<Entity>>,
  diagnostics: Array<Diagnostic>,
): void {
  const references = indexIds(sources, diagnostics);
  for (const source of sources) {
    const dates = validateDates(source, diagnostics);
    validateRange(source, dates, diagnostics);
    const entity = source.data;
    if (entity.kind === 'item') {
      inheritOwnership(source, references, diagnostics);
      validateItem(source, references, dates, diagnostics);
    } else if (entity.kind === 'release') {
      validateRelease(source, diagnostics);
    }

    if (workspace !== undefined) {
      validateOwnership(workspace, source, diagnostics);
    }
  }

  validateCycles(sources, references, diagnostics);
}

/**
 * Checks ordering only when both schedule bounds resolve.
 */
function validateRange(
  source: Source<Entity>,
  dates: Partial<Record<DateField, DateRange>>,
  diagnostics: Array<Diagnostic>,
): void {
  if (comesAfter(dates.start, dates.target)) {
    report(source, ['target'], diagnostics, {
      severity: 'error',
      rule: 'invalid-schedule',
      message: 'Start is after the target window ends.',
      fix: 'Move the start earlier or choose a later target.',
      related: [source.field(['start'])],
    });
  }
}

/**
 * Reports each repeated ID and includes the location of its first declaration.
 */
function indexIds(sources: Array<Source<Entity>>, diagnostics: Array<Diagnostic>): References {
  const byId = new Map<string, Source<Entity>>();
  const ambiguous = new Set<string>();
  for (const source of sources) {
    const { id } = source.data;
    const original = byId.get(id);
    if (original) {
      ambiguous.add(id);
      report(source, ['id'], diagnostics, {
        severity: 'error',
        rule: 'duplicate-id',
        message: `The stable ID "${id}" is already used in ${original.file}.`,
        fix: 'Give this record a unique ID and update the references to it.',
        related: [original.field(['id'])],
      });
    } else {
      byId.set(id, source);
    }
  }

  return { byId, ambiguous };
}

/**
 * Converts authored dates into inclusive windows and reports impossible dates.
 */
function validateDates(
  source: Source<Entity>,
  diagnostics: Array<Diagnostic>,
): Partial<Record<DateField, DateRange>> {
  const dates: Partial<Record<DateField, DateRange>> = {};
  for (const field of DATE_FIELDS) {
    const value = source.data[field];
    if (value === undefined) {
      continue;
    }

    const range = dateRange(value);
    if (range === undefined) {
      report(source, [field], diagnostics, {
        severity: 'error',
        rule: 'invalid-date',
        message: `"${value}" is not a real calendar date.`,
        fix: 'Choose an existing date, month or quarter in the format allowed for this field.',
      });
    } else {
      dates[field] = range;
    }
  }

  return dates;
}

/**
 * Fills missing item owners and records which values came from the feature set.
 */
function inheritOwnership(
  source: Source<Entity>,
  references: References,
  diagnostics: Array<Diagnostic>,
): void {
  const item = source.data;
  if (item.set && references.ambiguous.has(item.set)) {
    return;
  }

  const set = item.set ? references.byId.get(item.set)?.data : undefined;
  if (set?.kind !== 'set') {
    report(source, ['id'], diagnostics, {
      severity: 'error',
      rule: 'missing-feature-set',
      message: 'This item has no valid parent feature set.',
      fix: 'Provide a valid README.md in the feature-set folder that contains this item.',
    });
    return;
  }

  for (const field of OWNERSHIP_FIELDS) {
    const owner = set[field];
    if (item[field] === undefined && owner !== undefined) {
      item[field] = owner;
      item[`inherited_${field}`] = true;
    }
  }
}

/**
 * Checks authored ownership and contribution references against the registries.
 */
function validateOwnership(
  workspace: WorkspaceSource,
  source: Source<Entity>,
  diagnostics: Array<Diagnostic>,
): void {
  const entity = source.data;
  const options = { workspace, diagnostics };
  if (!entity.inherited_pm) {
    validateRegistry(source, ['pm'], entity.pm, { registryName: 'people', ...options });
  }

  if (!entity.inherited_engineering_team) {
    validateRegistry(source, ['engineering_team'], entity.engineering_team, {
      registryName: 'teams',
      ...options,
    });
  }

  validateRegistryList(source, 'contributors', 'people', options);
  validateRegistryList(source, 'contributing_teams', 'teams', options);
}

/**
 * Checks that each authored contributor or contributing team appears once and can be resolved.
 */
function validateRegistryList(
  source: Source<Entity>,
  key: 'contributors' | 'contributing_teams',
  registryName: 'people' | 'teams',
  { workspace, diagnostics }: { workspace: WorkspaceSource; diagnostics: Array<Diagnostic> },
): void {
  const ids = source.data[key] ?? [];
  for (const [index, id] of uniqueRegistryIds(ids, [key], source.field, diagnostics)) {
    validateRegistry(source, [key, index], id, { registryName, workspace, diagnostics });
  }
}

/**
 * Locates an unknown reference and points the author to its registry.
 */
function validateRegistry(
  source: Source<Entity>,
  path: FieldPath,
  id: string | undefined,
  {
    registryName,
    workspace,
    diagnostics,
  }: {
    registryName: 'people' | 'teams';
    workspace: WorkspaceSource;
    diagnostics: Array<Diagnostic>;
  },
): void {
  if (id === undefined || Object.hasOwn(workspace.workspace[registryName], id)) {
    return;
  }

  const file = workspace.registryFiles[registryName];
  report(source, path, diagnostics, {
    severity: 'error',
    rule: 'unknown-owner',
    message: `"${id}" is missing from the ${registryName} registry in ${file}.`,
    fix: `Use a registered ID or add "${id}" to the ${registryName} registry in ${file}.`,
  });
}

/**
 * Checks release membership, schedule and prerequisites for an item.
 */
function validateItem(
  source: Source<Entity>,
  references: References,
  dates: Partial<Record<DateField, DateRange>>,
  diagnostics: Array<Diagnostic>,
): void {
  const item = source.data;
  const release = item.release
    ? checkReference(source, ['release'], item.release, {
        kind: 'release',
        references,
        diagnostics,
      })
    : undefined;
  checkShippedRelease(source, release, diagnostics);
  checkItemTarget(source, dates.target, release, { kind: 'release', diagnostics });
  validateDependencies(source, references, dates, diagnostics);
}

/**
 * Flags unfinished work assigned to an already shipped release.
 */
function checkShippedRelease(
  source: Source<Entity>,
  release: Source<Entity> | undefined,
  diagnostics: Array<Diagnostic>,
): void {
  if (!release || release.data.status !== 'shipped') {
    return;
  }

  const status = source.data.status;
  if (status && !CLOSED_ITEM_STATES.has(status)) {
    report(source, ['release'], diagnostics, {
      severity: 'warning',
      rule: 'shipped-release-open-item',
      message: `Shipped release "${release.data.id}" still contains an open item.`,
      fix: 'Update the item status or move the item to a future release.',
      related: [release.field(['status'])],
    });
  }
}

/**
 * Warns when the entire item target window follows its release target.
 */
function checkItemTarget(
  source: Source<Entity>,
  target: DateRange | undefined,
  parent: Source<Entity> | undefined,
  { kind, diagnostics }: { kind: 'release'; diagnostics: Array<Diagnostic> },
): void {
  const parentTarget = parent?.data.target;
  if (parent === undefined || parentTarget === undefined) {
    return;
  }

  if (!comesAfter(target, dateRange(parentTarget))) {
    return;
  }

  report(source, ['target'], diagnostics, {
    severity: 'warning',
    rule: 'schedule-conflict',
    message: `Item target is after the ${kind} "${parent.data.id}" target window.`,
    fix: `Choose an earlier item target or schedule it for a later ${kind}.`,
    related: [parent.field(['target'])],
  });
}

/**
 * Resolves prerequisite IDs and checks their status and schedule.
 */
function validateDependencies(
  source: Source<Entity>,
  references: References,
  dates: Partial<Record<DateField, DateRange>>,
  diagnostics: Array<Diagnostic>,
): void {
  const item = source.data;
  for (const [index, dependency] of item.depends_on.entries()) {
    const path = ['depends_on', index, 'item'];
    const target = checkReference(source, path, dependency.item, {
      kind: 'item',
      references,
      diagnostics,
    });
    if (target === undefined || target.data.id === item.id) {
      continue;
    }

    checkDependencySchedule(source, path, target, { dates, diagnostics });
    if (item.status === 'done' && target.data.status !== 'done') {
      report(source, path, diagnostics, {
        severity: 'warning',
        rule: 'incomplete-dependency',
        message: `Completed item "${item.id}" depends on incomplete item "${dependency.item}".`,
        fix: 'Update the dependency status or remove the dependency if it no longer applies.',
        related: [target.field(['status'])],
      });
    }
  }
}

/**
 * Warns about incompatible windows when dependency ordering is unambiguous.
 */
function checkDependencySchedule(
  source: Source<Entity>,
  path: FieldPath,
  target: Source<Entity>,
  {
    dates,
    diagnostics,
  }: {
    dates: Partial<Record<DateField, DateRange>>;
    diagnostics: Array<Diagnostic>;
  },
): void {
  const targetDate = target.data.target;
  if (targetDate === undefined || !comesAfter(dateRange(targetDate), dates.start ?? dates.target)) {
    return;
  }

  const deadlineField = dates.start === undefined ? 'target' : 'start';
  const deadline = deadlineField === 'start' ? 'this item starts' : 'this item’s target window';
  report(source, path, diagnostics, {
    severity: 'warning',
    rule: 'dependency-schedule-conflict',
    message: `Prerequisite "${target.data.id}" is targeted after ${deadline}.`,
    fix: 'Adjust the item schedule, reschedule the prerequisite or revise the dependency.',
    related: [source.field([deadlineField]), target.field(['target'])],
  });
}

/**
 * Checks that actual ship dates agree with the release's lifecycle state.
 */
function validateRelease(source: Source<Entity>, diagnostics: Array<Diagnostic>): void {
  const release = source.data;
  if (release.status === 'shipped' && release.shipped_on === undefined) {
    report(source, ['status'], diagnostics, {
      severity: 'error',
      rule: 'missing-shipped-on',
      message: 'A shipped release needs its actual ship date.',
      fix: 'Add shipped_on using YYYY-MM-DD.',
    });
  } else if (release.status !== 'shipped' && release.shipped_on !== undefined) {
    report(source, ['shipped_on'], diagnostics, {
      severity: 'error',
      rule: 'unexpected-shipped-on',
      message: 'Only shipped releases have a shipped_on date.',
      fix: 'Remove shipped_on or change the status to shipped.',
      related: [source.field(['status'])],
    });
  }
}

/**
 * Resolves a reference of the expected kind and reports missing or wrong-kind targets. Duplicate
 * IDs are reported when building the index.
 */
function checkReference(
  source: Source<Entity>,
  path: FieldPath,
  id: string,
  {
    kind,
    references,
    diagnostics,
  }: {
    kind: Kind;
    references: References;
    diagnostics: Array<Diagnostic>;
  },
): Source<Entity> | undefined {
  if (references.ambiguous.has(id)) {
    return undefined;
  }

  const target = references.byId.get(id);
  if (target?.data.kind === kind) {
    return target;
  }

  const error: Report = {
    severity: 'error',
    rule: target ? 'wrong-reference-kind' : 'unknown-reference',
    message: target
      ? `"${id}" is a ${target.data.kind}, expected a ${kind}.`
      : `No ${kind} uses ID "${id}".`,
    fix: `Use the ID of an existing ${kind}.`,
  };
  if (target) {
    error.related = [target.field(['id'])];
  }

  report(source, path, diagnostics, error);
  return undefined;
}

/**
 * Checks whether the later window starts after the earlier window ends.
 */
function comesAfter(later: DateRange | undefined, earlier: DateRange | undefined): boolean {
  return later !== undefined && earlier !== undefined && later.first > earlier.last;
}

/**
 * Checks the item dependency graph for circular prerequisites.
 */
function validateCycles(
  sources: Array<Source<Entity>>,
  references: References,
  diagnostics: Array<Diagnostic>,
): void {
  const done = new Set<string>();
  const active = new Map<string, number>();
  for (const source of sources) {
    const { id, kind } = source.data;
    if (kind === 'item' && !done.has(id) && !references.ambiguous.has(id)) {
      visitDependencies(source, references, done, { active, diagnostics });
    }
  }
}

/**
 * Tracks the active dependency path to distinguish cycles from shared prerequisites.
 */
function visitDependencies(
  source: Source<Entity>,
  references: References,
  done: Set<string>,
  { active, diagnostics }: { active: Map<string, number>; diagnostics: Array<Diagnostic> },
): void {
  const stack = [{ source, next: 0 }];
  active.set(source.data.id, 0);
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame === undefined) {
      break;
    }

    const edge = frame.source.data.depends_on[frame.next];
    if (edge === undefined) {
      const id = frame.source.data.id;
      done.add(id);
      active.delete(id);
      stack.pop();
      continue;
    }

    const edgeIndex = frame.next;
    frame.next += 1;
    const target = references.byId.get(edge.item);
    if (
      target?.data.kind !== 'item' ||
      done.has(edge.item) ||
      references.ambiguous.has(edge.item)
    ) {
      continue;
    }

    const first = active.get(edge.item);
    if (first !== undefined) {
      const chain = stack.slice(first).map(({ source: member }) => member);
      reportCycle(frame.source, edgeIndex, chain, diagnostics);
      continue;
    }

    active.set(edge.item, stack.length);
    stack.push({ source: target, next: 0 });
  }
}

/**
 * Identifies the source edge and the items involved in a detected cycle.
 */
function reportCycle(
  source: Source<Entity>,
  edgeIndex: number,
  chain: Array<Source<Entity>>,
  diagnostics: Array<Diagnostic>,
): void {
  const ids = chain.map(({ data }) => data.id);
  const sequence = [...ids, ids[0]].join(' → ');
  const related: Array<Position> = chain.map((member) => member.field(['id']));
  report(source, ['depends_on', edgeIndex, 'item'], diagnostics, {
    severity: 'error',
    rule: 'dependency-cycle',
    message: `Item dependency cycle: ${sequence}.`,
    fix: 'Remove a dependency from the cycle.',
    related,
  });
}

/**
 * Attaches a graph finding to the precise frontmatter field that caused it.
 */
function report(
  source: Source<Entity>,
  path: FieldPath,
  diagnostics: Array<Diagnostic>,
  diagnostic: Report,
): void {
  addDiagnostic(diagnostics, source.field(path), diagnostic);
}
