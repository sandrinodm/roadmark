import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CLIENT_DIRECTORY, clientAssets, sourceDigest } from './client-bundle.ts';

void describe('client bundle', () => {
  void it('reuses the source bundle while the client sources are unchanged', async () => {
    const first = await clientAssets();
    assert.equal(await clientAssets(), first);
  });

  void it('publishes the boot entry and the UI SDK licence under the client folder', async () => {
    const files = await clientAssets();
    assert.equal(CLIENT_DIRECTORY, 'assets/client/');
    assert.ok([...files.keys()].every((key) => key.startsWith(CLIENT_DIRECTORY)));
    assert.ok((files.get(`${CLIENT_DIRECTORY}boot.js`)?.byteLength ?? 0) > 0);
    assert.ok((files.get(`${CLIENT_DIRECTORY}ui-sdk-license.txt`)?.byteLength ?? 0) > 0);
  });

  void it('fingerprints client sources by content, even with the same size and time', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'roadmap-client-'));
    try {
      const file = path.join(directory, 'label.ts');
      await writeFile(file, "export const label = 'Search';\n");
      const { atime, mtime } = await stat(file);
      const before = await sourceDigest([directory]);
      await writeFile(file, "export const label = 'Finder';\n");
      await utimes(file, atime, mtime);
      assert.notEqual(await sourceDigest([directory]), before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
