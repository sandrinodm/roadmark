import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ATLAS_DIRECTORY, ATLAS_URL } from './index.ts';

void describe('Atlas fixture paths', () => {
  void it('point at the Atlas workspace directory and its roadmap.yaml', () => {
    assert.ok(statSync(ATLAS_DIRECTORY).isDirectory());
    assert.ok(existsSync(path.join(ATLAS_DIRECTORY, 'roadmap.yaml')));
    assert.ok(ATLAS_DIRECTORY.endsWith(path.sep), 'the path keeps its trailing separator');
  });

  void it('agree with each other', () => {
    assert.equal(fileURLToPath(ATLAS_URL), ATLAS_DIRECTORY);
    assert.ok(existsSync(new URL('roadmap.yaml', ATLAS_URL)));
  });
});
