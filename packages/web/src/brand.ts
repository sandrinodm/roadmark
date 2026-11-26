import type { Brand } from '@roadmark/compiler/brand-schema';

import { TYPE_ROLES } from '@roadmark/compiler/brand-schema';

/**
 * CSS property and value pairs, with undefined values omitted at serialization.
 */
type Rules = Array<[string, string | number | undefined]>;

/**
 * The default CSS font-weight descriptor for a single local font file.
 */
const DEFAULT_FONT_WEIGHT = 400;

/**
 * Built-in sans-serif fallback for configured typefaces.
 */
const SANS_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * Default fallbacks appended after a configured family.
 */
const FONT_FALLBACKS = {
  /**
   * The built-in system font stack.
   */
  body: SANS_FALLBACK,

  /**
   * Built-in display family, then the system stack.
   */
  display: `Geist, ${SANS_FALLBACK}`,

  /**
   * Inherit the resolved body family, including customizations.
   */
  header: 'var(--body)',
} as const;

/**
 * Builds a stylesheet from typed tokens and URLs relative to its assets directory.
 *
 * @param brand - Validated configuration with workspace assets resolved to fingerprinted paths.
 * @returns CSS that overrides only the supplied settings in the base stylesheet.
 */
export function renderBrandStyles(brand: Brand): string {
  const rules = [...colorRules(brand.config), ...imageRules(brand)];
  const faces = applyTypography(brand, rules);
  return [...faces, cssBlock(':root', rules)].join('\n');
}

/**
 * Maps the author's named colour roles onto the site tokens (see docs/branding.md). Soft tints,
 * sunk surfaces and dividers are derived with `color-mix` so a partial palette stays coherent.
 *
 * | brand.yaml                   | token                                 |
 * | ---------------------------- | ------------------------------------- |
 * | colors.background            | --paper                               |
 * | colors.surface               | --surface (derives --surface-sunk)    |
 * | colors.text                  | --ink                                 |
 * | colors.heading               | --heading                             |
 * | colors.muted                 | --muted                               |
 * | colors.border, strong_border | --line, --line-strong, --control-line |
 * | colors.accent                | --accent (derives --accent-soft)      |
 * | colors.accent_hover          | --accent-hover                        |
 * | colors.accent_wash           | --accent-soft                         |
 * | colors.inverse_*             | --inverse-background, -text, -accent  |
 * | header.background … border   | --header-background … --header-border |
 *
 * @param config - Validated brand with optional colors and header settings.
 * @returns Declarations for the configured colors.
 */
function colorRules({ colors = {}, header = {} }: Brand['config']): Rules {
  const customSurfaces = colors.surface !== undefined || colors.background !== undefined;
  const derived = derivedWhen(customSurfaces);
  const accentSoft =
    colors.accent_wash ??
    (customSurfaces || colors.accent !== undefined
      ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
      : undefined);
  return [
    ['--paper', colors.background],
    ['--surface', colors.surface],
    ['--surface-sunk', derived('color-mix(in srgb, var(--surface), var(--ink) 7%)')],
    ['--ink', colors.text],
    ['--heading', colors.heading],
    ['--muted', colors.muted],
    ['--line', colors.border ?? derived('color-mix(in srgb, var(--surface), var(--ink) 14%)')],
    [
      '--line-strong',
      colors.strong_border ?? derived('color-mix(in srgb, var(--surface), var(--ink) 26%)'),
    ],
    [
      '--control-line',
      colors.strong_border ?? derived('color-mix(in srgb, var(--surface), var(--ink) 45%)'),
    ],
    ['--accent', colors.accent],
    ['--accent-hover', colors.accent_hover ?? colors.accent],
    ['--accent-soft', accentSoft],
    ['--inverse-background', colors.inverse_background],
    ['--inverse-text', colors.inverse_text],
    ['--inverse-accent', colors.inverse_accent],
    ...headerRules(header),
  ];
}

/**
 * Maps the header colours onto the app bar tokens.
 *
 * @param header Header colours from `brand.yaml`.
 * @returns Custom properties; unset values are skipped.
 */
function headerRules(header: NonNullable<Brand['config']['header']>): Rules {
  return [
    ['--header-background', header.background],
    ['--header-text', header.text],
    ['--header-muted', header.muted],
    ['--header-accent', header.accent],
    ['--header-border', header.border],
  ];
}

/**
 * Returns a helper that keeps a derived value only for palettes with custom surfaces, so the
 * built-in tokens stay exact otherwise.
 *
 * @param customSurfaces Whether the brand sets `background` or `surface`.
 * @returns The value, or undefined to leave the token alone.
 */
