import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

import type { Asset, Diagnostic, Workspace } from './model.ts';
import type { Source } from './source.ts';

import { ASSET_FINGERPRINT_LENGTH } from './media.ts';
import { addDiagnostic, safeFile } from './source.ts';

/**
 * Retains enough detail for a 64 CSS pixel profile portrait on a high-density display.
 */
const AVATAR_PIXELS = 128;

/**
 * Replaces authored avatar paths with published paths and collects distinct thumbnails.
 *
 * @param root Absolute workspace directory.
 * @param people Person metadata from the decoded directory.
 * @param field Locates an avatar field in either inline or standalone YAML.
 * @param diagnostics Receives a source-located error for each invalid reference.
 * @returns Assets keyed by the fingerprint of the final square WebP image.
 */
export async function resolveAvatars(
  root: string,
  people: NonNullable<Workspace['person_details']>,
  field: Source<unknown>['field'],
  diagnostics: Array<Diagnostic>,
): Promise<Array<Asset>> {
  const sources = new Map<string, Asset>();
  const outputs = new Map<string, Asset>();
  await Object.entries(people).reduce(async (previous, [id, details]) => {
    await previous;
    const file = details.avatar;
    if (!file) {
      return;
    }

    try {
      const asset = sources.get(file) ?? (await thumbnail(root, file));
      sources.set(file, asset);
      outputs.set(asset.output, asset);
      details.avatar = asset.output;
    } catch {
      delete details.avatar;
      addDiagnostic(diagnostics, field([id, 'avatar']), {
        severity: 'error',
        rule: 'unreadable-avatar',
        message: `Could not load the avatar "${file}" for "${id}".`,
        fix: 'Use the exact path to a still PNG, JPEG or WebP image inside the workspace.',
      });
    }
  }, Promise.resolve());

  return [...outputs.values()];
}

/**
 * Reads one portrait and emits an oriented, center-cropped image without embedded metadata.
 *
 * @param root Absolute workspace directory.
 * @param file Validated workspace-relative image path.
 * @returns A ready-to-publish WebP asset.
 */
async function thumbnail(root: string, file: string): Promise<Asset> {
  const source = await readFile(await safeFile(root, file));
  const image = sharp(source);
  const { format, pages } = await image.metadata();
  const extension = extname(file).slice(1);
  const expected = extension === 'jpg' ? 'jpeg' : extension;
  if (format !== expected || (pages ?? 1) > 1) {
    throw new Error('Expected a still image matching its file extension.');
  }

  const bytes = await image.autoOrient().resize(AVATAR_PIXELS, AVATAR_PIXELS).webp().toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, ASSET_FINGERPRINT_LENGTH);
  return { source: file, output: `avatars/${hash}.webp`, bytes };
}
