import { sep } from 'node:path';

/**
 * Content type used for generated HTML and development responses.
 */
export const HTML = 'text/html; charset=utf-8';

/**
 * Content type used for client scripts.
 */
export const JAVASCRIPT = 'text/javascript; charset=utf-8';

/**
 * Extension-to-content-type mapping for published pages and their assets.
 */
export const MIME_TYPES = new Map(
  Object.entries({
    /**
     * Content type for AVIF assets served in preview.
     */
    '.avif': 'image/avif',

    /**
     * Content type for CSS assets served in preview.
     */
    '.css': 'text/css; charset=utf-8',

    /**
     * Content type for GIF assets served in preview.
     */
    '.gif': 'image/gif',

    /**
     * Content type for HTML assets served in preview.
     */
    '.html': HTML,

    /**
     * Content type for ICO assets served in preview.
     */
    '.ico': 'image/x-icon',

    /**
     * Content type for JPEG assets served in preview.
     */
    '.jpeg': 'image/jpeg',

    /**
     * Content type for JPG assets served in preview.
     */
    '.jpg': 'image/jpeg',

    /**
     * Content type for JS assets served in preview.
     */
    '.js': JAVASCRIPT,

    /**
     * Content type for JSON assets served in preview.
     */
    '.json': 'application/json; charset=utf-8',

    /**
     * Content type for MP4 assets served in preview.
     */
    '.mp4': 'video/mp4',

    /**
     * Content type for PNG assets served in preview.
     */
    '.png': 'image/png',

    /**
     * Content type for SVG assets served in preview.
     */
    '.svg': 'image/svg+xml',

    /**
     * Content type for VTT assets served in preview.
     */
    '.vtt': 'text/vtt; charset=utf-8',

    /**
     * Content type for WEBM assets served in preview.
     */
    '.webm': 'video/webm',

    /**
     * Content type for WEBP assets served in preview.
     */
    '.webp': 'image/webp',

    /**
     * Content type for WOFF2 assets served in preview.
     */
    '.woff2': 'font/woff2',

    /**
     * Serve local font license notices as readable text.
     */
    '.txt': 'text/plain; charset=utf-8',
  }),
);

/**
 * Published metadata describing how to mount the static site.
 */
export const SITE_MARKER = '.roadmark-site.json';

/**
 * The only hidden names a request may name: the development server answers them itself, at the top
 * of the mount (see server.ts). Every other dot-prefixed segment, such as the build marker or an
 * `.env` left in the site directory, is refused, and `locate` refuses these too, so preview never
 * serves a file under them.
 */
const DEVELOPMENT_ENDPOINTS: ReadonlySet<string> = new Set(['.roadmap-events', '.roadmap-dev.js']);

/**
 * Accepted deployment prefix syntax before checking dot segments.
 */
const BASE_PATH = /^(?:\/(?:[\w~.-]+\/)*)$/;

/**
 * Single byte range understood by the media streaming implementation.
 */
const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Captures the query string preserved across directory redirects.
 */
const QUERY_STRING = /\?(.*)/s;

/**
 * Characters disallowed in a decoded URL path component.
 */
const UNSAFE_SEGMENT = /[/\\\p{Cc}]/u;

/**
 * An absolute-form request target (RFC 9112 section 3.2.2): authority and the raw remainder.
 */
