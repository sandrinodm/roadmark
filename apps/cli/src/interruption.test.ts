import { nodeServices } from '@roadmark/compiler/platform';
import { Duration, Effect, Fiber } from 'effect';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { publishSite } from './publish.ts';
import { scaffoldWorkspace } from './scaffold.ts';

/**
 * Interruption points tried, in milliseconds after the operation starts.
 */
const DELAYS = Array.from({ length: 30 }, (_, index) => index / 2);

/**
 * Finer interruption points for a publish, which takes about ten milliseconds.
 */
const PUBLISH_DELAYS = Array.from({ length: 80 }, (_, index) => index / 4);

/**
 * Time given to any operating-system call the interrupted effect failed to wait for.
 */
const SETTLE = Duration.millis(30);

/**
 * Starts an effect, interrupts it after a delay, then waits long enough for stray writes to land.
 */
function interruptAfter<A, E>(effect: Effect.Effect<A, E>, delay: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* Effect.sleep(Duration.millis(delay));
    yield* Fiber.interrupt(fiber);
    yield* Effect.sleep(SETTLE);
  });
}

void describe('scaffoldWorkspace interruption', () => {
  void it('leaves an existing destination empty when interrupted mid-copy', async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), 'roadmap-init-interrupt-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    await Effect.runPromise(scaffoldWorkspace(join(scratch, 'complete')));
    const complete = (await readdir(join(scratch, 'complete'), { recursive: true })).toSorted();
    for (const [index, delay] of DELAYS.entries()) {
      const target = join(scratch, String(index));
      await mkdir(target);
      await Effect.runPromise(interruptAfter(scaffoldWorkspace(target), delay));
      const entries = (await readdir(target, { recursive: true })).toSorted();
      // All or nothing: a partial starter is never left behind.
      assert.deepEqual(entries.length === 0 ? complete : entries, complete, `after ${delay} ms`);
    }
  });
});

void describe('publishSite interruption', () => {
  void it('always leaves the previous or the new site in place', async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), 'roadmap-publish-interrupt-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const root = join(scratch, 'workspace');
    const out = join(scratch, 'site');
    await mkdir(root);
    const config = (title: string) =>
      writeFile(
        join(root, 'roadmap.yaml'),
        `schema_version: 1\ntitle: ${title}\npeople: {}\nteams: {}\n`,
      );
    const publish = publishSite(root, out, '/', false).pipe(Effect.provide(nodeServices));
    for (const [index, delay] of PUBLISH_DELAYS.entries()) {
      await config(`Build ${index}`);
      await Effect.runPromise(interruptAfter(publish, delay));
      const transaction = await readdir(scratch);
      assert.ok(!transaction.includes('site.roadmap-transaction'), `after ${delay} ms`);
      if (index > 0) {
        const page = await readFile(join(out, 'index.html'), 'utf8');
        assert.match(
          page,
          new RegExp(String.raw`Build (?:${index - 1}|${index})\b`),
          `after ${delay} ms`,
        );
      }

      await Effect.runPromise(publish);
    }
  });
});
