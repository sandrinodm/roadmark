import type { Diagnostic } from '@roadmark/compiler/model';
import type { FSWatcher } from 'chokidar';

import { watch } from 'chokidar';
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Option,
  Queue,
  Schema,
  Stream,
} from 'effect';
import { SubscriptionRef } from 'effect';
import { once } from 'node:events';
import { realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { RunningServer } from './server.ts';

import { diagnosticText, hasFailures } from './diagnostics.ts';
import { publishSite } from './publish.ts';
import { errorText } from './run.ts';
import { openServer, serveSite } from './server.ts';

/**
 * Quiet period that combines an editor's file events into one rebuild.
 */
const DEBOUNCE = Duration.millis(80);

/**
 * Infrastructure directories excluded from the workspace watcher.
 */
const IGNORED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules']);

/**
 * Initial response while the workspace has yet to produce a valid build.
 */
const WAITING_PAGE = [
  '<!doctype html>',
  '<html lang="en"><meta charset="utf-8">',
  '<title>Roadmap development</title><body>',
  '<h1>Waiting for a valid roadmap build</h1>',
  '</body></html>',
].join('\n');

/**
 * Development-only browser code that receives diagnostics and reloads after a publish.
 */
const CLIENT_SCRIPT = `
const script = document.currentScript;
const revision = Number(script.dataset.revision);
const events = new EventSource(new URL('.roadmap-events', script.src));
let panel;
events.onmessage = (event) => {
  const state = JSON.parse(event.data);
  if (state.revision !== revision) {
    location.reload();
    return;
  }
  panel?.remove();
  if (state.diagnostics.length === 0) return;
  panel = document.createElement('aside');
  panel.setAttribute('role', 'status');
  panel.style.cssText =
    'background:#fff8e1;color:#312600;border:1px solid #946700;padding:1rem;margin:1rem;';
  const title = document.createElement('strong');
  title.textContent = 'Roadmap diagnostics';
  panel.append(title);
  for (const diagnostic of state.diagnostics) {
    const entry = document.createElement('pre');
    entry.style.whiteSpace = 'pre-wrap';
    entry.textContent = diagnostic;
    panel.append(entry);
  }
  document.body.prepend(panel);
};
`;

/**
 * Inputs for watching and serving a single workspace.
 */
export type DevOptions = {
  /**
   * Filesystem root used to resolve workspace-relative paths.
   */
  root: string;

  /**
   * Slash-terminated deployment prefix used by the generated URLs.
   */
  base: string;

  /**
   * Loopback port to bind. Zero lets the operating system choose.
   */
  port: number;

  /**
   * Treats warnings as failures when deciding whether to publish.
   */
  strict: boolean;

  /**
   * Emits the current workspace findings with their source positions.
   */
  report: (diagnostics: ReadonlyArray<Diagnostic>) => void;
};

/**
 * Revision and formatted findings sent to connected development clients.
 */
const LiveState = Schema.Struct({
  /**
   * Increases after each successful publish so tabs can detect newer content.
   */
  revision: Schema.Finite,

  /**
   * Collected findings, in reporting order.
   */
  diagnostics: Schema.Array(Schema.String),
});

/**
 * Revision and formatted findings sent to connected development clients.
 */
type LiveState = typeof LiveState.Type;

/**
 * Serializes one state as the JSON payload of a server-sent event.
 */
const encodeLiveState = Schema.encodeEffect(Schema.fromJsonString(LiveState));

/**
 * Watcher errors kept while the build loop is busy; older ones are dropped beyond this.
 */
const PENDING_FAILURES = 16;

/**
 * Watcher notifications waiting for the build loop, both bounded so a flood of file events during a
 * long build cannot grow memory.
 */
export type WatchQueues = {
  /**
   * Pending change signal. A rebuild reads the whole workspace, so one pending change stands for
   * any number of events and later ones are dropped.
   */
  readonly changes: Queue.Queue<void>;

  /**
   * Watcher errors not yet reported, newest kept.
   */
  readonly failures: Queue.Queue<unknown>;
};

/**
 * Creates the bounded queues that carry watcher notifications to the build loop.
 */
export const watchQueues: Effect.Effect<WatchQueues> = Effect.all({
  changes: Queue.dropping<void>(1),
  failures: Queue.sliding<unknown>(PENDING_FAILURES),
});

/**
 * A development server that could not start, with the reason shown to the author.
 */
export class DevError extends Schema.TaggedError<
  DevError,
  {
    /**
     * Distinguishes development errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('DevError', {
  /**
   * Explains why the development server did not start.
   */
  message: Schema.String,
}) {}

/**
 * Watches author files and serves the latest usable build with live diagnostics and reloads, until
 * the scope closes. Closing ends event streams first, then the server, the watcher (after any
 * rebuild in flight) and finally the temporary site.
 *
 * @param options The workspace, base, port, strictness and diagnostic reporter.
 * @returns The site URL on the bound port.
 */
