import { Effect, Runtime, Schema } from 'effect';

import { errorText } from './run.ts';

/**
 * A rejected command line, with a message that explains how to correct it.
 */
export class CliUsageError extends Schema.TaggedError<
  CliUsageError,
  {
    /**
     * Distinguishes CLI usage errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('CliUsageError', {
  /**
   * Explains the invalid arguments and how to correct them.
   */
  message: Schema.String,
}) {
  /**
   * Invalid usage exits with status 2, distinct from content failures that return 1.
   */
  override readonly [Runtime.errorExitCode] = 2;
}

/**
 * A command that could not complete because one of its operations failed.
 */
export class CliOperationError extends Schema.TaggedError<
  CliOperationError,
  {
    /**
     * Distinguishes CLI operation errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('CliOperationError', {
  /**
   * Identifies the command step that failed.
   */
  operation: Schema.String,

  /**
   * Describes the underlying failure for display to the user.
   */
  message: Schema.String,
}) {
  /**
   * Failed workspace, filesystem or server operations exit with status 2.
   */
  override readonly [Runtime.errorExitCode] = 2;
}

/**
 * Lifts a promise, including a lazily loaded command module, into the CLI error channel while
 * preserving its author-facing message, so even a failed import reports the command step.
 *
 * @param operation The command step, shown with the failure.
 * @param run Starts the promise.
 * @returns The promise's value, or a {@link CliOperationError}.
 */
export function perform<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, CliOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new CliOperationError({ operation, message: errorText(cause) }),
  });
}
