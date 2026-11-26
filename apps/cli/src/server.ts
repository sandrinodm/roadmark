import type { NodeServices } from '@roadmark/compiler/platform';
import type * as Etag from 'effect/http/Etag';
import type { HttpPlatform } from 'effect/http/HttpPlatform';

import { layerHttpServices, makeHttpServer, toIncomingMessage } from '@roadmark/compiler/platform';
import { Duration, Effect, Exit, Schema, Scope, Stream } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

import type { FileRequest } from './request.ts';

import { decodeJsonFile } from './json-file.ts';
import {
  HTML,
  JAVASCRIPT,
  MIME_TYPES,
  normalizeBase,
  receivedTarget,
  requestFile,
  SITE_MARKER,
} from './request.ts';
import { errorText, runPromise } from './run.ts';
import { fileResponse, locate, openFile } from './static-file.ts';

export { normalizeBase } from './request.ts';

/**
 * Loopback interface used by both development and preview.
 */
const HOST = '127.0.0.1';

/**
 * Time open responses (such as a development event stream) get to finish when the server closes.
 */
const SHUTDOWN_GRACE = Duration.millis(200);

/**
 * HTTP statuses emitted by the static and development servers.
 */
const STATUS = {
  /**
   * Redirects the reader to the canonical directory route with the query intact.
   */
  redirect: 308,

  /**
   * Signals that the requested static resource is unavailable.
   */
  notFound: 404,

  /**
   * Response for methods other than GET and HEAD.
   */
  methodNotAllowed: 405,

  /**
   * Response for a `Host` header that does not name this loopback server.
   */
  misdirected: 421,

  /**
   * Server failure after accepting a request.
   */
  error: 500,

  /**
   * Temporary response before the first valid development build.
   */
  unavailable: 503,
};

/**
 * Reads the deployment base from the build marker, naming the file if it is not valid JSON.
 */
const decodePreviewMarker = decodeJsonFile(
  Schema.Struct({
    /**
     * Slash-terminated deployment prefix the site was built for.
     */
    base: Schema.String,
  }),
);

/**
 * Hooks that add live diagnostics to the ordinary static server.
 */
export type Development = {
  /**
   * Server-sent event frames for one browser, starting with the current state.
   */
  events: Stream.Stream<string>;

  /**
   * Inserts the live-reload client into a generated HTML response.
   */
  decorate: (html: string) => Effect.Effect<string>;

  /**
   * Provides a waiting page before the first valid site exists.
   */
  fallback: Effect.Effect<string | undefined>;

  /**
   * Browser code served at the development client route.
   */
  script: string;
};

/**
 * Directory, mount point and optional live-preview hooks for one listener.
 */
export type ServeOptions = {
  /**
   * Root of the generated site on disk.
   */
  directory: string;

  /**
   * Slash-terminated deployment prefix used by the generated URLs.
   */
  base: string;

  /**
   * Loopback port to bind. Zero lets the operating system choose.
   */
  port: number;

  /**
   * Additional routes and response decoration available in watch mode.
   */
  development?: Development;
};

/**
 * A bound loopback server with its actual port and a promise for graceful termination.
 */
export type RunningServer = {
  /**
   * Fully qualified address used to reach the resource.
   */
  url: string;

  /**
   * Terminates the listener and its open connections.
   */
  close: () => Promise<void>;
};

/**
 * A server that could not start, with the reason shown to the author.
 */
export class ServerError extends Schema.TaggedError<
  ServerError,
  {
    /**
     * Distinguishes server errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('ServerError', {
  /**
   * Explains why the server did not start.
   */
  message: Schema.String,
}) {}

/**
 * Resolves a build directory and its deployment base, then serves it until the scope closes.
 *
 * @param directory The generated site.
 * @param port The loopback port; zero picks a free one.
 * @returns The site URL, valid while the scope stays open.
 */
export const previewSite = Effect.fn('previewSite')(function* (directory: string, port: number) {
  const canonicalDirectory = yield* attempt(() => realpath(directory));
  yield* attempt(() => stat(join(canonicalDirectory, 'index.html')));
  const markerFile = join(canonicalDirectory, SITE_MARKER);
  const contents = yield* attempt(() => readFile(markerFile, 'utf8'));
  const marker = yield* decodePreviewMarker(markerFile, contents).pipe(
    Effect.catchTags({
      JsonFileError: (error) => Effect.fail(new ServerError({ message: error.message })),
      SchemaError: () =>
        Effect.fail(new ServerError({ message: `Expected a roadmap build in ${directory}.` })),
    }),
  );
  const base = yield* attempt(async () => normalizeBase(marker.base));
  return yield* serveSite({ directory: canonicalDirectory, base, port });
});

/**
 * Promise facade over {@link previewSite}.
 *
 * @param directory The generated site.
 * @param port The loopback port; zero picks a free one.
 * @returns The running server and its close function.
 */
export function preview(directory: string, port: number): Promise<RunningServer> {
  return openServer(previewSite(directory, port));
}

/**
 * Serves generated files beneath the base on loopback until the scope closes.
 *
 * @param options The directory, base, port and optional development hooks.
 * @returns The site URL on the bound port.
 */
export const serveSite = Effect.fn('serveSite')(function* (options: ServeOptions) {
  const listener = createServer();
  const server = yield* makeHttpServer(() => listener, {
    port: options.port,
    host: HOST,
    gracefulShutdownTimeout: SHUTDOWN_GRACE,
  }).pipe(Effect.mapError((error) => new ServerError({ message: errorText(error.cause) })));
  // Finalizers run in reverse: this one runs after `serve` has given open responses their grace
  // period and before `make` waits for `close()`. Node does not time out a request whose headers
  // are still arriving once the server is closing, so such a client would otherwise hold it open.
  yield* Effect.addFinalizer(() => Effect.sync(() => listener.closeAllConnections()));
  const { address } = server;
  if (address._tag === 'UnixPathAddress') {
    return yield* new ServerError({ message: 'Could not read the HTTP server address.' });
  }

  yield* server.serve(respond(options, address.port));
  return `http://${HOST}:${address.port}${options.base}`;
});

