import type { Diagnostic } from './model.ts';

/**
 * Start of a field or Markdown element in a workspace file, with one-based line and column.
 */
export type Position = Pick<Diagnostic, 'file' | 'line' | 'column'>;

/**
 * A validated file and the lookup used to pinpoint its front-matter fields.
 */
export type Source<T> = {
  /**
   * Decoded value used by later validation and rendering steps.
   */
  data: T;

  /**
   * Maps a nested key or index to its original YAML location.
   */
  field: (path: ReadonlyArray<PropertyKey>) => Position;

  /**
   * Path relative to the workspace, suitable for diagnostics and links.
   */
  file: string;

  /**
   * Markdown body after frontmatter, with line endings normalized to LF.
   */
  markdown: string;

  /**
   * Number of lines preceding the Markdown body in its source file.
   */
  bodyLineOffset: number;
};

/**
 * Diagnostic details before attaching a source location.
 */
type Report = Pick<Diagnostic, 'severity' | 'rule' | 'message' | 'fix' | 'related'>;

/**
 * Adds a compiler diagnostic at an already resolved source location.
 */
export function addDiagnostic(
  diagnostics: Array<Diagnostic>,
  position: Position,
  report: Report,
): void {
  diagnostics.push({ ...report, ...position });
}

/**
 * Resolves a workspace-relative file at its first character, for file-level errors.
 */
export function fileStart(file: string): Position {
  return { file, line: 1, column: 1 };
}
