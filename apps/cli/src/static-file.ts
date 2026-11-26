import type { FileHandle } from 'node:fs/promises';

import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { parseRange } from './request.ts';
import { hasCode } from './run.ts';

/**
 * HTTP statuses of a static file response.
 */
const STATUS = {
  /**
   * Successful response containing the full representation.
   */
  ok: 200,

  /**
   * Successful response containing the requested byte range.
   */
  partial: 206,

  /**
   * Signals that the requested static resource is unavailable.
   */
  notFound: 404,

  /**
   * Response for an unsatisfiable byte range.
   */
  invalidRange: 416,
};

/**
 * A served path resolved inside the site, with its status at lookup time.
 */
export type Located = {
  /**
   * Canonical path beneath the served directory.
   */
  path: string;

  /**
   * Whether the entry is a directory, so the route needs a trailing slash or an index.
   */
  directory: boolean;

  /**
   * Whether the entry is a regular file; anything else (a FIFO, a socket) is never opened.
   */
  file: boolean;
};

/**
 * Resolves the requested file beneath the served directory. Missing paths, paths that resolve
 * outside it and hidden entries such as the build marker or `.env` (under any name, including
 * through a symbolic link) resolve to undefined.
 *
 * @param root The canonical served directory.
 * @param path The decoded relative request path.
 * @returns The canonical entry, or undefined when it must not be served.
 */
export async function locate(root: string, path: string): Promise<Located | undefined> {
  try {
    const resolved = await realpath(join(root, path));
    const remainder = relative(root, resolved);
    if (isAbsolute(remainder) || remainder === '..' || remainder.startsWith(`..${sep}`)) {
      return undefined;
    }

    // Hidden entries, the build marker among them, are never part of a generated site.
    if (remainder.split(sep).some((part) => part.startsWith('.'))) {
      return undefined;
    }

    const info = await stat(resolved);
    return { path: resolved, directory: info.isDirectory(), file: info.isFile() };
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Opens a regular file and reads its size from the same handle, so the headers describe exactly the
 * bytes the body will stream even if the path is replaced meanwhile.
 *
 * @param path The canonical file path.
 * @returns The open handle and its size, or undefined for anything but a regular file.
 */
export async function openFile(
  path: string,
): Promise<{ handle: FileHandle; size: number } | undefined> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.isFile()) {
      return { handle, size: info.size };
    }
  } catch (error) {
    await handle.close();
    throw error;
  }

  await handle.close();
  return undefined;
}

/**
 * Streams an open file or a single byte range of it with matching headers. The response owns the
 * handle: the stream closes it when it ends or when the adapter discards the body (HEAD, closed
 * connection).
 *
 * @param file The open handle and its size.
 * @param type The response content type.
 * @param requested The `Range` header, if any.
 * @returns The 200, 206 or 416 response.
 */
export function fileResponse(
  file: { handle: FileHandle; size: number },
  type: string,
  requested: string | undefined,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const { handle, size } = file;
  const accept = { 'Accept-Ranges': 'bytes' };
  const range = requested === undefined ? undefined : parseRange(requested, size);
  if (requested !== undefined && !range) {
    return Effect.promise(() => handle.close()).pipe(
      Effect.as(
        HttpServerResponse.text('Range not satisfiable.', {
          status: STATUS.invalidRange,
          contentType: 'text/plain; charset=utf-8',
          headers: { ...accept, 'Content-Range': `bytes */${size}` },
        }),
      ),
    );
  }

  const body = range
    ? handle.createReadStream({ start: range.start, end: range.end })
    : handle.createReadStream();
  const response = range
    ? HttpServerResponse.raw(body, {
        status: STATUS.partial,
        contentType: type,
        contentLength: range.end - range.start + 1,
        headers: { ...accept, 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
      })
    : HttpServerResponse.raw(body, {
        status: STATUS.ok,
        contentType: type,
        contentLength: size,
        headers: accept,
      });
  return Effect.succeed(response);
}