/**
 * Services a scoped server effect needs besides its scope: Node platform services and the HTTP file
 * platform.
 */
export type ServerServices = Scope.Scope | HttpPlatform | NodeServices;

/**
 * Supplies the Node HTTP platform to a server program at its entry point (CLI command or Promise
 * facade), keeping `node:http` out of commands that never serve.
 *
 * @param effect The server program.
 * @returns The program with only its scope left to provide.
 */
export function provideServerServices<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, HttpPlatform | NodeServices | Etag.Generator>> {
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Entry point for server commands.
  return effect.pipe(Effect.provide(layerHttpServices));
}

/**
 * Starts a server in its own scope, which stays open until the caller closes the server.
 *
 * @param start The effect that binds the server and returns its URL.
 * @returns The running server and its close function.
 */
export async function openServer<E>(
  start: Effect.Effect<string, E, ServerServices>,
): Promise<RunningServer> {
  const scope = Scope.makeUnsafe();
  /**
   * Closes the server scope: stops listening and ends open connections.
   */
  const close = (): Promise<void> => runPromise(Scope.close(scope, Exit.void));
  const bound = provideServerServices(start.pipe(Scope.provide(scope)));
  const url = await runPromise(bound).catch(async (error: unknown) => {
    await close();
    throw error;
  });
  return { url, close };
}

/**
 * Handles one request: authority check on the request exactly as received, then development
 * endpoints or a static file.
 */
function respond(options: ServeOptions, port: number) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // The adapter replaces Host with an absolute-form authority and normalizes that path, so the
    // checks and routing below read the Node request instead.
    const original = toIncomingMessage(request);
    const target = receivedTarget(original.url ?? '', original.rawHeaders, port);
    if (!target) {
      return text(STATUS.misdirected, 'Misdirected request.');
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(STATUS.methodNotAllowed, 'Method not allowed.', { Allow: 'GET, HEAD' });
    }

    const { pathname, query } = target;
    const base = options.base;
    if (pathname === base.slice(0, -1) || (pathname === '/' && base !== '/')) {
      return redirect(base, query);
    }

    const file = requestFile(pathname, query, base);
    const development = options.development;
    if (!file) {
      return notFound();
    }

    if (development && file.path === '.roadmap-events' && request.method === 'GET') {
      return HttpServerResponse.stream(Stream.encodeText(development.events), {
        contentType: 'text/event-stream; charset=utf-8',
        headers: { 'Cache-Control': 'no-store', Connection: 'keep-alive' },
      });
    }

    if (development && file.path === '.roadmap-dev.js') {
      return HttpServerResponse.text(development.script, { contentType: JAVASCRIPT });
    }

    return yield* respondWithFile(options, file, request.headers['range']);
  }).pipe(
    Effect.orElseSucceed(() => text(STATUS.error, 'Unable to read the generated site.')),
    Effect.map(HttpServerResponse.setHeader('X-Content-Type-Options', 'nosniff')),
  );
}

/**
 * Checks the route and sends the canonical file, index or redirect.
 */
const respondWithFile = Effect.fnUntraced(function* (
  options: ServeOptions,
  file: FileRequest,
  range: string | undefined,
) {
  const development = options.development;
  const candidate = yield* attempt(() => locate(options.directory, file.path));
  if (!candidate) {
    const fallback = development ? yield* development.fallback : undefined;
    return fallback && !extname(file.path)
      ? HttpServerResponse.text(fallback, { status: STATUS.unavailable, contentType: HTML })
      : notFound();
  }

  if (candidate.directory && !file.pathname.endsWith('/')) {
    return redirect(`${file.pathname}/`, file.query);
  }

  const found = candidate.directory
    ? yield* attempt(() => locate(options.directory, join(file.path, 'index.html')))
    : candidate;
  if (!found?.file) {
    return notFound();
  }

  const extension = extname(found.path).toLowerCase();
  const type = MIME_TYPES.get(extension) ?? 'application/octet-stream';
  if (development && extension === '.html') {
    const html = yield* attempt(() => readFile(found.path, 'utf8'));
    return HttpServerResponse.text(yield* development.decorate(html), { contentType: type });
  }

  // The response takes ownership of the open handle, so opening and handing it over are one step.
  return yield* attempt(() => openFile(found.path)).pipe(
    Effect.flatMap((opened) =>
      opened ? fileResponse(opened, type, range) : Effect.succeed(notFound()),
    ),
    Effect.uninterruptible,
  );
});

/**
 * Redirects the reader to the canonical directory route with the query intact.
 */
function redirect(
  target: string,
  query: string | undefined,
): HttpServerResponse.HttpServerResponse {
  const location = query === undefined ? target : `${target}?${query}`;
  return HttpServerResponse.empty({ status: STATUS.redirect, headers: { Location: location } });
}

/**
 * Signals that the requested static resource is unavailable.
 */
function notFound(): HttpServerResponse.HttpServerResponse {
  return text(STATUS.notFound, 'Page not found.');
}

/**
 * Builds a plain-text response with the selected status and extra headers.
 */
function text(
  status: number,
  value: string,
  headers: Record<string, string> = {},
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.text(value, {
    status,
    contentType: 'text/plain; charset=utf-8',
    headers,
  });
}

/**
 * Runs one filesystem step, keeping the underlying error's message.
 */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, ServerError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ServerError({ message: errorText(cause) }),
  });
}
