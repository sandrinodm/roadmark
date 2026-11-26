#!/usr/bin/env node
import { runMain } from '@roadmark/compiler/platform';
import { Cause, Console, Effect, Exit, Match, Option, Predicate, Runtime } from 'effect';

import type { CliOperationError, CliUsageError } from './program.ts';

import { CliWorkspace, runCli } from './program.ts';

/**
 * Exit status for failures that carry no `Runtime.errorExitCode`, such as defects.
 */
const UNEXPECTED_FAILURE = 2;

/**
 * Runs one invocation, reports a failure once and records the returned status for a clean exit.
 */
const program = runCli(process.argv.slice(2)).pipe(
  Effect.provide(CliWorkspace.layer),
  Effect.tapCause(reportFailure),
  Effect.tap((code) =>
    Effect.sync(() => {
      process.exitCode = code;
    }),
  ),
);

// A reader that closes early, such as `roadmark schema item | head`, is not an error: later writes
// to that stream are dropped and the command still finishes, so the process exits with the
// command's real status (set above on success, or by the teardown for failures).
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      throw error;
    }

    stream.destroy();
  });
}

runMain(program, {
  disableErrorReporting: true,
  teardown: (exit, finish) => {
    const code = exitCode(exit);
    // `finish` exits the process for non-zero codes and signals; flush piped output first.
    process.stdout.write('', () => process.stderr.write('', () => finish(code)));
  },
});

/**
 * Prints the failure message once, leaving signal-driven interruption silent.
 */
function reportFailure(cause: Cause.Cause<CliUsageError | CliOperationError>): Effect.Effect<void> {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.void;
  }

  const message = Option.match(Cause.findErrorOption(cause), {
    onNone: () => defectMessage(Cause.squash(cause)),
    onSome: describe,
  });
  return Console.error(`roadmark: ${message}`);
}

/**
 * Selects the author-facing text of a typed CLI failure by its tag.
 */
function describe(error: CliUsageError | CliOperationError): string {
  return Match.valueTags(error, {
    CliUsageError: (usage) => usage.message,
    CliOperationError: (operation) => operation.message,
  });
}

/**
 * Preserves an unexpected defect's text, including thrown values that are not errors.
 */
function defectMessage(defect: unknown): string {
  return defect instanceof Error ? defect.message : String(defect);
}

/**
 * Maps the program exit to a status: success and interruption exit 0 (the returned status is
 * already in `process.exitCode`), typed failures use their `Runtime.errorExitCode`, others exit 2.
 */
function exitCode(exit: Exit.Exit<unknown, unknown>): number {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    return 0;
  }

  const error = Cause.squash(exit.cause);
  if (Predicate.hasProperty(error, Runtime.errorExitCode)) {
    const code = error[Runtime.errorExitCode];
    if (typeof code === 'number') {
      return code;
    }
  }

  return UNEXPECTED_FAILURE;
}
