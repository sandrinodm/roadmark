import { dirname, extname, join } from 'node:path/posix';

import type { Markdown } from './markdown.ts';
import type { Media } from './media.ts';
import type { MediaCatalog } from './media.ts';
import type { Diagnostic, Entity, Kind } from './model.ts';
import type { Position } from './source.ts';

import { headingId } from './markdown.ts';
import { addDiagnostic } from './source.ts';

/**
 * Recognizes an absolute URL scheme before classifying a Markdown destination.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Recognizes HTTP and HTTPS web links.
 */
const WEB_URL = /^https?:\/\//i;

/**
 * Recognizes email links in Markdown.
 */
const MAILTO = /^mailto:/i;

/**
 * Rejects controls and backslashes before interpreting an authored URL.
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\\]/u;

/**
 * Directory route for each document kind.
 */
const ROUTES: Record<Kind, string> = {
  /**
   * Route prefix for feature-set detail pages.
   */
  set: 'sets',

  /**
   * Route prefix for item detail pages.
   */
  item: 'items',

  /**
   * Route prefix for release detail pages.
   */
  release: 'releases',
};

/**
 * Published identity and anchor index needed to resolve a document link.
 */
type Doc = Pick<Entity, 'kind' | 'id' | 'source'> & Pick<Markdown, 'anchors'>;

/**
 * Decoded workspace file and the query and fragment to retain in its output URL.
 */
type Local = {
  /**
   * Decoded destination path relative to the workspace.
   */
  file: string;

  /**
   * Decoded fragment without its leading hash, before applying reserved-ID rewrites.
   */
  hash: string;

  /**
   * Query string, including its leading question mark when supplied.
   */
  search: string;
};

/**
 * Validated destination and optional local media metadata for the Markdown renderer.
 */
type Link = {
  /**
   * Resolved URL ready for use in a generated link.
   */
  href: string;

  /**
   * Media data present for local assets, with captions when used as standalone video.
   */
  media?: Media;
};

/**
 * Distinguishes ordinary links, image sources and links occupying an entire paragraph.
 */
type LinkUse = 'link' | 'image' | 'standalone';

/**
 * Resolves author URLs against recognized files, headings and the deployment base.
 */
export class LinkResolver {
  /**
   * Slash-terminated deployment prefix used by the generated URLs.
   */
  private readonly base: string;

  /**
   * Document lookup keyed by workspace source path.
   */
  private readonly docs: Map<string, Doc>;

  /**
   * Shared diagnostic sink for rejected links and media references.
   */
  private readonly diagnostics: Array<Diagnostic>;

  /**
   * Catalog used to register local assets for publication.
   */
  private readonly media: MediaCatalog;

  constructor(base: string, docs: Array<Doc>, media: MediaCatalog, diagnostics: Array<Diagnostic>) {
    this.base = base;
    this.docs = new Map(docs.map((doc) => [doc.source, doc]));
    this.media = media;
    this.diagnostics = diagnostics;
  }

  /**
   * Returns a validated destination or reports a rejected Markdown reference.
   *
   * @param url Authored Markdown destination.
   * @param use Determines which URLs and media types are allowed.
   * @param position Source location used to resolve relative paths and report failures.
   * @returns The rewritten destination, or undefined after a diagnostic.
   */
  async resolve(url: string, use: LinkUse, position: Position): Promise<Link | undefined> {
    if (URL_SCHEME.test(url)) {
      if (use !== 'image' && safeExternal(url)) {
        return { href: url };
      }

      this.unsafe(url, use, position);
      return undefined;
    }

    const local = localPath(position.file, url);
    if (local === undefined) {
      this.unsafe(url, use, position);
      return undefined;
    }

    const doc = this.docs.get(local.file);
    if (doc && use !== 'image') {
      return this.document(doc, local, position);
    }

    if (['.md', '.mdx'].includes(extname(local.file).toLowerCase())) {
      addDiagnostic(this.diagnostics, position, {
        severity: 'error',
        rule: 'broken-markdown-link',
        message: `"${url}" points to an unrecognized Markdown document.`,
        fix: 'Use the exact relative path to a recognized entity Markdown file.',
      });
      return undefined;
    }

    return this.asset(local, use, position);
  }

