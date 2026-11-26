import type { Brand } from '@roadmark/compiler/brand-schema';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brandColorScheme, renderBrandStyles } from './brand.ts';
import { nth } from './test-support.test.ts';

void describe('renderBrandStyles', () => {
  void it('writes an empty root block for a brand without settings', () => {
    assert.equal(renderBrandStyles(brand()), ':root {\n}\n');
  });

  void it('maps colour roles to tokens and derives surfaces only for custom surfaces', () => {
    const accentOnly = declarations(renderBrandStyles(brand({ colors: { accent: '#0055ff' } })));
    assert.deepEqual(accentOnly, {
      '--accent': '#0055ff',
      '--accent-hover': '#0055ff',
      '--accent-soft': 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
    });

    const surfaces = declarations(
      renderBrandStyles(
        brand({ colors: { background: '#f5f5f0', surface: '#ffffff', text: '#111' } }),
      ),
    );
    assert.equal(surfaces['--paper'], '#f5f5f0');
    assert.equal(surfaces['--surface'], '#ffffff');
    assert.equal(surfaces['--ink'], '#111');
    assert.equal(surfaces['--surface-sunk'], 'color-mix(in srgb, var(--surface), var(--ink) 7%)');
    assert.equal(surfaces['--line'], 'color-mix(in srgb, var(--surface), var(--ink) 14%)');
    assert.equal(surfaces['--line-strong'], 'color-mix(in srgb, var(--surface), var(--ink) 26%)');
    assert.equal(surfaces['--control-line'], 'color-mix(in srgb, var(--surface), var(--ink) 45%)');
    assert.equal(
      surfaces['--accent-soft'],
      'color-mix(in srgb, var(--accent) 12%, var(--surface))',
    );
    assert.equal(surfaces['--accent'], undefined);
  });

  void it('prefers authored borders, hover and wash over derived values', () => {
    const tokens = declarations(
      renderBrandStyles(
        brand({
          colors: {
            surface: '#fff',
            border: '#ddd',
            strong_border: '#999',
            accent: '#05f',
            accent_hover: '#04c',
            accent_wash: '#eef',
            inverse_background: '#000',
            inverse_text: '#fff',
            inverse_accent: '#9cf',
          },
          header: {
            background: '#111',
            text: '#eee',
            muted: '#aaa',
            accent: '#f80',
            border: '#333',
          },
        }),
      ),
    );
    assert.equal(tokens['--line'], '#ddd');
    assert.equal(tokens['--line-strong'], '#999');
    assert.equal(tokens['--control-line'], '#999');
    assert.equal(tokens['--accent-hover'], '#04c');
    assert.equal(tokens['--accent-soft'], '#eef');
    assert.equal(tokens['--inverse-background'], '#000');
    assert.equal(tokens['--inverse-text'], '#fff');
    assert.equal(tokens['--inverse-accent'], '#9cf');
    assert.equal(tokens['--header-background'], '#111');
    assert.equal(tokens['--header-text'], '#eee');
    assert.equal(tokens['--header-muted'], '#aaa');
    assert.equal(tokens['--header-accent'], '#f80');
    assert.equal(tokens['--header-border'], '#333');
  });

  void it('sizes the logo and places a resolved background image relative to the assets folder', () => {
    const cover = declarations(
      renderBrandStyles({
        ...brand({ background: { image: 'brand/bg.png' } }),
        logo: { output: 'media/logo.png', width: 80, height: 20 },
        background: 'media/bg.png',
      }),
    );
    assert.equal(cover['--header-logo-aspect'], '4');
    assert.equal(cover['--page-background-image'], 'url("../media/bg.png")');
    assert.equal(cover['--page-background-size'], 'cover');
    assert.equal(cover['--page-background-repeat'], 'no-repeat');
    assert.equal(cover['--page-background-position'], 'center');

    const tile = declarations(
      renderBrandStyles({
        ...brand({ background: { image: 'brand/bg.png', fit: 'tile', position: 'top left' } }),
        background: 'media/bg.png',
      }),
    );
    assert.equal(tile['--page-background-size'], 'auto');
    assert.equal(tile['--page-background-repeat'], 'repeat');
    assert.equal(tile['--page-background-position'], 'top left');

    const contain = declarations(
      renderBrandStyles({
        ...brand({ background: { image: 'b.png', fit: 'contain' } }),
        background: 'm.png',
      }),
    );
    assert.equal(contain['--page-background-size'], 'contain');
  });

  void it('skips the background when the image was not resolved', () => {
    const tokens = declarations(
      renderBrandStyles(brand({ background: { image: 'brand/bg.png' } })),
    );
    assert.equal(tokens['--page-background-image'], undefined);
  });

  void it('sets families with fallbacks, spacing and one font face per local file', () => {
    const css = renderBrandStyles({
      ...brand({
        typography: {
          body: { font: { family: 'Inter Tight', file: 'brand/inter.woff2' }, line_height: 1.5 },
          display: {
            font: { family: 'Bricolage Grotesque', file: 'brand/bric.woff2', weight: [200, 800] },
          },
          header: { font: { family: 'Inter Tight', weight: 600 }, tracking: -0.01 },
        },
      }),
      fonts: {
        body: { file: 'media/inter.woff2', license: 'media/inter-ofl.txt' },
        display: { file: 'media/bric.woff2' },
      },
    });
    const tokens = declarations(css);
    assert.equal(
      tokens['--body'],
      `"Inter Tight", system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
    );
    assert.equal(tokens['--body-line-height'], '1.5');
    assert.match(tokens['--display'] ?? '', /^"Bricolage Grotesque", Geist, system-ui/);
    assert.equal(tokens['--header'], '"Inter Tight", var(--body)');
    assert.equal(tokens['--brand-name-font'], 'var(--header)');
    assert.equal(tokens['--header-tracking'], '-0.01em');
    assert.equal(tokens['--brand-name-tracking'], 'var(--header-tracking)');
    assert.equal(tokens['--display-line-height'], undefined);

    const faces = css.match(/@font-face \{[^}]+\}/g) ?? [];
    assert.equal(faces.length, 2);
    assert.match(nth(faces, 0), /font-family: "Inter Tight";\n {2}font-weight: 400;/);
    assert.match(nth(faces, 0), /src: url\("..\/media\/inter.woff2"\) format\("woff2"\);/);
    assert.match(nth(faces, 1), /font-weight: 200 800;/);
    assert.match(nth(faces, 1), /font-display: swap;/);
    assert.match(css, /\/\* License for Inter Tight: ..\/media\/inter-ofl.txt \*\//);
    assert.ok(css.indexOf('@font-face') < css.indexOf(':root {'));
  });

  void it('writes tracking without a family and leaves the brand name alone for other roles', () => {
    const tokens = declarations(
      renderBrandStyles(brand({ typography: { body: { tracking: 0.02 } } })),
    );
    assert.deepEqual(tokens, { '--body-tracking': '0.02em' });
  });
});

void describe('brandColorScheme', () => {
  void it('defaults to light without a surface', () => {
    assert.equal(brandColorScheme(), 'light');
    assert.equal(brandColorScheme(''), 'light');
  });

  void it('picks dark for dark surfaces and light for light ones, in short and long hex', () => {
    assert.equal(brandColorScheme('#000'), 'dark');
    assert.equal(brandColorScheme('#101418'), 'dark');
    assert.equal(brandColorScheme('#1e3a8a'), 'dark');
    assert.equal(brandColorScheme('#fff'), 'light');
    assert.equal(brandColorScheme('#fafafa'), 'light');
    assert.equal(brandColorScheme('#facc15'), 'light');
  });

  void it('switches at the luminance where black and white text contrast equally', () => {
    // #757575 has a relative luminance of about 0.178, #7a7a7a about 0.195.
    assert.equal(brandColorScheme('#757575'), 'dark');
    assert.equal(brandColorScheme('#7a7a7a'), 'light');
  });
});

/**
 * Builds a brand without resolved assets.
 *
 * @param config Settings besides the schema version.
 * @returns Brand.
 */
function brand(config: Omit<Brand['config'], 'schema_version'> = {}): Brand {
  return { config: { schema_version: 1, ...config }, fonts: {} };
}

/**
 * Reads the declarations of the `:root` block.
 *
 * @param css Stylesheet.
 * @returns Custom properties and their values.
 */
function declarations(css: string): Record<string, string> {
  const block = /:root \{\n([^}]*)\}/.exec(css)?.[1] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/^ {2}(--[\w-]+): (.*);$/gm)].map(([, key = '', value = '']) => [
      key,
      value,
    ]),
  );
}
