import type { Diagnostic } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diagnosticText, hasFailures } from './diagnostics.ts';

/**
 * Builds a diagnostic with defaults for the fields a test does not care about.
 */
function diagnostic(fields: Partial<Diagnostic> = {}): Diagnostic {
  return {
    severity: 'error',
    rule: 'missing-reference',
    file: 'feature-sets/onboarding/items/guided-setup.md',
    line: 4,
    column: 10,
    message: 'Unknown release "rel-later".',
    fix: 'Use the ID of an existing release.',
    ...fields,
  };
}

void describe('diagnosticText', () => {
  void it('prints the location, severity, rule, message and fix on two lines', () => {
    assert.equal(
      diagnosticText(diagnostic()),
      [
        'feature-sets/onboarding/items/guided-setup.md:4:10 error [missing-reference] Unknown release "rel-later".',
        '  Fix: Use the ID of an existing release.',
      ].join('\n'),
    );
  });

  void it('lists every related location in order after the fix', () => {
    const text = diagnosticText(
      diagnostic({
        severity: 'warning',
        rule: 'duplicate-id',
        related: [
          { file: 'releases/a.md', line: 2, column: 5 },
          { file: 'releases/b.md', line: 3, column: 1 },
        ],
      }),
    );
    assert.deepEqual(text.split('\n'), [
      'feature-sets/onboarding/items/guided-setup.md:4:10 warning [duplicate-id] Unknown release "rel-later".',
      '  Fix: Use the ID of an existing release.',
      '  Related: releases/a.md:2:5',
      '  Related: releases/b.md:3:1',
    ]);
  });

  void it('prints no related lines for an empty related list', () => {
    assert.equal(diagnosticText(diagnostic({ related: [] })).split('\n').length, 2);
  });
});

void describe('hasFailures', () => {
  void it('fails on errors under either policy and on warnings only when strict', () => {
    const warning = diagnostic({ severity: 'warning' });
    const error = diagnostic();
    assert.equal(hasFailures([], false), false);
    assert.equal(hasFailures([], true), false);
    assert.equal(hasFailures([warning], false), false);
    assert.equal(hasFailures([warning], true), true);
    assert.equal(hasFailures([warning, error], false), true);
    assert.equal(hasFailures([error], true), true);
  });
});
