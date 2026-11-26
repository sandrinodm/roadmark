import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

import type { Brand } from './brand-schema.ts';
import type { Asset, Diagnostic } from './model.ts';
import type { Position } from './source.ts';

import { brandSchema, TYPE_ROLES } from './brand-schema.ts';
import { BrandAssetError } from './errors.ts';
import { ASSET_FINGERPRINT_LENGTH } from './media.ts';
import { errorText } from './run.ts';
import { addDiagnostic, fileExists, readSource, safeFile } from './source.ts';

/**
 * Optional theme file at the workspace root.
 */
const BRAND_FILE = 'brand.yaml';

/**
 * Default preferred height of a custom logo, in CSS pixels.
 */
const DEFAULT_LOGO_HEIGHT_PX = 30;

/**
 * Bytes occupied by the fixed WOFF2 header.
 */
const WOFF2_HEADER_BYTES = 48;

/**
 * Byte offset of the container length in the WOFF2 header.
 */
const WOFF2_LENGTH_OFFSET = 8;

/**
 * Byte offset of the file type within the RIFF header.
 */
const RIFF_WEBP_OFFSET = 8;

/**
 * Exclusive byte offset of the WebP file type within the RIFF header.
 */
const RIFF_WEBP_END = 12;

/**
 * Start of a JPEG file with the prefix of its next marker.
 */
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Eight-byte PNG signature, checked before handing bytes to the image decoder.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A validated brand asset with a fingerprinted filename.
 */
type ResolvedAsset = {
  /**
   * Public path relative to the deployment base.
   */
  output: string;

  /**
   * Image width divided by height, accounting for its orientation.
   */
  aspect?: number;
};

/**
 * Resolves a file and reports errors at the provided YAML field path.
 */
type AssetFor = (file: string, field: Array<string>) => Effect.Effect<ResolvedAsset | undefined>;

/**
 * Reads the optional brand.yaml and registers its valid files for publishing.
 *
 * @param root - Absolute workspace directory.
 * @param diagnostics - Receives positions for unreadable, invalid or unsupported selections.
 * @param assets - Receives the files keyed by their fingerprinted output paths.
 * @returns The brand, or undefined when the file is absent or fails schema validation.
 */
export const readBrand = Effect.fnUntraced(function* (
  root: string,
  diagnostics: Array<Diagnostic>,
  assets: Map<string, Asset>,
): Effect.fn.Return<Brand | undefined> {
  if (!(yield* Effect.promise(() => fileExists(root, BRAND_FILE)))) {
    return undefined;
  }

  const source = yield* readSource(root, BRAND_FILE, brandSchema, {
    diagnostics,
    frontMatter: false,
  });
  if (source === undefined) {
    return undefined;
  }

  /**
   * Registers a valid brand file for publishing, or reports it at its YAML field.
   */
  const assetFor: AssetFor = (file, field) =>
    loadAsset(root, file).pipe(
      Effect.tap(({ output, record }) => Effect.sync(() => assets.set(output, record))),
      Effect.map(({ output, aspect }) => (aspect === undefined ? { output } : { output, aspect })),
      Effect.catchTag('BrandAssetError', () =>
        Effect.sync(() => {
          unreadableAsset(file, source.field(field), diagnostics);
          return undefined;
        }),
      ),
    );
  const fonts = yield* resolveFonts(source.data.typography, assetFor);
  const brand: Brand = { config: source.data, fonts };
  const logo = source.data.header?.logo;
  if (logo !== undefined) {
    const image = yield* assetFor(logo.file, ['header', 'logo', 'file']);
    if (image?.aspect !== undefined) {
      const height = logo.height ?? DEFAULT_LOGO_HEIGHT_PX;
      const aspect = logo.aspect ?? image.aspect;
      const width = Math.max(1, Math.round(height * aspect));
      brand.logo = { output: image.output, width, height };
    }
  }

  const background = source.data.background;
  if (background !== undefined) {
    const image = yield* assetFor(background.image, ['background', 'image']);
    if (image !== undefined) {
      brand.background = image.output;
    }
  }

  return brand;
});

/**
 * Resolves the font and license files for each type role, in role order.
 */