function derivedWhen(customSurfaces: boolean): (value: string) => string | undefined {
  return (value) => (customSurfaces ? value : undefined);
}

/**
 * Styles the logo slot and decorative image only when local assets were resolved.
 *
 * @param brand - Image configuration and fingerprinted asset paths.
 * @returns Declarations for logo size and the body background.
 */
function imageRules(brand: Brand): Rules {
  const { background } = brand.config;
  const rules: Rules = [];
  if (brand.logo !== undefined) {
    rules.push(['--header-logo-aspect', brand.logo.width / brand.logo.height]);
  }

  if (brand.background !== undefined && background !== undefined) {
    const fit = background.fit ?? 'cover';
    rules.push(
      ['--page-background-image', `url("../${brand.background}")`],
      ['--page-background-size', fit === 'tile' ? 'auto' : fit],
      ['--page-background-repeat', fit === 'tile' ? 'repeat' : 'no-repeat'],
      ['--page-background-position', background.position ?? 'center'],
    );
  }

  return rules;
}

/**
 * Appends role properties and deduplicates font declarations shared by several roles.
 *
 * @param brand - Validated typography settings and resolved fonts.
 * @param rules - Declarations to receive the typography overrides.
 * @returns The font-face rules and linked license notices for the authored families.
 */
function applyTypography(brand: Brand, rules: Rules): Set<string> {
  const { typography } = brand.config;
  const faces = new Set<string>();
  for (const role of TYPE_ROLES) {
    const type = typography?.[role];
    if (type === undefined) {
      continue;
    }

    if (type.tracking !== undefined) {
      rules.push([`--${role}-tracking`, `${type.tracking}em`]);
      if (role === 'header') {
        rules.push(['--brand-name-tracking', 'var(--header-tracking)']);
      }
    }

    rules.push([`--${role}-line-height`, type.line_height]);
    if (type.font === undefined) {
      continue;
    }

    const { family, weight = DEFAULT_FONT_WEIGHT } = type.font;
    rules.push([`--${role}`, `"${family}", ${FONT_FALLBACKS[role]}`]);
    if (role === 'header') {
      rules.push(['--brand-name-font', 'var(--header)']);
    }

    const font = brand.fonts[role];
    if (font === undefined) {
      continue;
    }

    faces.add(renderFontFace(family, font.file, weight));
    if (font.license !== undefined) {
      faces.add(`/* License for ${family}: ../${font.license} */\n`);
    }
  }

  return faces;
}

/**
 * Creates a normal-style font rule using a local asset relative to the stylesheet.
 *
 * @param family - Checked CSS family name.
 * @param file - Fingerprinted WOFF2 filename relative to the deployment base.
 * @param weight - One static font weight or a variable-font range.
 * @returns One CSS font-face rule.
 */
function renderFontFace(
  family: string,
  file: string,
  weight: number | readonly [number, number],
): string {
  return cssBlock('@font-face', [
    ['font-family', `"${family}"`],
    ['font-weight', typeof weight === 'number' ? weight : weight.join(' ')],
    ['font-style', 'normal'],
    ['font-display', 'swap'],
    ['src', `url("../${file}") format("woff2")`],
  ]);
}

/**
 * Formats a block of checked declarations, leaving absent settings to the CSS cascade.
 *
 * @param selector - A fixed selector or at-rule name used by the stylesheet.
 * @param rules - CSS properties and checked values to write.
 * @returns The declaration block as CSS.
 */
function cssBlock(selector: string, rules: Rules): string {
  const values = rules.flatMap(([key, value]) =>
    value === undefined ? [] : [`  ${key}: ${value};`],
  );
  return [`${selector} {`, ...values, '}', ''].join('\n');
}

/**
 * Selects component foregrounds and native controls for the configured panel color.
 *
 * @param surface - Optional three- or six-digit hex color for reader panels.
 * @returns The color scheme with the better black or white contrast on this surface.
 */
export function brandColorScheme(surface?: string): 'light' | 'dark' {
  if (!surface) {
    return 'light';
  }

  const hex = surface.slice(1);
  const channels =
    hex.length === 3 ? hex.split('').map((digit) => digit + digit) : hex.match(/../g);
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = (channels ?? []).reduce((sum, channel, index) => {
    const value = Number.parseInt(channel, 16) / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * (weights[index] ?? 0);
  }, 0);
  return luminance < 0.179 ? 'dark' : 'light';
}
