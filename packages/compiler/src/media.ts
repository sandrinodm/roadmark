import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path/posix';
import sharp from 'sharp';

import type { Asset, Diagnostic } from './model.ts';
import type { Position } from './source.ts';

import { addDiagnostic, compareNames, safeFile } from './source.ts';

/**
 * Image extensions rendered from local workspace assets.
 */
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

/**
 * Video extensions eligible for a native media player.
 */
const VIDEO_TYPES = new Set(['.mp4', '.webm']);

/**
 * Extension for WebVTT caption sidecars.
 */
const CAPTION_EXTENSION = '.vtt';

/**
 * Accepted language tag in a video caption filename.
 */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/**
 * Byte threshold for warning authors about an expensive animated image.
 */
const LARGE_GIF_BYTES = 5 * 1024 * 1024;

/**
 * Number of hexadecimal SHA-256 digits used in published asset filenames.
 */
export const ASSET_FINGERPRINT_LENGTH = 16;

/**
 * Presentation treatment selected for a supported file extension.
 */
type MediaKind = 'image' | 'gif' | 'video' | 'caption';

/**
 * An asset ready to render with optional caption tracks for video.
 */
export type Media = {
  /**
   * Source and published output paths for the fingerprinted media.
   */
  asset: Asset;

  /**
   * File category used to select a renderer and companion metadata.
   */
  kind: MediaKind;

  /**
   * Fingerprint and language of each discovered video caption file.
   */
  captions: Array<{ asset: Asset; language: string }>;

  /**
   * Intrinsic pixel dimensions reserved in the page before the image loads.
   */
  dimensions?: { width: number; height: number };
};

/**
 * Resolves and fingerprints allowlisted workspace assets and any video caption sidecars.
 */
export class MediaCatalog {
  /**
   * Assets keyed by output path so identical files are published once.
   */
  readonly assets = new Map<string, Asset>();

  /**
   * Cached media resolutions keyed by source path.
   */
  private readonly bySource = new Map<string, { media: Media; size: number }>();

  /**
   * Filesystem root used to resolve workspace-relative paths.
   */
  private readonly root: string;

  /**
   * Shared diagnostic sink for unreadable or unsupported media and accessibility warnings.
   */
  private readonly diagnostics: Array<Diagnostic>;

  constructor(root: string, diagnostics: Array<Diagnostic>) {
    this.root = root;
    this.diagnostics = diagnostics;
  }

  /**
   * Registers a supported local asset and reports issues at the referring Markdown node.
   *
   * @param file Workspace-relative path of the asset.
   * @param position Source position of the reference.
   * @param videoPlayer Whether to discover captions for standalone video playback.
   * @returns Renderable media information, or undefined if the file could not be loaded.
   */
  async resolve(
    file: string,
    position: Position,
    videoPlayer: boolean,
  ): Promise<Media | undefined> {
    const kind = mediaKind(file);
    if (kind === undefined) {
      addDiagnostic(this.diagnostics, position, {
        severity: 'error',
        rule: 'unsupported-local-link',
        message: `"${file}" is neither a roadmapped Markdown document nor a supported media file.`,
        fix: 'Link to a workspace Markdown document, image, MP4, WebM or VTT file.',
      });
      return undefined;
    }

    const entry = await this.load(file, kind, position);
    if (entry === undefined) {
      return undefined;
    }

    if (kind === 'gif' && entry.size > LARGE_GIF_BYTES) {
      addDiagnostic(this.diagnostics, position, {
        severity: 'warning',
        rule: 'large-gif',
        message: `The GIF "${file}" exceeds ${LARGE_GIF_BYTES} bytes.`,
        fix: 'Compress the GIF or convert this animation to MP4 or WebM.',
      });
    }

    if (!videoPlayer || kind !== 'video') {
      return entry.media;
    }

    const captions = await this.findCaptions(file, position);
    if (captions.length === 0) {
      addDiagnostic(this.diagnostics, position, {
        severity: 'warning',
        rule: 'missing-captions',
        message: `The video "${file}" has no WebVTT caption tracks.`,
        fix: 'Put a caption file beside the video, such as demo.en.vtt for demo.mp4.',
      });
    }

    return { ...entry.media, captions };
  }