  /**
   * Rewrites a Markdown source path to its stable route and checks the destination anchor.
   */
  private document(doc: Doc, local: Local, position: Position): Link | undefined {
    if (local.hash && !doc.anchors.has(local.hash)) {
      addDiagnostic(this.diagnostics, position, {
        severity: 'error',
        rule: 'broken-anchor',
        message: `Heading "#${local.hash}" does not exist in ${doc.source}.`,
        fix: 'Use a link to an existing Markdown heading.',
      });
      return undefined;
    }

    const route = `${this.base}${ROUTES[doc.kind]}/${doc.id}/`;
    const hash = local.hash ? `#${encodeURIComponent(headingId(local.hash))}` : '';
    const samePage = doc.source === position.file && hash !== '' && local.search === '';
    return { href: samePage ? hash : route + local.search + hash };
  }

  /**
   * Resolves a file as publishable media using its source path and intended usage.
   */
  private async asset(local: Local, use: LinkUse, position: Position): Promise<Link | undefined> {
    const asset = await this.media.resolve(local.file, position, use === 'standalone');
    if (asset === undefined) {
      return undefined;
    }

    if (use === 'image' && asset.kind !== 'image' && asset.kind !== 'gif') {
      addDiagnostic(this.diagnostics, position, {
        severity: 'error',
        rule: 'invalid-image',
        message: `"${local.file}" is not an image.`,
        fix: 'Link to the file with a standard Markdown link, or use a supported image.',
      });
      return undefined;
    }

    const hash = local.hash ? `#${encodeURIComponent(local.hash)}` : '';
    return { href: this.base + asset.asset.output + local.search + hash, media: asset };
  }

  /**
   * Reports an authored destination that cannot be rendered safely.
   */
  private unsafe(url: string, use: LinkUse, position: Position): void {
    const shown = withoutCredentials(url);
    addDiagnostic(this.diagnostics, position, {
      severity: 'error',
      rule: 'unsafe-url',
      message: `The ${use === 'image' ? 'image URL' : 'link'} "${shown}" is not allowed.`,
      fix:
        shown === url
          ? 'Use a workspace-relative path, or an HTTP(S) or mailto URL for an external link.'
          : 'Remove the user name and password from the URL, and rotate the password if it was real.',
    });
  }
}

/**
 * Masks everything after the scheme up to the last `@`, so a diagnostic never repeats a password
 * that an author put in a URL, with or without the `//` (`https:user:pass@host` parses as userinfo
 * too). A mailto address has no password. Masking too much of an already rejected URL is harmless.
 */
function withoutCredentials(url: string): string {
  return MAILTO.test(url) ? url : url.replace(/^([a-z][a-z\d+.-]*:)?.*@/isu, '$1***@');
}

/**
 * Checks that an external destination uses an accepted scheme and URL form.
 */
function safeExternal(url: string): boolean {
  if (UNSAFE_CHARACTERS.test(url) || url !== url.trim()) {
    return false;
  }

  if (!WEB_URL.test(url) && !MAILTO.test(url)) {
    return false;
  }

  const parsed = URL.parse(url);
  return parsed !== null && parsed.username === '' && parsed.password === '';
}

/**
 * Resolves a link relative to its Markdown source while preserving query and fragment.
 */
function localPath(source: string, url: string): Local | undefined {
  const hashStart = url.indexOf('#');
  const fullPath = hashStart === -1 ? url : url.slice(0, hashStart);
  const queryStart = fullPath.indexOf('?');
  const rawFile = queryStart === -1 ? fullPath : fullPath.slice(0, queryStart);
  const search = queryStart === -1 ? '' : fullPath.slice(queryStart);
  try {
    const decoded = decodeURIComponent(rawFile);
    const hash = hashStart === -1 ? '' : decodeURIComponent(url.slice(hashStart + 1));
    if (UNSAFE_CHARACTERS.test(decoded + search + hash) || decoded.startsWith('/')) {
      return undefined;
    }

    const file = decoded === '' ? source : join(dirname(source), decoded);
    if (file.split('/').some((part) => part.startsWith('.'))) {
      return undefined;
    }

    return { file, hash, search };
  } catch {
    return undefined;
  }
}
