import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BrandAssetError, ContentError, MdxError } from './errors.ts';

void describe('errors', () => {
  void it('carries a tag and the fields of each failure as an Error', () => {
    const content = new ContentError({ message: 'Renderer failed.' });
    assert.ok(content instanceof Error);
    assert.equal(content._tag, 'ContentError');
    assert.equal(content.message, 'Renderer failed.');

    const mdx = new MdxError({ message: 'Unexpected token.', line: 4, column: 9 });
    assert.ok(mdx instanceof Error);
    assert.deepEqual(
      [mdx._tag, mdx.message, mdx.line, mdx.column],
      ['MdxError', 'Unexpected token.', 4, 9],
    );

    const asset = new BrandAssetError({ file: 'brand/logo.png', message: 'Bad signature.' });
    assert.ok(asset instanceof Error);
    assert.deepEqual(
      [asset._tag, asset.file, asset.message],
      ['BrandAssetError', 'brand/logo.png', 'Bad signature.'],
    );
  });

  void it('lets an effect recover from one failure by its tag and keeps the others', async () => {
    const recovered = await Effect.runPromise(
      Effect.fail(new MdxError({ message: 'Broken.', line: 2, column: 1 })).pipe(
        Effect.catchTag('MdxError', (error) => Effect.succeed(`line ${error.line}`)),
      ),
    );
    assert.equal(recovered, 'line 2');

    const failure: Effect.Effect<string, ContentError | MdxError> = Effect.fail(
      new ContentError({ message: 'Other.' }),
    );
    await assert.rejects(
      Effect.runPromise(failure.pipe(Effect.catchTag('MdxError', () => Effect.succeed('caught')))),
      ContentError,
    );
  });
});
