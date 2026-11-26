import type { Diagnostic } from '@roadmark/compiler/model';

/**
 * Formats a source-located diagnostic and its suggested fix for terminal or development output.
 */
export function diagnosticText(diagnostic: Diagnostic): string {
  const { severity, rule, file, line, column, message, fix, related } = diagnostic;
  const lines = [`${file}:${line}:${column} ${severity} [${rule}] ${message}`, `  Fix: ${fix}`];
  for (const location of related ?? []) {
    lines.push(`  Related: ${location.file}:${location.line}:${location.column}`);
  }

  return lines.join('\n');
}

/**
 * Tests whether diagnostics prevent publishing under the selected warning policy.
 */
export function hasFailures(diagnostics: ReadonlyArray<Diagnostic>, strict: boolean): boolean {
  return diagnostics.some((diagnostic) => strict || diagnostic.severity === 'error');
}
