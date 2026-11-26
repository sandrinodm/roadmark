import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attr, findAll, findOne, fragment } from '../test-support.test.ts';
import { icon, kindGlyph } from './glyph.ts';
import { iconMarkup } from './icons.ts';

void describe('icon', () => {
  void it('passes the constant SVG through as trusted markup', () => {
    assert.equal(icon('search').value, iconMarkup('search'));
    assert.equal(findAll(fragment(icon('search')), 'svg').length, 1);
  });
});

void describe('kindGlyph', () => {
  void it('puts the kind icon in a tile tagged with the kind', () => {
    for (const kind of ['item', 'release', 'set', 'person', 'team'] as const) {
      const root = fragment(kindGlyph(kind));
      const tile = findOne(root, 'span', { class: 'glyph' });
      assert.equal(attr(tile, 'data-kind'), kind);
      assert.equal(findAll(tile, 'svg').length, 1);
      assert.ok(kindGlyph(kind).value.includes(iconMarkup(kind)));
    }
  });
});
