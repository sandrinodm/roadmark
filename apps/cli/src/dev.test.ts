import { Deferred, Duration, Effect, Queue, Schedule, Schema, Stream } from 'effect';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { dev, startBuilds, watchQueues } from './dev.ts';

const DEV_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 10_000;
const decodeDevEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ revision: Schema.Finite, diagnostics: Schema.Array(Schema.String) }),
  ),
);

void describe('dev', () => {
  void it(
    'publishes changes, preserves the last good site and reports diagnostics over SSE',
    { timeout: DEV_TIMEOUT_MS },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'roadmap-dev-test-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const config = join(root, 'roadmap.yaml');
      await writeFile(config, workspace('First workspace'));

      const server = await dev({ root, base: '/plan/', port: 0, strict: false, report: () => {} });
      t.after(server.close);
      const original = await fetch(server.url);
      assert.match(await original.text(), /First workspace/);

      const events = await fetch(new URL('.roadmap-events', server.url), {
        signal: AbortSignal.timeout(DEV_TIMEOUT_MS),
      });
      assert.match(events.headers.get('content-type') ?? '', /^text\/event-stream/);
      const stream = events.body?.getReader();
      assert.ok(stream);
      t.after(() => stream.cancel());
      const next = eventReader(stream);
      assert.deepEqual(await next(), { revision: 1, diagnostics: [] });

      await writeFile(config, workspace('Invalid workspace') + 'title: Duplicate title\n');
      const invalid = await next();
      assert.equal(invalid.revision, 1);
      assert.match(invalid.diagnostics.join('\n'), /duplicate-yaml-key/);
      const preserved = await fetch(server.url);
      assert.match(await preserved.text(), /First workspace/);

      await writeFile(config, workspace('New workspace'));
      assert.deepEqual(await next(), { revision: 2, diagnostics: [] });
      const updated = await fetch(server.url);
      const html = await updated.text();
      assert.match(html, /New workspace/);
      assert.match(html, /src="\/plan\/\.roadmap-dev\.js" data-revision="2"/);
    },
  );
});

void describe('dev startup', () => {
  void it(
    'binds after the first build while a watched file keeps changing',
    { timeout: STARTUP_TIMEOUT_MS },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'roadmap-dev-busy-'));
      await writeFile(join(root, 'roadmap.yaml'), workspace('Busy workspace'));
      // A generator writes watched files faster than the debounce period throughout startup.
      let generation = 0;
      let written = Promise.resolve();
      const writer = setInterval(() => {
        generation += 1;
        written = writeFile(join(root, `generated-${generation}.txt`), String(generation));
      }, 20);
      const stopWriter = async () => {
        clearInterval(writer);
        await written;
      };
      t.after(async () => {
        await stopWriter();
        await rm(root, { recursive: true, force: true });
      });
      const server = await dev({ root, base: '/', port: 0, strict: false, report: () => {} });
      t.after(server.close);
      assert.match(await (await fetch(server.url)).text(), /Busy workspace/);
      await stopWriter();
    },
  );
});

void describe('startBuilds', () => {
  void it('finishes the first build at once and folds queued changes into one rebuild', async () => {
    let builds = 0;
    const rebuild = Effect.sync(() => {
      builds += 1;
    });
    // Changes keep arriving faster than the debounce period, as from a generator.
    const busy = Stream.fromSchedule(Schedule.spaced(Duration.millis(10)));
    await Effect.runPromise(Effect.scoped(startBuilds(busy, rebuild)));
    assert.equal(builds, 1);

    builds = 0;
    const burst = Stream.concat(Stream.make(1, 2, 3), Stream.never);
    const settled = Effect.scoped(
      startBuilds(burst, rebuild).pipe(Effect.andThen(Effect.sleep(Duration.millis(300)))),
    );
    await Effect.runPromise(settled);
    assert.equal(builds, 2);
  });
});

void describe('watchQueues', () => {
  void it('keeps one pending change however many events arrive during a build', async () => {
    let builds = 0;
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queues = yield* watchQueues;
          const release = yield* Deferred.make<void>();
          const started = yield* Deferred.make<void>();
          const rebuild = Effect.gen(function* () {
            builds += 1;
            if (builds === 1) {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }
          });
          // The first build is still running while an editor or generator floods the watcher.
          yield* Effect.forkScoped(startBuilds(Stream.fromQueue(queues.changes), rebuild));
          yield* Deferred.await(started);
          for (let index = 0; index < 100_000; index += 1) {
            Queue.offerUnsafe(queues.changes, undefined);
          }

          const pending = Queue.sizeUnsafe(queues.changes);
          for (let index = 0; index < 100; index += 1) {
            Queue.offerUnsafe(queues.failures, new Error(`watch failure ${index}`));
          }

          const failures = Queue.sizeUnsafe(queues.failures);
          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep(Duration.millis(300));
          return { pending, failures, latest: yield* Queue.takeAll(queues.failures) };
        }),
      ),
    );
    assert.equal(result.pending, 1);
    assert.equal(result.failures, 16);
    // Watcher errors are bounded too, but the newest ones are still reported.
    assert.match(String(result.latest.at(-1)), /watch failure 99/);
    assert.equal(builds, 2);
  });
});

function workspace(title: string): string {
  return ['schema_version: 1', `title: ${title}`, 'people: {}', 'teams: {}', ''].join('\n');
}

function eventReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const frameEnd = '\n\n';
  const dataPrefix = 'data: ';
  const decoder = new TextDecoder();
  let buffer = '';
  return async (): Promise<ReturnType<typeof decodeDevEvent>> => {
    while (!buffer.includes(frameEnd)) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += decoder.decode(chunk.value, { stream: true });
    }

    const end = buffer.indexOf(frameEnd);
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + frameEnd.length);

    assert.ok(frame.startsWith(dataPrefix));
    return decodeDevEvent(frame.slice(dataPrefix.length));
  };
}
