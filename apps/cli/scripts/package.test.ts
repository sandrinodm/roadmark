import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { relativeSpecifier } from './package.ts';

void describe('relativeSpecifier', () => {
  void it('links compiled modules with forward slashes on Windows', () => {
    const lib = String.raw`C:\roadmark\lib`;
    assert.equal(
      relativeSpecifier(
        String.raw`${lib}\web\pages`,
        String.raw`${lib}\compiler\model`,
        path.win32,
      ),
      '../../compiler/model.js',
    );
    assert.equal(
      relativeSpecifier(lib, String.raw`${lib}\compiler\nested\source`, path.win32),
      './compiler/nested/source.js',
    );
  });

  void it('links compiled modules on POSIX', () => {
    assert.equal(
      relativeSpecifier('/lib/web/pages', '/lib/compiler/model', path.posix),
      '../../compiler/model.js',
    );
    assert.equal(
      relativeSpecifier('/lib', '/lib/compiler/model', path.posix),
      './compiler/model.js',
    );
  });
});
