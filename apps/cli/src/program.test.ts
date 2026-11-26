import { Console, Effect, Predicate } from 'effect';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CliWorkspace, runCli } from './program.ts';

void describe('runCli', () => {
  void it('uses the workspace layer and writes JSON through the Effect console', async (test) => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-cli-layer-'));
    test.after(() => rm(root, { recursive: true, force: true }));
    const document = ['schema_version: 1', 'title: CLI test', 'people: {}', 'teams: {}', ''];
    await writeFile(join(root, 'roadmap.yaml'), document.join('\n'));

    const logs: Array<unknown> = [];
    const output: Console.Console = { ...console, log: (value: unknown) => logs.push(value) };
    const command = runCli(['lint', '--json']).pipe(
      Effect.provide(CliWorkspace.at(root)),
      Effect.provideService(Console.Console, output),
    );
    assert.equal(await Effect.runPromise(command), 0);
    assert.deepEqual(logs, ['[]']);
  });

  void it('distinguishes invalid usage from a failed workspace operation', async (test) => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-cli-errors-'));
    test.after(() => rm(root, { recursive: true, force: true }));
    const layer = CliWorkspace.at(join(root, 'missing'));
    const usage = runCli(['lint', '--out', 'site']).pipe(Effect.provide(layer), Effect.flip);
    const usageError = await Effect.runPromise(usage);
    assert.ok(Predicate.isTagged(usageError, 'CliUsageError'));
    assert.match(usageError.message, /--out is unavailable/);

    const lint = runCli(['lint']).pipe(Effect.provide(layer), Effect.flip);
    const lintError = await Effect.runPromise(lint);
    assert.ok(Predicate.isTagged(lintError, 'CliOperationError'));
    assert.equal(lintError.operation, 'lint workspace');
  });

  void it('reports a command module that fails to load as an operation error', async (test) => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-cli-load-'));
    test.after(() => rm(root, { recursive: true, force: true }));
    // Fails the lazy import of the publisher, as a broken or missing installed file would.
    const hooks = registerHooks({
      load: (url, context, next) => {
        if (url.endsWith('/cli/src/publish.ts')) {
          throw new Error('Cannot load the publisher.');
        }

        return next(url, context);
      },
    });
    test.after(() => hooks.deregister());
    const build = runCli(['build', '--out', join(root, 'site')]).pipe(
      Effect.provide(CliWorkspace.at(root)),
      Effect.flip,
    );
    const failure = await Effect.runPromise(build);
    assert.ok(Predicate.isTagged(failure, 'CliOperationError'));
    assert.equal(failure.operation, 'publish site');
    assert.match(failure.message, /Cannot load the publisher/);
  });
});
