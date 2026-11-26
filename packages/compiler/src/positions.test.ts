import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Diagnostic } from './model.ts';

import { addDiagnostic, fileStart } from './positions.ts';

void describe('fileStart', () => {
  void it('points at the first character of a workspace file', () => {
    assert.deepEqual(fileStart('releases/summer.md'), {
      file: 'releases/summer.md',
      line: 1,
      column: 1,
    });
  });
});

void describe('addDiagnostic', () => {
  void it('appends the report at the resolved position, keeping earlier findings', () => {
    const earlier: Diagnostic = {
      severity: 'warning',
      rule: 'earlier',
      message: 'Earlier.',
      fix: 'Nothing.',
      ...fileStart('roadmap.yaml'),
    };
    const diagnostics = [earlier];
    const related = [fileStart('teams.yaml')];
    addDiagnostic(
      diagnostics,
      { file: 'people.yaml', line: 3, column: 7 },
      { severity: 'error', rule: 'unknown-team', message: 'Missing.', fix: 'Add it.', related },
    );
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[0], earlier);
    assert.deepEqual(diagnostics[1], {
      severity: 'error',
      rule: 'unknown-team',
      message: 'Missing.',
      fix: 'Add it.',
      related: [{ file: 'teams.yaml', line: 1, column: 1 }],
      file: 'people.yaml',
      line: 3,
      column: 7,
    });
  });

  void it('omits related locations when the report has none', () => {
    const diagnostics: Array<Diagnostic> = [];
    addDiagnostic(diagnostics, fileStart('a.md'), {
      severity: 'warning',
      rule: 'rule',
      message: 'Message.',
      fix: 'Fix.',
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(Object.hasOwn(diagnostics[0] ?? {}, 'related'), false);
  });
});
