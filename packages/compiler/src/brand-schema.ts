import { Schema } from 'effect';

/**
 * Opaque hex colors that can be inserted directly into CSS declarations.
 */
const HEX_COLOR = /^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$(?!\s)/u;

/**
 * Family names without characters that can escape their quoted CSS context.
 */
const FAMILY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._&+'-]{0,79}$(?!\s)/u;

/**
 * Each file or folder component begins with a word character or hyphen.
 */
const PATH_SEGMENT = String.raw`[\w-][\w .-]*`;

/**
 * Still logo image formats with support for transparency.
 */
const LOGO_EXTENSIONS = ['png', 'webp'];

/**
 * Workspace-relative path of a PNG, WebP or JPEG still image.
 */
export const stillImagePath = assetPath([...LOGO_EXTENSIONS, 'jpe?g']);

/**
 * One color role, with an omitted value inherited from the site stylesheet.
 */
const color = Schema.optionalKey(pattern(HEX_COLOR, 'a hex color such as #123 or #112233'));

/**
 * Integer CSS weight accepted for a web font.
 */
const weight = bounded(100, 900).check(Schema.isInt());

/**
 * A closed interval on a variable font's weight axis.
 */
const weightRange = Schema.Tuple([weight, weight]).check(
  Schema.makeFilter(([min, max]) => min <= max, { expected: 'an ascending font weight range' }),
);

/**
 * A typeface name, optional local file and any weight or redistribution metadata.
 */
const font = Schema.Struct({
  /**
   * CSS family name used to select the typeface.
   */
  family: pattern(FAMILY_NAME, 'a font family name such as Bricolage Grotesque'),

  /**
   * Workspace-relative WOFF2 file for a locally hosted font.
   */
  file: Schema.optionalKey(assetPath(['woff2'])),

  /**
   * Single CSS weight or ascending range for a variable font.
   */
  weight: Schema.optionalKey(Schema.Union([weight, weightRange])),

  /**
   * Workspace-relative license text for the local font file.
   */
  license: Schema.optionalKey(assetPath(['txt'])),
}).check(
  Schema.makeFilter(({ file, license }) => license === undefined || file !== undefined, {
    expected: 'a local font file alongside the license',
  }),
);

/**
 * Typeface and spacing overrides for a single typography role.
 */
const typeRole = Schema.Struct({
  /**
   * Typeface override for this text role.
   */
  font: Schema.optionalKey(font),

  /**
   * Letter spacing in em units.
   */
  tracking: Schema.optionalKey(bounded(-0.12, 0.3)),

  /**
   * Unitless line-height multiplier.
   */
  line_height: Schema.optionalKey(bounded(0.8, 2.5)),
});

/**
 * Palette roles that can be set independently from the navigation bar.
 */
const colors = Schema.Struct({
  /**
   * Page background behind the content.
   */
  background: color,

  /**
   * Background for content surfaces such as cards.
   */
  surface: color,

  /**
   * Default foreground color for body copy.
   */
  text: color,

  /**
   * Foreground color for headings.
   */
  heading: color,

  /**
   * Foreground color for secondary text.
   */
  muted: color,

  /**
   * Default color for dividers and outlines.
   */
  border: color,

  /**
   * Border color for elements that need greater emphasis.
   */
  strong_border: color,

  /**
   * Accent color for links and interactive controls.
   */
  accent: color,

  /**
   * Accent color used when hovering over links and controls.
   */
  accent_hover: color,

  /**
   * Tinted background for highlighted content.
   */
  accent_wash: color,

  /**
   * Background color for sections using the inverse palette.
   */
  inverse_background: color,

  /**
   * Foreground color for text on the inverse background.
   */
  inverse_text: color,

  /**
   * Accent color for interactive elements on the inverse background.
   */
  inverse_accent: color,
});

/**
 * Image and sizing for the workspace home link.
 */
const logo = Schema.Struct({
  /**
   * Workspace-relative PNG or WebP image for the home link.
   */
  file: assetPath(LOGO_EXTENSIONS),

  /**
   * Preferred logo height in CSS pixels.
   */
  height: Schema.optionalKey(bounded(16, 64).check(Schema.isInt())),

  /**
   * Width-to-height ratio used to reserve space for the logo.
   */
  aspect: Schema.optionalKey(bounded(0.1, 14)),

  /**
   * Whether to display the workspace title alongside the mark.
   */
  show_title: Schema.optionalKey(Schema.Boolean),
});

/**
 * Navigation-specific palette roles and optional mark.
 */
