import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUS_LABELS, statusLabel, statusTone } from './status.ts';

void describe('statusTone', () => {
  void it('marks finished work ok, active work progress and withdrawn work quiet', () => {
    assert.equal(statusTone('done'), 'ok');
    assert.equal(statusTone('shipped'), 'ok');
    assert.equal(statusTone('in-progress'), 'progress');
    assert.equal(statusTone('cancelled'), 'quiet');
  });

  void it('falls back to neutral for planned, proposed, empty and unknown statuses', () => {
    for (const status of ['planned', 'proposed', '', 'blocked', 'toString']) {
      assert.equal(statusTone(status), 'neutral', status);
    }
  });
});

void describe('statusLabel', () => {
  void it('uses the shared label for every canonical status', () => {
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      assert.equal(statusLabel(status), label);
    }

    assert.equal(statusLabel('in-progress'), 'In progress');
  });

  void it('turns an unknown status into a capitalised phrase', () => {
    assert.equal(statusLabel('on-hold'), 'On hold');
    assert.equal(statusLabel('waiting-on-legal-review'), 'Waiting on legal review');
    assert.equal(statusLabel(''), '');
  });
});
