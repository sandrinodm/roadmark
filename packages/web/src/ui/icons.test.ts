import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IconName } from './icons.ts';

import { attr, findAll, findOne, fragment } from '../test-support.test.ts';
import { ICON_PATHS, iconMarkup } from './icons.ts';

void describe('iconMarkup', () => {
  void it('wraps each icon in one decorative 16px stroke SVG', () => {
    for (const name of Object.keys(ICON_PATHS).filter(isIconName)) {
      const root = fragment(iconMarkup(name));
      const svg = findOne(root, 'svg');
      assert.equal(attr(svg, 'aria-hidden'), 'true', name);
      assert.equal(attr(svg, 'viewBox') ?? attr(svg, 'viewbox'), '0 0 16 16', name);
      assert.equal(attr(svg, 'width'), '16', name);
      assert.equal(attr(svg, 'height'), '16', name);
      assert.equal(attr(svg, 'fill'), 'none', name);
      assert.equal(attr(svg, 'stroke'), 'currentColor', name);
      assert.ok(svg.childNodes.length > 0, name);
    }
  });

  void it('draws exactly the constant paths of the named icon', () => {
    assert.ok(iconMarkup('check').endsWith(`${ICON_PATHS.check}</svg>`));
    const item = fragment(iconMarkup('item'));
    assert.equal(findAll(item, 'rect').length, 1);
    assert.equal(findAll(item, 'path').length, 1);
    assert.notEqual(iconMarkup('item'), iconMarkup('set'));
  });

  void it('keeps every path free of scripts, handlers and external references', () => {
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      assert.doesNotMatch(paths, /<script|\son\w+=|href|url\(/i, name);
    }
  });
});

/**
 * Narrows a key of the icon set to an icon name.
 *
 * @param name Key.
 * @returns Whether the set has an icon by that name.
 */
function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_PATHS, name);
}
