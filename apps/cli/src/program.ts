import type { Diagnostic } from '@roadmark/compiler/model';

import { nodeServices } from '@roadmark/compiler/platform';
import { Console, Context, Effect, Layer, Match, Schema } from 'effect';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Invocation } from './arguments.ts';
import type { CliUsageError } from './errors.ts';
import type { Draft } from './scaffold.ts';
import type { ServerServices } from './server.ts';

import { parseInvocation } from './arguments.ts';
import { diagnosticText, hasFailures } from './diagnostics.ts';
import { CliOperationError, perform } from './errors.ts';
import { decodeJsonFile } from './json-file.ts';
import { GUIDE, HELP, manual } from './manual.ts';
import { scaffoldDocument, scaffoldWorkspace } from './scaffold.ts';

export { CliOperationError, CliUsageError } from './errors.ts';

/**
 * Serializes CLI diagnostics with the indentation used by `lint --json`.
 */
const encodeDiagnostics = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

/**
 * Reads the version from the package manifest, naming the file if it is not valid JSON.
 */
const decodePackageManifest = decodeJsonFile(
  Schema.Struct({
    /**
     * Installed package version printed by `--version`.
     */
    version: Schema.String,
  }),
);

/**
 * Supplies the default workspace root without changing the process working directory.
 */
export class CliWorkspace extends Context.Service<
  CliWorkspace,
  {
    /**
     * Absolute directory to use when the caller leaves out `--root`.
     */
    readonly root: string;
  }
>()('roadmap/CliWorkspace') {
  /**
   * Reads the current working directory when the CLI starts.
   */
  static readonly layer: Layer.Layer<CliWorkspace> = Layer.effect(
    CliWorkspace,
    Effect.sync(() => CliWorkspace.of({ root: process.cwd() })),
  );

  /**
   * Uses an explicit workspace root, resolving a relative path against the working directory.
   *
   * @param root The workspace directory used when `--root` is absent.
   * @returns The layer providing that directory to commands.
   */
  static at(root: string): Layer.Layer<CliWorkspace> {
    return Layer.succeed(CliWorkspace, CliWorkspace.of({ root: resolve(root) }));
  }
}

/**
 * A command's result: 0 for success and 1 for lint or build diagnostics. Process exit and signals
 * belong to the entry point.
 */
type Command = Effect.Effect<number, CliUsageError | CliOperationError>;

/**
 * Runs one invocation, returning its exit code or a typed usage or operation failure.
 *
 * @param args The command-line arguments after the executable name.
 * @returns An effect that exits with 0 for success and 1 for lint or build diagnostics.
 */
export const runCli = Effect.fn('runCli')(function* (
  args: ReadonlyArray<string>,
): Effect.fn.Return<number, CliUsageError | CliOperationError, CliWorkspace> {
  const { root } = yield* CliWorkspace;
  const invocation = yield* parseInvocation(args, root);
  const command = execute(invocation);
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- runCli is the CLI's composition root.
  return yield* Effect.provide(command, nodeServices);
});

/**
 * Runs a validated invocation. Filesystem work starts only here.
 */
function execute(invocation: Invocation) {
  return Match.valueTags(invocation, {
    Version: () => readVersion().pipe(Effect.flatMap(Console.log), Effect.as(0)),
    Help: ({ json }) =>
      (json
        ? readVersion().pipe(
            Effect.flatMap((version) => Console.log(JSON.stringify(manual(version), null, 2))),
          )
        : Console.log(HELP)
      ).pipe(Effect.as(0)),
    Guide: () => Console.log(GUIDE).pipe(Effect.as(0)),
    Init: ({ target, template }) =>
      scaffoldWorkspace(target, template).pipe(
        operationError('initialize workspace'),
        Effect.uninterruptible,
        Effect.andThen(
          Console.log(
            `Initialized ${target} from the ${template} template. Next: roadmark dev --root ${target}`,
          ),
        ),
        Effect.as(0),
      ),
    New: ({ root, draft }) => create(root, draft),
    Schema: ({ document }) => Console.log(document).pipe(Effect.as(0)),
    Lint: ({ root, strict, json }) => lint(root, strict, json),
    Build: ({ root, output, base, strict }) => build(root, output, base, strict),
    Dev: ({ root, base, port, strict }) => develop(root, base, port, strict),
    Preview: ({ directory, port }) =>
      serveUntilInterrupted(
        'start preview server',
        perform('start preview server', () => import('./server.ts')).pipe(
          Effect.flatMap(({ previewSite }) => previewSite(directory, port)),
        ),
      ),
  });
}

/**
 * Writes one scaffolded document under the workspace lock, never interrupted half way.
 */
