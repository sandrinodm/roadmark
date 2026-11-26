import { Effect, Predicate, Schema } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeJsonFile } from './json-file.ts';

const decodeVersion = decodeJsonFile(Schema.Struct({ version: Schema.String }));

void describe('decodeJsonFile', () => {
  void it('decodes valid JSON and tells syntax errors from schema errors', async () => {
    const valid = await Effect.runPromise(decodeVersion('/p.json', '{"version":"1.2.3"}'));
    assert.deepEqual(valid, { version: '1.2.3' });

    const syntax = await Effect.runPromise(Effect.flip(decodeVersion('/p.json', '{"version":')));
    assert.ok(Predicate.isTagged(syntax, 'JsonFileError'));
    assert.match(syntax.message, /^Could not parse \/p\.json: .*JSON/);

    const shape = await Effect.runPromise(Effect.flip(decodeVersion('/p.json', '{"version":1}')));
    assert.ok(Predicate.isTagged(shape, 'SchemaError'));
  });
});
