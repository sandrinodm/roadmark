import { Effect, Predicate } from 'effect';

import type { NodeServices } from './platform.ts';

import { nodeServices as layer } from './platform.ts';

/**
 * Runs an effect for Promise callers (tests, e2e and the benchmark) with the Node platform
 * services, rejecting with the effect's typed error.
 *
 * @param effect The command effect to run once.
 * @returns A promise for the effect's value.
 */
export function runPromise<A, E>(effect: Effect.Effect<A, E, NodeServices>): Promise<A> {
  // oxlint-disable-next-line slop/no-effect-run-outside-entry -- Promise facade for non-Effect callers.
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

/**
 * Preserves an error's text, also handling rejections that are not Error instances.
 *
 * @param cause The thrown or rejected value.
 * @returns The message shown to authors.
 */
export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Recognizes a Node system error with the expected code, such as `ENOENT`.
 *
 * @param cause The thrown or rejected value.
 * @param code The system error code to match.
 * @returns Whether the value is a Node error carrying that code.
 */
export function hasCode(cause: unknown, code: string): boolean {
  return Predicate.hasProperty(cause, 'code') && cause.code === code;
}
