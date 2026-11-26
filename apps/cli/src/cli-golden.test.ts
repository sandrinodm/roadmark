import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// Byte-for-byte contract of the command line: stdout, stderr and exit code for each invocation.
// Regenerate deliberately from apps/cli with `ROADMARK_UPDATE_GOLDEN=1 node --test src/cli-golden.test.ts`.

const CLI_FILE = fileURLToPath(new URL('./main.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/cli-golden.json', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../', import.meta.url)).slice(0, -1);
const COMMAND_TIMEOUT_MS = 60_000;
const CONCURRENCY = 6;
const HANG_TIMEOUT_MS = 500;
// Exit status recorded for a child that did not exit on its own (a signal or a runner error).
const SIGNALLED = -1;

const Case = Schema.Struct({
  args: Schema.Array(Schema.String),
  code: Schema.optional(Schema.Finite),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  signal: Schema.optional(Schema.String),
});
const Golden = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.String),
  cases: Schema.Array(Case),
});
const decodeGolden = Schema.decodeUnknownSync(Schema.fromJsonString(Golden));
const encodeGolden = Schema.encodeSync(Schema.fromJsonString(Golden, { space: 2 }));
const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

void describe('command-line golden output', () => {
  void it('reproduces every recorded invocation byte for byte', { timeout: 300_000 }, async (t) => {
    const golden = decodeGolden(await readFile(FIXTURE, 'utf8'));
    const { version } = decodeManifest(await readFile(join(REPOSITORY, 'package.json'), 'utf8'));
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-golden-')));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    for (const [name, contents] of Object.entries(golden.files)) {
      await mkdir(dirname(join(scratch, name)), { recursive: true });
      await writeFile(join(scratch, name), contents);
    }

    const normalize = (text: string) =>
      text
        .split(scratch)
        .join('<tmp>')
        .split(REPOSITORY)
        .join('<repo>')
        .replace(new RegExp(`^${version.replaceAll('.', String.raw`\.`)}\n$`), '<version>\n');
    const results = await mapLimit(golden.cases, CONCURRENCY, async ({ args }) => {
      const { code, signal, stdout, stderr } = await run([CLI_FILE, ...args], {
        cwd: scratch,
        timeout: COMMAND_TIMEOUT_MS,
      });
      const recorded = { args, code, stdout: normalize(stdout), stderr: normalize(stderr) };
      return signal === undefined ? recorded : { ...recorded, signal };
    });

    if (process.env['ROADMARK_UPDATE_GOLDEN'] === '1') {
      await writeFile(FIXTURE, encodeGolden({ files: golden.files, cases: results }) + '\n');
      return;
    }

    for (const [index, expected] of golden.cases.entries()) {
      assert.deepEqual(results[index], expected, `roadmark ${expected.args.join(' ')}`);
    }
  });
});

void describe('golden runner', () => {
  void it('records a command ended by a signal as a failure', async () => {
    const hanging = ['-e', "process.stdout.write('done'); setInterval(() => {}, 1000);"];
    const result = await run(hanging, { cwd: REPOSITORY, timeout: HANG_TIMEOUT_MS });
    assert.equal(result.stdout, 'done');
    assert.notEqual(result.code, 0);
    assert.equal(result.signal, 'SIGTERM');
  });
});

type Run = { code: number; signal?: string; stdout: string; stderr: string };

/**
 * Runs Node with the given arguments. A process that exits normally reports its exit code; one
 * ended by a signal (for example on timeout) reports SIGNALLED and the signal name, never success;
 * other runner errors (such as an output overflow) report their code in place of the signal.
 */
async function run(
  argv: ReadonlyArray<string>,
  options: { cwd: string; timeout: number },
): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      argv,
      { ...options, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          done({ code: 0, stdout, stderr });
        } else if (typeof error.code === 'number') {
          done({ code: error.code, stdout, stderr });
        } else {
          const signal = error.signal ?? error.code ?? 'unknown failure';
          done({ code: SIGNALLED, signal, stdout, stderr });
        }
      },
    );
  });
}

async function mapLimit<A, B>(
  items: ReadonlyArray<A>,
  limit: number,
  task: (item: A) => Promise<B>,
): Promise<Array<B>> {
  const results: Array<B> = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await task(item);
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