function create(root: string, draft: Draft) {
  return scaffoldDocument(root, draft).pipe(
    operationError('create document'),
    Effect.uninterruptible,
    Effect.flatMap((created) => Console.log(`Created ${created}`)),
    Effect.as(0),
  );
}

/**
 * Reports source diagnostics, reserving stdout for the diagnostic array in JSON mode.
 */
const lint = Effect.fn('lint')(function* (root: string, strict: boolean, json: boolean) {
  const result = yield* compileRoot(root);
  const diagnostics = result.diagnostics;
  if (json) {
    const output = yield* encodeDiagnostics(diagnostics).pipe(
      operationError('serialize diagnostics'),
    );
    yield* Console.log(output);
  } else if (diagnostics.length > 0) {
    yield* report(diagnostics);
  } else {
    yield* Console.log('Roadmap is valid.');
  }

  return hasFailures(diagnostics, strict) ? 1 : 0;
});

/**
 * Resolves the authoring directory before compiling, failing if the path is missing or a file.
 */
const compileRoot = Effect.fnUntraced(function* (root: string) {
  const operation = 'lint workspace';
  if (!(yield* perform(operation, () => stat(root))).isDirectory()) {
    return yield* new CliOperationError({
      operation,
      message: `Expected a workspace directory at ${root}.`,
    });
  }

  const canonical = yield* perform(operation, () => realpath(root));
  const { compileWorkspace } = yield* perform(
    operation,
    () => import('@roadmark/compiler/compile'),
  );
  return yield* compileWorkspace(canonical, '/').pipe(operationError(operation));
});

/**
 * Publishes a site and waits for the output transaction to finish even during interruption.
 */
const build = Effect.fn('build')(function* (
  root: string,
  output: string,
  base: string,
  strict: boolean,
) {
  const { publishSite } = yield* perform('publish site', () => import('./publish.ts'));
  const result = yield* publishSite(root, output, base, strict).pipe(
    operationError('publish site'),
    Effect.uninterruptible,
  );
  yield* report(result.diagnostics);
  if (hasFailures(result.diagnostics, strict)) {
    return 1;
  }

  yield* Console.log(`Built ${output}`);
  return 0;
});

/**
 * Reads the installed package version, failing if the manifest has no string version.
 */
function readVersion(): Effect.Effect<string, CliOperationError> {
  const operation = 'read package version';
  const manifest = fileURLToPath(new URL('../package.json', import.meta.url));
  return perform(operation, () => readFile(manifest, 'utf8')).pipe(
    Effect.flatMap((text) =>
      decodePackageManifest(manifest, text).pipe(
        Effect.catchTags({
          JsonFileError: (error) =>
            Effect.fail(new CliOperationError({ operation, message: error.message })),
          SchemaError: () =>
            Effect.fail(
              new CliOperationError({
                operation,
                message: 'Could not determine the package version.',
              }),
            ),
        }),
      ),
    ),
    Effect.map((metadata) => metadata.version),
  );
}

/**
 * Sends diagnostics to stderr in source order so structured stdout remains parseable.
 */
function report(diagnostics: ReadonlyArray<Diagnostic>): Effect.Effect<void> {
  return Effect.forEach(diagnostics, (diagnostic) => Console.error(diagnosticText(diagnostic)), {
    discard: true,
  });
}

/**
 * Starts live development and routes watcher diagnostics to the invocation's console.
 */
function develop(root: string, base: string, port: number, strict: boolean): Command {
  return Effect.gen(function* () {
    const output = yield* Console.Console;
    const { devServer } = yield* perform('start development server', () => import('./dev.ts'));
    const start = devServer({
      root,
      base,
      port,
      strict,
      report: (diagnostics) => {
        for (const diagnostic of diagnostics) {
          output.error(diagnosticText(diagnostic));
        }
      },
    });
    return yield* serveUntilInterrupted('start development server', start);
  });
}

/**
 * Keeps a server alive until the runtime interrupts the command; its scope then closes the server
 * and everything it owns before the process exits.
 */
function serveUntilInterrupted<E extends { readonly message: string }>(
  operation: string,
  start: Effect.Effect<string, E, ServerServices>,
): Command {
  const serving = Effect.scoped(
    start.pipe(
      operationError(operation),
      Effect.flatMap((url) => Console.log(`Roadmap available at ${url}`)),
      Effect.andThen(Effect.never),
    ),
  );
  return perform(operation, () => import('./server.ts')).pipe(
    Effect.flatMap(({ provideServerServices }) => provideServerServices(serving)),
  );
}

/**
 * Attributes a failure to the command step that produced it, keeping its message.
 */
function operationError(operation: string) {
  return <A, E extends { readonly message: string }, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, CliOperationError, R> =>
    Effect.mapError(
      effect,
      (error) => new CliOperationError({ operation, message: error.message }),
    );
}
