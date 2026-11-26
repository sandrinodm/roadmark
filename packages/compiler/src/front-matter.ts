import type { Document, Node } from 'yaml';

import { Result, Schema, SchemaIssue } from 'effect';
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

import type { Diagnostic } from './model.ts';
import type { Position, Source } from './positions.ts';

import { addDiagnostic, fileStart } from './positions.ts';

/**
 * Matches the opening Markdown delimiter, including an optional Unicode BOM.
 */
const OPEN_FRONT_MATTER = /^\uFEFF?---[\t ]*$/;

/**
 * Recognizes a closing delimiter on a line by itself.
 */
const CLOSE_FRONT_MATTER = /^---[\t ]*$/;

/**
 * Separates both LF and CRLF lines before computing source offsets.
 */
const LINE_ENDING = /\r?\n/;

/**
 * Effect issue text used to explain unrecognized frontmatter fields.
 */
const EXCESS_PROPERTY = 'Expected no excess property';

/**
 * Frontmatter fields of features removed from the format, with what to do about each.
 */
const REMOVED_FIELDS = new Map([
  [
    'milestone',
    {
      message: 'milestone: Milestones are no longer part of the roadmap format.',
      fix: 'Delete the milestone field; use the item target and release for dates.',
    },
  ],
  [
    'completed_on',
    {
      message: 'completed_on: Milestones are no longer part of the roadmap format.',
      fix: 'Delete the completed_on field.',
    },
  ],
  [
    'team_dependencies',
    {
      message: 'team_dependencies: Team requests are no longer part of the roadmap format.',
      fix: 'Delete the team_dependencies list; name helping teams in contributing_teams instead.',
    },
  ],
]);

/**
 * Effect issue text used to explain required fields.
 */
const MISSING_KEY = 'Missing key';

/**
 * Collects all shape errors, including unknown fields, in one pass.
 */
const strictDecodeOptions = {
  /**
   * Accumulates field errors to give authors one actionable report.
   */
  errors: 'all',

  /**
   * Rejects keys outside the declared authoring contract.
   */
  onExcessProperty: 'error',
} as const;

/**
 * Converts nested Effect decoder issues into field paths and messages.
 */
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Frontmatter, body and the offsets needed to report positions in the original file.
 */
type Split = {
  /**
   * Whole YAML configuration or the contents between Markdown frontmatter delimiters.
   */
  yaml: string;

  /**
   * Markdown body with LF line endings, or empty for a YAML-only file.
   */
  markdown: string;

  /**
   * Number of source lines before the YAML content.
   */
  yamlLineOffset: number;

  /**
   * Number of lines preceding the Markdown body in its source file.
   */
  bodyLineOffset: number;
};

/**
 * Where decoding reports problems and whether Markdown front matter is required.
 */
export type ParseOptions = {
  /**
   * Receives any parse or schema errors.
   */
  diagnostics: Array<Diagnostic>;

  /**
   * Requires Markdown front matter delimiters when true; otherwise the whole text is YAML.
   */
  frontMatter: boolean;
};

/**
 * Splits and decodes the text of a YAML file or Markdown document.
 *
 * @param file Slash-separated path relative to the workspace, used in diagnostics.
 * @param text The file contents.
 * @param schema Runtime decoder for this file's YAML.
 * @param options Diagnostic sink and front matter mode.
 * @returns Decoded source and field locations, or undefined if the text cannot be decoded.
 */
export function parseSource<S extends Schema.Decoder<unknown>>(
  file: string,
  text: string,
  schema: S,
  options: ParseOptions,
): Source<S['Type']> | undefined {
  const split = splitSource(text, file, options.diagnostics, options.frontMatter);
  return split === undefined ? undefined : decodeSource(file, split, schema, options.diagnostics);
}

/**
 * Separates Markdown and frontmatter while preserving line offsets.
 */
function splitSource(
  text: string,
  file: string,
  diagnostics: Array<Diagnostic>,
  frontMatter: boolean,
): Split | undefined {
  if (!frontMatter) {
    return { yaml: text, markdown: '', yamlLineOffset: 0, bodyLineOffset: 0 };
  }

  const lines = text.split(LINE_ENDING);
  const closing = lines.findIndex((line, index) => index > 0 && CLOSE_FRONT_MATTER.test(line));
  if (!OPEN_FRONT_MATTER.test(lines[0] ?? '') || closing < 0) {
    addDiagnostic(diagnostics, fileStart(file), {
      severity: 'error',
      rule: 'front-matter',
      message: 'Expected YAML front matter at the beginning of the Markdown file.',
      fix: 'Write the required fields between two lines containing only "---".',
    });
    return undefined;
  }

  return {
    yaml: lines.slice(1, closing).join('\n'),
    markdown: lines.slice(closing + 1).join('\n'),
    yamlLineOffset: 1,
    bodyLineOffset: closing + 1,
  };
}

/**
 * Decodes the YAML value and maps schema findings to author-visible locations.
 */
function decodeSource<S extends Schema.Decoder<unknown>>(
  file: string,
  split: Split,
  schema: S,
  diagnostics: Array<Diagnostic>,
): Source<S['Type']> | undefined {
  const lineCounter = new LineCounter();
  const yaml = parseDocument(split.yaml, { lineCounter, strict: true, uniqueKeys: sameProperty });
  /**
   * Translates a YAML character offset into the original line and column.
   */
  const positionAt = (offset: number): Position => {
    const { line, col } = lineCounter.linePos(offset);
    return { file, line: line + split.yamlLineOffset, column: col };
  };
  const raw = readYaml(yaml, positionAt, diagnostics);
  if (!raw.ok) {
    return undefined;
  }

  /**
   * Maps a nested key or index to its original YAML location.
   */
  const field = (path: ReadonlyArray<PropertyKey>): Position =>
    positionAt(fieldOffset(yaml.contents, path));

  const decoded = Schema.decodeUnknownResult(schema, strictDecodeOptions)(raw.value);
  if (Result.isFailure(decoded)) {
    reportSchemaIssues(decoded.failure.issue, field, diagnostics);
    return undefined;
  }

  return {
    data: decoded.success,
    field,
    file,
    markdown: split.markdown,
    bodyLineOffset: split.bodyLineOffset,
  };
}

