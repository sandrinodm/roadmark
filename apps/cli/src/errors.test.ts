import { Effect, Predicate, Runtime } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CliOperationError, CliUsageError, perform } from './errors.ts';

void describe('CLI errors', () => {
  void it('exits invalid usage and failed operations with status 2', () => {
    const usage = new CliUsageError({ message: 'Unknown command "x".' });
    const operation = new CliOperationError({ operation: 'build site', message: 'disk full' });
    assert.equal(usage[Runtime.errorExitCode], 2);
    assert.equal(operation[Runtime.errorExitCode], 2);
    assert.ok(Predicate.isTagged(usage, 'CliUsageError'));
    assert.ok(Predicate.isTagged(operation, 'CliOperationError'));
    assert.equal(usage.message, 'Unknown command "x".');
    assert.equal(operation.operation, 'build site');
    assert.equal(operation.message, 'disk full');
  });
});

void describe('perform', () => {
  void it('passes a resolved value through', async () => {
    assert.equal(await Effect.runPromise(perform('read', async () => 42)), 42);
  });

  void it('names the step and keeps the message of a rejected Error', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        perform('load command', async () => {
          throw new Error('Cannot find module ./dev.js');
        }),
      ),
    );
    assert.ok(Predicate.isTagged(error, 'CliOperationError'));
    assert.equal(error.operation, 'load command');
    assert.equal(error.message, 'Cannot find module ./dev.js');
    assert.equal(error[Runtime.errorExitCode], 2);
  });

  void it('stringifies a rejection that is not an Error', async () => {
    const rejection = Promise.withResolvers<never>();
    rejection.reject('port taken');
    const error = await Effect.runPromise(Effect.flip(perform('serve', () => rejection.promise)));
    assert.equal(error.message, 'port taken');
  });

  void it('turns a synchronous throw from the starter into a typed failure', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        perform<string>('start', () => {
          throw new Error('sync');
        }),
      ),
    );
    assert.equal(error.operation, 'start');
    assert.equal(error.message, 'sync');
  });
});