const header = Schema.Struct({
  /**
   * Background color behind the navigation bar.
   */
  background: color,

  /**
   * Default foreground color for navigation text.
   */
  text: color,

  /**
   * Foreground color for secondary navigation text.
   */
  muted: color,

  /**
   * Accent color for highlighted navigation elements.
   */
  accent: color,

  /**
   * Color of the divider below the navigation bar.
   */
  border: color,

  /**
   * Optional mark shown in the workspace home link.
   */
  logo: Schema.optionalKey(logo),
});

/**
 * Decorative artwork over the page background color.
 */
const background = Schema.Struct({
  /**
   * Workspace-relative still image placed behind the page.
   */
  image: stillImagePath,

  /**
   * Whether the artwork covers, fits within or tiles across the background.
   */
  fit: Schema.optionalKey(Schema.Literals(['cover', 'contain', 'tile'])),

  /**
   * Alignment of the artwork within the page background.
   */
  position: Schema.optionalKey(Schema.Literals(['center', 'top left', 'top right'])),
});

/**
 * Validates the optional brand.yaml file before any assets are loaded.
 */
export const brandSchema = Schema.Struct({
  /**
   * Brand configuration format version understood by the compiler.
   */
  schema_version: Schema.Literal(1),

  /**
   * Site palette overrides applied to their semantic roles.
   */
  colors: Schema.optionalKey(colors.annotate({ description: 'Semantic site colors.' })),

  /**
   * Typeface and spacing overrides organized by text role.
   */
  typography: Schema.optionalKey(
    Schema.Struct({
      /**
       * Typography for body copy.
       */
      body: Schema.optionalKey(typeRole),

      /**
       * Typography for display headings.
       */
      display: Schema.optionalKey(typeRole),

      /**
       * Typography for the navigation bar.
       */
      header: Schema.optionalKey(typeRole),
    }).annotate({ description: 'Body, heading and header type settings.' }),
  ),

  /**
   * Navigation-specific palette and optional home-link mark.
   */
  header: Schema.optionalKey(header.annotate({ description: 'Header colors and optional logo.' })),

  /**
   * Optional artwork and its placement behind the page.
   */
  background: Schema.optionalKey(
    background.annotate({ description: 'Optional image behind the page.' }),
  ),
});

/**
 * Text roles processed in stylesheet order.
 */
export const TYPE_ROLES = ['body', 'display', 'header'] as const;

/**
 * Brand settings with optional files resolved to fingerprinted publication paths.
 */
export type Brand = {
  /**
   * Validated palette, typography, assets and header settings.
   */
  config: typeof brandSchema.Type;

  /**
   * Fingerprinted font and license paths for type roles defined with local files.
   */
  fonts: Partial<Record<(typeof TYPE_ROLES)[number], BrandFont>>;

  /**
   * Fingerprinted path for the page background, if configured and readable.
   */
  background?: string;

  /**
   * Mark and the space it reserves in the navigation bar.
   */
  logo?: BrandLogo;
};

/**
 * A local WOFF2 font and its optional redistribution terms.
 */
type BrandFont = {
  /**
   * Fingerprinted path of the font file, relative to deployment.
   */
  file: string;

  /**
   * Fingerprinted path of the UTF-8 license text, if supplied.
   */
  license?: string;
};

/**
 * A header logo and the dimensions written to its HTML element.
 */
type BrandLogo = {
  /**
   * Fingerprinted path relative to the deployment base.
   */
  output: string;

  /**
   * Preferred width in CSS pixels, derived from the aspect ratio.
   */
  width: number;

  /**
   * Preferred height in CSS pixels.
   */
  height: number;
};

/**
 * Defines a string rule with a human-readable expectation for lint reports.
 *
 * @param value - Regular expression matching the allowed inputs.
 * @param expected - Description of a valid value.
 * @returns The checked string schema.
 */
function pattern(value: RegExp, expected: string): Schema.String {
  return Schema.String.check(Schema.isPattern(value, { expected }));
}

/**
 * Defines the path grammar for brand images and fonts.
 *
 * @param extensions - The allowed extension patterns without leading dots.
 * @returns A schema for a normalized file path relative to the workspace.
 */
function assetPath(extensions: Array<string>): Schema.String {
  return pattern(
    new RegExp(`^${PATH_SEGMENT}(?:/${PATH_SEGMENT})*\\.(?:${extensions.join('|')})$(?!\\s)`, 'u'),
    'a normalized workspace-relative asset path with a supported extension',
  );
}

/**
 * Defines a finite numeric range for a CSS sizing or spacing input.
 *
 * @param minimum - Inclusive lower bound.
 * @param maximum - Inclusive upper bound.
 * @returns A schema that rejects values outside the range.
 */
function bounded(minimum: number, maximum: number): Schema.Finite {
  return Schema.Finite.check(Schema.isBetween({ minimum, maximum }));
}