/**
 * Collects YAML parse issues and extracts the value for schema decoding.
 */
function readYaml(
  yaml: Document,
  positionAt: (offset: number) => Position,
  diagnostics: Array<Diagnostic>,
): { ok: true; value: unknown } | { ok: false } {
  const problems = [...yaml.errors, ...yaml.warnings];
  if (problems.length > 0) {
    for (const issue of problems) {
      addDiagnostic(diagnostics, positionAt(issue.pos[0]), {
        severity: 'error',
        rule: issue.code === 'DUPLICATE_KEY' ? 'duplicate-yaml-key' : 'invalid-yaml',
        message: issue.message.split('\n')[0] ?? issue.message,
        fix: 'Use standard YAML and give each field a single value.',
      });
    }

    return { ok: false };
  }

  try {
    return { ok: true, value: yaml.toJS({ maxAliasCount: 0 }) };
  } catch {
    addDiagnostic(diagnostics, positionAt(0), {
      severity: 'error',
      rule: 'invalid-yaml',
      message: 'YAML aliases are unavailable in roadmap metadata.',
      fix: 'Write the referenced fields explicitly.',
    });
    return { ok: false };
  }
}

/**
 * Compares scalar keys using the property strings produced by YAML-to-JavaScript conversion.
 */
function sameProperty(left: Node, right: Node): boolean {
  // The YAML conversion treats a scalar key and its string spelling as the same property.
  return isScalar(left) && isScalar(right) && String(left.value) === String(right.value);
}

/**
 * Finds the closest source node for a nested schema error.
 */
function fieldOffset(node: Node | null, path: ReadonlyArray<PropertyKey>): number {
  let offset = node?.range?.[0] ?? 0;
  let current: unknown = node;
  for (const key of path) {
    const next = child(current, key);
    if (next === undefined) {
      return offset;
    }

    offset = next.offset ?? offset;
    current = next.node;
  }

  return offset;
}

/**
 * Steps from a YAML node to the child named by one path key, with the child's source offset.
 */
function child(
  current: unknown,
  key: PropertyKey,
): { node: unknown; offset: number | undefined } | undefined {
  if (isMap(current)) {
    const pair = current.items.find(
      (entry) => isScalar(entry.key) && String(entry.key.value) === key,
    );
    if (!pair) {
      return undefined;
    }

    return { node: pair.value, offset: isScalar(pair.key) ? pair.key.range?.[0] : undefined };
  }

  if (isSeq(current) && typeof key === 'number') {
    const item: unknown = current.items[key];
    const located = isMap(item) || isScalar(item) || isSeq(item);
    return { node: item, offset: located ? item.range?.[0] : undefined };
  }

  return undefined;
}

/**
 * Turns decoder failures into actionable, source-located diagnostics.
 */
function reportSchemaIssues(
  issue: SchemaIssue.Issue,
  field: Source<unknown>['field'],
  diagnostics: Array<Diagnostic>,
): void {
  for (const problem of formatIssue(issue).issues) {
    const path = (problem.path ?? []).map((part) => (typeof part === 'object' ? part.key : part));
    const name =
      path.reduce<string>((prefix, key) => {
        if (typeof key === 'number') {
          return `${prefix}[${key}]`;
        }

        return prefix ? `${prefix}.${String(key)}` : String(key);
      }, '') || 'YAML';
    const position = field(path);
    const details = describeSchemaIssue(position.file, name, path, problem.message);
    addDiagnostic(diagnostics, position, {
      severity: 'error',
      ...details,
    });
  }
}

/**
 * Selects the message and fix for an invalid, missing or unknown field.
 */
function describeSchemaIssue(
  file: string,
  name: string,
  path: ReadonlyArray<PropertyKey>,
  issue: string,
): Pick<Diagnostic, 'rule' | 'message' | 'fix'> {
  if (issue === EXCESS_PROPERTY) {
    const removed = path.length === 1 ? REMOVED_FIELDS.get(String(path[0])) : undefined;
    if (removed) {
      return { rule: 'removed-field', ...removed };
    }

    if (isRegistryId(file, path)) {
      return {
        rule: 'invalid-registry-id',
        message: `${name}: Expected a lowercase registry ID with single hyphens.`,
        fix: 'Rename the registry key using lowercase letters, digits and single hyphens.',
      };
    }

    return {
      rule: 'unknown-field',
      message: `${name}: This field is not defined in the schema.`,
      fix: 'Remove this key or replace it with the correct name from the field reference.',
    };
  }

  return {
    rule: 'invalid-field',
    message: `${name}: ${issue}.`,
    fix:
      issue === MISSING_KEY
        ? `Add the required field ${name}.`
        : 'Replace the value with one in the expected format.',
  };
}

/**
 * Recognizes a directory ID position so validation can explain slug syntax.
 */
function isRegistryId(file: string, path: ReadonlyArray<PropertyKey>): boolean {
  switch (file) {
    case 'roadmap.yaml':
      return path.length === 2 && (path[0] === 'people' || path[0] === 'teams');
    case 'people.yaml':
    case 'teams.yaml':
      return path.length === 1;
    default:
      return false;
  }
}