function resolveFonts(
  typography: Brand['config']['typography'],
  assetFor: AssetFor,
): Effect.Effect<Brand['fonts']> {
  const fonts: Brand['fonts'] = {};
  return Effect.forEach(
    TYPE_ROLES,
    (role) =>
      Effect.gen(function* () {
        const font = typography?.[role]?.font;
        if (font?.file === undefined) {
          return;
        }

        const field = ['typography', role, 'font'];
        const file = yield* assetFor(font.file, [...field, 'file']);
        const license = font.license && (yield* assetFor(font.license, [...field, 'license']));
        if (file !== undefined) {
          fonts[role] = license
            ? { file: file.output, license: license.output }
            : { file: file.output };
        }
      }),
    { discard: true },
  ).pipe(Effect.as(fonts));
}

/**
 * Reads, validates and fingerprints one brand file. Sharp, the WOFF2 header check and the UTF-8
 * decoder are the leaves that can fail; every failure becomes a {@link BrandAssetError}.
 */
function loadAsset(
  root: string,
  file: string,
): Effect.Effect<{ output: string; record: Asset; aspect: number | undefined }, BrandAssetError> {
  return Effect.tryPromise({
    try: async () => {
      const bytes = await readFile(await safeFile(root, file));
      const extension = extname(file);
      const aspect = await validateAsset(bytes, extension);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const output = `media/${hash.slice(0, ASSET_FINGERPRINT_LENGTH)}${extension}`;
      return { output, record: { source: file, output }, aspect };
    },
    catch: (cause) => new BrandAssetError({ file, message: errorText(cause) }),
  });
}

/**
 * Reports a brand file that could not be read in its declared format.
 */
function unreadableAsset(file: string, position: Position, diagnostics: Array<Diagnostic>): void {
  addDiagnostic(diagnostics, position, {
    severity: 'error',
    rule: 'unreadable-brand-asset',
    message: `Could not read the brand asset "${file}" in its declared format.`,
    fix: 'Use the exact path to a valid local image, WOFF2 font or UTF-8 license file.',
  });
}

/**
 * Checks an asset before the publisher can serve its unmodified bytes.
 *
 * @param bytes - The complete file contents.
 * @param extension - Its lowercase file extension, including the dot.
 * @returns Width divided by height for a still image, or undefined for a font or license.
 * @throws If the extension and data disagree or the asset cannot be used.
 */
async function validateAsset(bytes: Buffer, extension: string): Promise<number | undefined> {
  if (extension === '.txt') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.trim() || text.includes('\0')) {
      throw new Error('Expected a non-empty UTF-8 license.');
    }

    return undefined;
  }

  if (extension === '.woff2') {
    if (!isWoff2(bytes)) {
      throw new Error('Invalid WOFF2 header.');
    }

    return undefined;
  }

  if (!matchesRasterSignature(bytes, extension)) {
    throw new Error('Image signature does not match its extension.');
  }

  const { autoOrient, pages } = await sharp(bytes).metadata();
  if (pages !== undefined && pages > 1) {
    throw new Error('Brand images must be still images.');
  }

  return autoOrient.width / autoOrient.height;
}

/**
 * Checks the WOFF2 signature and container length from its fixed-size header.
 *
 * @param bytes - The complete file contents.
 * @returns Whether the file has a matching header and a payload.
 */
function isWoff2(bytes: Buffer): boolean {
  return (
    bytes.length > WOFF2_HEADER_BYTES &&
    bytes.toString('ascii', 0, 'wOF2'.length) === 'wOF2' &&
    bytes.readUInt32BE(WOFF2_LENGTH_OFFSET) === bytes.length
  );
}

/**
 * Recognizes supported raster formats before sharp examines the image metadata.
 *
 * @param bytes - The complete file contents.
 * @param extension - The extension used when serving the asset.
 * @returns Whether the bytes start with the expected signature.
 */
function matchesRasterSignature(bytes: Buffer, extension: string): boolean {
  switch (extension) {
    case '.png':
      return bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    case '.webp':
      return (
        bytes.toString('ascii', 0, 'RIFF'.length) === 'RIFF' &&
        bytes.toString('ascii', RIFF_WEBP_OFFSET, RIFF_WEBP_END) === 'WEBP'
      );
    case '.jpeg':
    case '.jpg':
      return bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
    default:
      return false;
  }
}
