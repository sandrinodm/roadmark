import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_TEMPLATE, TEMPLATES } from './templates.ts';

void describe('starter templates', () => {
  void it('lists blank first, as the default, then ai-sandbox', () => {
    assert.deepEqual(
      TEMPLATES.map((template) => template.name),
      ['blank', 'ai-sandbox'],
    );
    assert.equal(DEFAULT_TEMPLATE, TEMPLATES[0].name);
  });

  void it('points every template at a packaged workspace with a roadmap.yaml', async () => {
    for (const template of TEMPLATES) {
      assert.ok(path.isAbsolute(template.directory));
      assert.ok(
        template.directory.endsWith(path.join('templates', template.name) + path.sep),
        template.directory,
      );
      assert.ok((await stat(template.directory)).isDirectory());
      assert.ok((await readdir(template.directory)).includes('roadmap.yaml'));
      assert.match(template.summary, /\.$/);
    }
  });
});