export const devServer = Effect.fn('devServer')(function* (options: DevOptions) {
  const root = yield* attempt(() => realpath(options.root));
  if (!(yield* attempt(() => stat(root))).isDirectory()) {
    return yield* new DevError({ message: `Expected a workspace directory at ${root}.` });
  }

  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'roadmap-dev-' }).pipe(
    Effect.flatMap((path) => attempt(() => realpath(path))),
    Effect.mapError((error) => new DevError({ message: error.message })),
  );
  const directory = join(temporary, 'site');
  const state = yield* SubscriptionRef.make<LiveState>({ revision: 0, diagnostics: [] });
  const stop = yield* Deferred.make<void>();

  /**
   * Records new findings, bumping the revision when the site was republished.
   */
  const update = (diagnostics: ReadonlyArray<Diagnostic>, published: boolean) =>
    SubscriptionRef.update(state, (current) => ({
      revision: current.revision + (published ? 1 : 0),
      diagnostics: diagnostics.map(diagnosticText),
    })).pipe(Effect.andThen(Effect.sync(() => options.report(diagnostics))));

  /**
   * Publishes the latest workspace revision and broadcasts its validation result. Filesystem
   * failures become a visible diagnostic instead of stopping the loop.
   */
  const rebuild = publishSite(root, directory, options.base, options.strict).pipe(
    Effect.flatMap((model) =>
      update(model.diagnostics, !hasFailures(model.diagnostics, options.strict)),
    ),
    // Any failure, including an unexpected throw while compiling, is shown and the loop keeps
    // watching; only interruption ends it.
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (cause) => update([ioDiagnostic(failureMessage(cause))], false),
    ),
    Effect.uninterruptible,
  );

  const queues = yield* watchWorkspace(root);
  yield* startBuilds(
    Stream.merge(
      Stream.fromQueue(queues.changes),
      Stream.fromQueue(queues.failures).pipe(
        Stream.mapEffect((cause) => update([ioDiagnostic(errorText(cause))], false)),
        Stream.drain,
      ),
    ),
    rebuild,
  );

  const url = yield* serveSite({
    directory,
    base: options.base,
    port: options.port,
    development: {
      script: CLIENT_SCRIPT,
      events: SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((current) => Effect.orDie(encodeLiveState(current))),
        Stream.map((json) => `data: ${json}\n\n`),
        Stream.interruptWhen(Deferred.await(stop)),
      ),
      decorate: (html) =>
        SubscriptionRef.get(state).pipe(
          Effect.map(({ revision }) => inject(html, options.base, revision)),
        ),
      fallback: SubscriptionRef.get(state).pipe(
        Effect.map(({ revision }) =>
          revision === 0 ? inject(WAITING_PAGE, options.base, revision) : undefined,
        ),
      ),
    },
  }).pipe(Effect.mapError((error) => new DevError({ message: error.message })));
  // Registered last so it runs first: end event streams before the server waits for connections.
  yield* Effect.addFinalizer(() => Deferred.succeed(stop, undefined));
  return url;
});

/**
 * Promise facade over {@link devServer}; `close` shuts it down in the documented order.
 *
 * @param options The workspace, base, port, strictness and diagnostic reporter.
 * @returns The running server and its close function.
 */
export function dev(options: DevOptions): Promise<RunningServer> {
  return openServer(devServer(options));
}

/**
 * Inserts the live-reload client before the last `</body>` of a generated page.
 */
function inject(html: string, base: string, revision: number): string {
  const script = `<script src="${base}.roadmap-dev.js" data-revision="${revision}"></script>`;
  const end = html.lastIndexOf('</body>');
  return end >= 0 ? html.slice(0, end) + script + html.slice(end) : html + script;
}

/**
 * Runs the first build as soon as it is called, then one rebuild per quiet period of `changes` for
 * the rest of the scope. Changes buffered during a build fold into a single follow-up build.
 *
 * @param changes Workspace change notifications, buffered by the caller from before the first
 *   build.
 * @param rebuild Publishes the workspace once, reporting its own problems.
 * @returns An effect that completes after the first build, leaving the rebuild loop running.
 */
export const startBuilds = Effect.fnUntraced(function* <E, R>(
  changes: Stream.Stream<unknown, E, R>,
  rebuild: Effect.Effect<void, E, R>,
) {
  yield* rebuild;
  yield* changes.pipe(
    Stream.debounce(DEBOUNCE),
    Stream.mapEffect(() => rebuild),
    Stream.runDrain,
    Effect.forkScoped,
  );
});

/**
 * Watches the workspace with chokidar until the scope closes, signalling changes and queueing
 * watcher errors from the moment the initial scan completes.
 */
function watchWorkspace(root: string) {
  return Effect.gen(function* () {
    const queues = yield* watchQueues;
    const watcher = yield* Effect.acquireRelease(openWatcher(root), (opened) =>
      Effect.promise(() => opened.close()),
    );
    watcher.on('all', () => Queue.offerUnsafe(queues.changes, undefined));
    watcher.on('error', (cause: unknown) => Queue.offerUnsafe(queues.failures, cause));
    return queues;
  });
}

/**
 * Starts chokidar on the workspace and waits for its initial scan, closing it if the scan fails.
 */
function openWatcher(root: string): Effect.Effect<FSWatcher, DevError> {
  return attempt(async () => {
    const watcher = watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path) =>
        relative(root, path)
          .split(sep)
          .some((component) => IGNORED_DIRECTORIES.has(component)),
    });
    try {
      await once(watcher, 'ready');
    } catch (error) {
      await watcher.close();
      throw error;
    }

    return watcher;
  });
}

/**
 * Selects the message of a typed failure, or of the defect when there is none.
 */
function failureMessage(cause: Cause.Cause<{ readonly message: string }>): string {
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => errorText(Cause.squash(cause)),
    onSome: (error) => error.message,
  });
}

/**
 * Builds a source-located message for a development filesystem failure.
 */
function ioDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    rule: 'dev-io',
    file: 'roadmap.yaml',
    line: 1,
    column: 1,
    message,
    fix: 'Check filesystem permissions and open files, then save a source document to retry.',
  };
}

/**
 * Runs one filesystem step, keeping the underlying error's message.
 */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, DevError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new DevError({ message: errorText(cause) }),
  });
}
