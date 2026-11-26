import { Effect, FileSystem, Schema } from 'effect';
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContentError } from './errors.ts';
import { errorText, hasCode, runPromise } from './run.ts';

void describe('runPromise', () => {
  void it('resolves with the value of an effect that uses the Node platform services', async () => {
    const effect = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.exists(tmpdir());
    });
    assert.equal(await runPromise(effect), true);
  });

  void it('rejects with the typed error of a failed effect', async () => {
    await assert.rejects(
      runPromise(Effect.fail(new ContentError({ message: 'boom' }))),
      (error) => {
        assert.ok(Schema.is(ContentError)(error));
        assert.equal(error.message, 'boom');
        return true;
      },
    );
  });
});

void describe('errorText', () => {
  void it('uses the message of an Error and stringifies any other rejection', () => {
    assert.equal(errorText(new TypeError('bad type')), 'bad type');
    assert.equal(errorText('plain text'), 'plain text');
    assert.equal(errorText(42), '42');
    assert.equal(errorText(undefined), 'undefined');
    assert.equal(errorText({ message: 'not an error' }), '[object Object]');
  });
});

void describe('hasCode', () => {
  void it('matches a Node system error by its code', async () => {
    const missing: unknown = await lstat(join(tmpdir(), `roadmark-missing-${process.pid}`)).catch(
      (error: unknown) => error,
    );
    assert.equal(hasCode(missing, 'ENOENT'), true);
    assert.equal(hasCode(missing, 'EACCES'), false);
  });

  void it('accepts any value carrying the code and rejects values without one', () => {
    assert.equal(hasCode({ code: 'ENOENT' }, 'ENOENT'), true);
    assert.equal(hasCode({ code: 2 }, '2'), false);
    assert.equal(hasCode(new Error('no code'), 'ENOENT'), false);
    assert.equal(hasCode(null, 'ENOENT'), false);
    assert.equal(hasCode('ENOENT', 'ENOENT'), false);
  });
});