  /**
   * Caches the fingerprint, size and available image dimensions for a regular file.
   */
  private async load(
    file: string,
    kind: MediaKind,
    position: Position,
  ): Promise<{ media: Media; size: number } | undefined> {
    const cached = this.bySource.get(file);
    if (cached) {
      return cached;
    }

    try {
      const path = await safeFile(this.root, file);
      const fingerprint = await hashFile(path);
      const extension = extname(file).toLowerCase();
      const output = `media/${fingerprint}${extension}`;
      const asset: Asset = { source: file, output };
      if (kind === 'gif') {
        asset.poster = `media/${fingerprint}-poster.png`;
      }

      const size = (await lstat(path)).size;
      const media: Media = { kind, asset, captions: [] };
      if (kind === 'image' || kind === 'gif') {
        const info = await sharp(path, { page: 0, pages: 1 }).metadata();
        media.dimensions = info.autoOrient;
      }

      const entry = { media, size };
      this.bySource.set(file, entry);
      this.assets.set(output, asset);
      return entry;
    } catch {
      addDiagnostic(this.diagnostics, position, {
        severity: 'error',
        rule: 'unreadable-asset',
        message: `Could not read the local asset "${file}".`,
        fix: 'Use the exact relative path to a regular workspace file with no symbolic links.',
      });
      return undefined;
    }
  }

  /**
   * Discovers matching language-tagged caption files next to a video.
   */
  private async findCaptions(file: string, position: Position): Promise<Media['captions']> {
    const folder = dirname(file);
    const stem = basename(file, extname(file));
    const prefix = `${stem}.`;
    const captions: Media['captions'] = [];
    const filenames = await readdir(join(this.root, folder)).catch(() => []);
    const sortedFilenames = filenames.toSorted(compareNames);
    const languages = new Set<string>();
    // Sequential on purpose: each caption is registered in order and claims its language.
    await sortedFilenames.reduce(async (previous, filename) => {
      await previous;
      if (!filename.startsWith(prefix) || !filename.endsWith(CAPTION_EXTENSION)) {
        return;
      }

      const written = filename.slice(prefix.length, -CAPTION_EXTENSION.length);
      const language = captionLanguage(written);
      if (language === undefined || languages.has(language)) {
        return;
      }

      const entry = await this.load(join(folder, filename), 'caption', position);
      if (entry !== undefined) {
        captions.push({ asset: entry.media.asset, language });
        languages.add(language);
      }
    }, Promise.resolve());

    return captions;
  }
}

/**
 * Extracts a valid language tag from a caption sidecar's filename.
 */
function captionLanguage(written: string): string | undefined {
  if (!LANGUAGE_PATTERN.test(written)) {
    return undefined;
  }

  try {
    return Intl.getCanonicalLocales(written)[0];
  } catch {
    return undefined;
  }
}

/**
 * Chooses a rendering treatment based on the file's extension.
 */
function mediaKind(file: string): MediaKind | undefined {
  const extension = extname(file).toLowerCase();
  if (extension === '.gif') {
    return 'gif';
  }

  if (IMAGE_TYPES.has(extension)) {
    return 'image';
  }

  if (VIDEO_TYPES.has(extension)) {
    return 'video';
  }

  if (extension === CAPTION_EXTENSION) {
    return 'caption';
  }

  return undefined;
}

/**
 * Streams source bytes into the digest used for a published asset path.
 */
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('Expected bytes from the media file stream.');
    }

    hash.update(chunk);
  }

  return hash.digest('hex').slice(0, ASSET_FINGERPRINT_LENGTH);
}