const ABSOLUTE_FORM = /^http:\/\/([^/?#]*)(.*)$/is;

/**
 * Default HTTP port, which clients may leave out of the `Host` header.
 */
const HTTP_PORT = 80;

/**
 * Path components and raw query of a request beneath the deployment prefix.
 */
export type FileRequest = {
  /**
   * Decoded relative path to look up on disk.
   */
  path: string;

  /**
   * URL pathname used to construct a canonical directory redirect.
   */
  pathname: string;

  /**
   * Optional query string preserved for shared views and search filters.
   */
  query: string | undefined;
};

/**
 * A raw request target split at its first `?`.
 */
export type Target = {
  /**
   * Raw, undecoded pathname.
   */
  pathname: string;

  /**
   * Raw query without its leading `?`, if present.
   */
  query: string | undefined;
};

/**
 * Inclusive byte offsets for a partial content response.
 */
export type Range = {
  /**
   * First byte included in the response.
   */
  start: number;

  /**
   * Last byte included in the response.
   */
  end: number;
};

/**
 * Accepts a URL path prefix like /roadmap and returns the slash-terminated deployment base.
 *
 * @param input The `--base` value or the base stored in a build marker.
 * @returns The slash-terminated base.
 */
export function normalizeBase(input: string): string {
  const path = input.endsWith('/') ? input : `${input}/`;
  if (!input || !BASE_PATH.test(path) || path.split('/').some(dotSegment)) {
    throw new Error('Use an absolute URL path for --base, such as / or /roadmap/.');
  }

  return path;
}

/**
 * Accepts only loopback authorities on the bound port, so a page on another origin that resolves to
 * 127.0.0.1 (DNS rebinding) cannot read the local site.
 *
 * @param host The request's `Host` header.
 * @param port The port the server is bound to.
 * @returns Whether the request names this server.
 */
export function allowedHost(host: string | undefined, port: number): boolean {
  const authority = host?.toLowerCase();
  const names = ['127.0.0.1', 'localhost', '[::1]'];
  return names.some(
    (name) => authority === `${name}:${port}` || (port === HTTP_PORT && authority === name),
  );
}

/**
 * Reads the request target exactly as the client sent it. The request names this server only if it
 * carries exactly one `Host` header for the bound loopback port and, for an absolute-form target,
 * the target's authority names the same server. The path is never normalized, so dot segments reach
 * {@link requestFile} and are rejected there.
 *
 * @param url The raw request target from the Node request line.
 * @param rawHeaders The Node request's header names and values, in received order.
 * @param port The port the server is bound to.
 * @returns The raw pathname and query, or undefined for a misdirected request.
 */
export function receivedTarget(
  url: string,
  rawHeaders: ReadonlyArray<string>,
  port: number,
): Target | undefined {
  const hosts = rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === 'host' ? [rawHeaders[index + 1]] : [],
  );
  const [host] = hosts;
  if (hosts.length !== 1 || !allowedHost(host, port)) {
    return undefined;
  }

  if (url.startsWith('/')) {
    return splitTarget(url);
  }

  const [, authority, remainder = ''] = ABSOLUTE_FORM.exec(url) ?? [];
  if (!allowedHost(authority, port)) {
    return undefined;
  }

  return splitTarget(remainder.startsWith('/') ? remainder : `/${remainder}`);
}

/**
 * Splits a raw request target into its pathname and query string.
 *
 * @param url The raw request target, never normalized.
 * @returns The pathname and the query without its `?`.
 */
export function splitTarget(url: string): Target {
  const [pathname = '', query] = url.split(QUERY_STRING);
  return { pathname, query };
}

/**
 * Parses the mount-relative request and rejects unsafe decoded path segments.
 *
 * @param pathname The raw request pathname.
 * @param query The raw query string, if any.
 * @param base The slash-terminated deployment base.
 * @returns The decoded relative file request, or undefined for an unsafe or foreign path.
 */
export function requestFile(
  pathname: string,
  query: string | undefined,
  base: string,
): FileRequest | undefined {
  if (!pathname.startsWith(base)) {
    return undefined;
  }

  const segments = pathname.slice(base.length).split('/');
  if (pathname.endsWith('/')) {
    segments.pop();
  }

  try {
    const decoded = segments.map(decodeURIComponent);
    if (decoded.some((part) => !part || dotSegment(part) || UNSAFE_SEGMENT.test(part))) {
      return undefined;
    }

    const [first] = decoded;
    const endpoint =
      decoded.length === 1 && first !== undefined && DEVELOPMENT_ENDPOINTS.has(first);
    if (!endpoint && decoded.some((part) => part.startsWith('.'))) {
      return undefined;
    }

    return { path: decoded.join(sep), pathname, query };
  } catch {
    return undefined;
  }
}

/**
 * Computes inclusive byte offsets for a byte range, including suffix requests.
 *
 * @param requested The `Range` header.
 * @param size The file size in bytes.
 * @returns The satisfiable range, or undefined.
 */
export function parseRange(requested: string, size: number): Range | undefined {
  const match = BYTE_RANGE.exec(requested);
  if (!match || !size) {
    return undefined;
  }

  const [, first, last] = match;
  if (!first) {
    const suffix = Number(last);
    return suffix ? { start: Math.max(size - suffix, 0), end: size - 1 } : undefined;
  }

  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  return start <= end ? { start, end } : undefined;
}

/**
 * Identifies a current- or parent-directory URL segment.
 */
function dotSegment(part: string): boolean {
  return part === '.' || part === '..';
}
