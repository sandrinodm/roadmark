import type { Socket } from 'node:net';

import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI_FILE = fileURLToPath(new URL('./main.ts', import.meta.url));
const WORKSPACE = [
  'schema_version: 1',
  'title: CLI test',
  'people:',
  '  owner: Test Owner',
  'teams:',
  '  engineering: Test Engineering',
  '',
].join('\n');
const COMMAND_TIMEOUT_MS = 20_000;
const decodeDiagnostics = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);

void describe('roadmark command', () => {
  void it(
    'exits quietly with status 0 when the reader closes the pipe early',
    { timeout: COMMAND_TIMEOUT_MS },
    async () => {
      // The CLI itself is the child, so its own status is observed rather than a shell pipeline's.
      const result = await closingReader(['schema', 'item'], 'after-first-chunk');
      assert.deepEqual([result.code, result.signal], [0, null]);
      assert.equal(result.stderr, '');
    },
  );

  void it(
    'keeps the failure status when the reader closes the pipe early',
    { timeout: COMMAND_TIMEOUT_MS },
    async (t) => {
      const usage = await closingReader(['bogus'], 'immediately');
      assert.deepEqual([usage.code, usage.signal], [2, null]);

      const temporary = await mkdtemp(join(tmpdir(), 'roadmap-epipe-test-'));
      t.after(() => rm(temporary, { recursive: true, force: true }));
      const workspace = join(temporary, 'workspace');
      assert.equal((await command('init', workspace)).code, 0);
      const items = join(workspace, 'feature-sets/getting-started/items');
      await Promise.all(
        Array.from({ length: 1500 }, (_, index) =>
          writeFile(
            join(items, `broken-${index}.md`),
            [
              '---',
              `id: item-broken-${index}`,
              `title: Broken ${index}`,
              'status: planned',
              'release: rel-missing',
              '---',
              '',
            ].join('\n'),
          ),
        ),
      );
      const lint = await closingReader(['--root', workspace, 'lint'], 'immediately');
      assert.deepEqual([lint.code, lint.signal], [1, null]);

      const schema = await closingReader(['schema', 'item'], 'immediately');
      assert.deepEqual([schema.code, schema.signal], [0, null]);
    },
  );

  void it('prints usage, version and generated schemas', async () => {
    const [help, version, schema] = await Promise.all([
      command('--help'),
      command('--version'),
      command('schema', 'item'),
    ]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: roadmark/);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /^\d+\.\d+\.\d+/);
    assert.equal(schema.code, 0);
    assert.match(schema.stdout, /"\$schema"/);
    assert.match(schema.stdout, /"depends_on"/);
    assert.doesNotMatch(schema.stdout, /"team_dependencies"|"milestone"/);
    assert.equal((await command('schema', 'milestone')).code, 2);
    for (const name of ['teams', 'people', 'brand']) {
      const document = await command('schema', name);
      assert.equal(document.code, 0, document.stderr);
      assert.match(document.stdout, /"\$schema"/);
    }

    assert.equal((await command('schema', 'person')).code, 2);
    assert.equal((await command('lint', '--out', 'site')).code, 2);
  });

  void it('initializes a workspace and refuses to overwrite a conflicting file', async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'roadmap-init-test-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const workspace = join(temporary, 'standalone');
    const blocked = join(temporary, 'blocked');
    await mkdir(blocked);
    await writeFile(join(blocked, 'roadmap.yaml'), 'keep this untouched\n');

    const created = await command('init', workspace);
    assert.equal(created.code, 0, created.stderr);
    assert.match(await readFile(join(workspace, 'roadmap.yaml'), 'utf8'), /^schema_version: 1/m);
    assert.match(await readFile(join(workspace, 'teams.yaml'), 'utf8'), /^product:/m);
    assert.match(await readFile(join(workspace, 'AGENTS.md'), 'utf8'), /roadmark guide/);
    assert.match(
      await readFile(join(workspace, 'feature-sets/getting-started/README.md'), 'utf8'),
      /set-getting-started/,
    );

    const sandbox = join(temporary, 'sandbox');
    const fromTemplate = await command('init', sandbox, '--template', 'ai-sandbox');
    assert.equal(fromTemplate.code, 0, fromTemplate.stderr);
    assert.match(
      await readFile(join(sandbox, 'feature-sets/runtime/README.md'), 'utf8'),
      /set-runtime/,
    );
    assert.equal((await command('init', join(temporary, 'x'), '--template', 'nope')).code, 2);

    assert.equal((await command('--root', blocked, 'init')).code, 2);
    await assert.rejects(readFile(join(blocked, 'feature-sets/getting-started/README.md')), {
      code: 'ENOENT',
    });
    assert.equal(await readFile(join(blocked, 'roadmap.yaml'), 'utf8'), 'keep this untouched\n');
  });

  void it('writes valid scaffolds with workspace IDs and preserves existing Markdown', async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-new-test-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'roadmap.yaml'), WORKSPACE);

    const run = (...args: Array<string>) => command('--root', workspace, ...args);
    for (const args of [
      ['new', 'set', 'sample-set', '--title', 'Test: entry'],
      ['new', 'release', 'sample-release'],
      ['new', 'item', 'sample-item', '--set', 'sample-set', '--release', 'sample-release'],
    ]) {
      const result = await run(...args);
      assert.equal(result.code, 0, result.stderr);
    }

    const source = join(workspace, 'feature-sets/sample-set/README.md');
    const original = await readFile(source, 'utf8');
    assert.match(original, /pm: owner/);
    assert.match(original, /engineering_team: engineering/);
    assert.equal((await run('new', 'set', 'sample-set', '--title', 'Different')).code, 2);
    assert.equal(await readFile(source, 'utf8'), original);
    assert.equal((await run('new', 'item', 'unknown-parent', '--set', 'missing')).code, 2);
    assert.equal((await run('new', 'release', '../escape')).code, 2);
    assert.equal((await run('new', 'milestone', 'beta', '--release', 'sample-release')).code, 2);

    const validation = await run('lint', '--strict', '--json');
    assert.equal(validation.code, 0, validation.stdout || validation.stderr);
    assert.deepEqual(decodeDiagnostics(validation.stdout), []);
  });

  void it('fails lint on removed milestones and team requests and says what to delete', async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-removed-test-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'roadmap.yaml'), WORKSPACE);
    const run = (...args: Array<string>) => command('--root', workspace, ...args);
    assert.equal((await run('new', 'set', 'alpha')).code, 0);
    assert.equal((await run('new', 'item', 'one', '--set', 'alpha')).code, 0);
    const item = join(workspace, 'feature-sets/alpha/items/one.md');
    const source = await readFile(item, 'utf8');
    await writeFile(
      item,
      source.replace(
        /^---\n/,
        '---\nmilestone: beta\nteam_dependencies:\n  - team: engineering\n    need: Review.\n    status: open\n',
      ),
    );
    await mkdir(join(workspace, 'milestones'));
    await writeFile(join(workspace, 'milestones/beta.md'), '---\nid: beta\n---\n');

    const result = await run('lint');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /error \[removed-milestones\] Milestones are no longer part/);
    assert.match(result.stderr, /Fix: Delete the milestones\/ folder/);
    assert.match(result.stderr, /items\/one\.md:\d+:1 error \[removed-field\] milestone:/);
    assert.match(result.stderr, /Fix: Delete the milestone field/);
    assert.match(
      result.stderr,
      /\[removed-field\] team_dependencies: Team requests are no longer part/,
    );
    assert.match(result.stderr, /Fix: Delete the team_dependencies list/);
  });

  void it('reserves a stable ID across concurrent creation commands', async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-id-test-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'roadmap.yaml'), WORKSPACE);
    const run = (...args: Array<string>) => command('--root', workspace, ...args);
    const results = await Promise.all([
      run('new', 'set', 'shared'),
      run('new', 'release', 'shared'),
    ]);
    const codes = results
      .map((result) => result.code)
      .toSorted((left, right) => Number(left) - Number(right));
    assert.deepEqual(codes, [0, 2]);
    assert.equal((await run('lint', '--strict')).code, 0);
  });

  void it('uses external registries when scaffolding a feature set', async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-external-registries-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'roadmap.yaml'), 'schema_version: 1\ntitle: CLI test\n');
    await writeFile(join(workspace, 'teams.yaml'), 'engineering: Test Engineering\n');
    await writeFile(
      join(workspace, 'people.yaml'),
      'owner:\n  name: Test Owner\n  teams: [engineering]\n',
    );

    const run = (...args: Array<string>) => command('--root', workspace, ...args);
    const created = await run('new', 'set', 'sample-set');
    assert.equal(created.code, 0, created.stderr);
    const source = await readFile(join(workspace, 'feature-sets/sample-set/README.md'), 'utf8');
    assert.match(source, /pm: owner/);
    assert.match(source, /engineering_team: engineering/);
    assert.equal((await run('lint', '--strict')).code, 0);
  });

  void it('preserves warning severity in JSON but fails strict lint', async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'roadmap-lint-test-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'roadmap.yaml'), WORKSPACE);
    await mkdir(join(workspace, 'feature-sets'));
    await writeFile(join(workspace, 'feature-sets', 'misplaced.md'), '# Misplaced');

    const warnings = await command('lint', '--root', workspace, '--json');
    assert.equal(warnings.code, 0, warnings.stderr);
    assert.match(warnings.stdout, /"severity": "warning"/);
    assert.match(warnings.stdout, /"rule": "misplaced-markdown"/);
    assert.equal(warnings.stderr, '');

    const strict = await command('lint', '--root', workspace, '--strict');
    assert.equal(strict.code, 1);
    assert.match(strict.stderr, /feature-sets\/misplaced.md:1:1 warning/);
    assert.match(strict.stderr, /Fix:/);
  });

  void it(
    'closes the development server and removes its build on SIGTERM',
    { timeout: COMMAND_TIMEOUT_MS },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'roadmap-cli-shutdown-'));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const workspace = join(directory, 'workspace');
      const scratch = join(directory, 'scratch');
      await Promise.all([mkdir(workspace), mkdir(scratch)]);
      await writeFile(join(workspace, 'roadmap.yaml'), WORKSPACE);

      const args = [CLI_FILE, '--root', workspace, 'dev', '--port', '0'];
      const child = spawn(process.execPath, args, {
        env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
      });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      const exited = once(child, 'exit');
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }

        await exited;
      });

      const lines = createInterface({ input: child.stdout });
      const line = await Promise.race([once(lines, 'line'), exited]);
      lines.close();
      const url = String(line[0]).match(/Roadmap available at (http:\/\/\S+)/)?.[1];
      assert.ok(url, `Expected a running dev server, received ${line[0]}\n${stderr}`);
      assert.equal((await fetch(url)).status, 200);
      const events = await fetch(new URL('.roadmap-events', url));
      const stream = events.body?.getReader();
      assert.ok(stream);
      assert.equal((await stream.read()).done, false);
      const stalled = await stallRequest(url);
      t.after(() => stalled.destroy());
      assert.equal(child.kill('SIGTERM'), true);
      assert.deepEqual(await exited, [0, null]);
      // The stop signal ends the event stream cleanly before the server closes.
      await readToEnd(stream);
      assert.deepEqual(await readdir(scratch), []);
      await assert.rejects(fetch(url));
    },
  );
});

/**
 * Opens a connection whose second request stops half way through its headers.
 */
async function stallRequest(url: string): Promise<Socket> {
  const { hostname, port } = new URL(url);
  const socket = connect(Number(port), hostname);
  socket.on('error', () => {});
  await once(socket, 'connect');
  // Sent in one packet: once the first response arrives, the server has read the partial request.
  const host = `Host: ${hostname}:${port}\r\n`;
  socket.write(`GET / HTTP/1.1\r\n${host}\r\nGET / HTTP/1.1\r\n${host}X-Partial: `);
  await once(socket, 'data');
  return socket;
}

async function readToEnd(stream: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  while (!(await stream.read()).done) {
    // Discard frames sent before shutdown.
  }
}

/**
 * Runs the CLI with its output read by this process, closing both readers either before any output
 * arrives or after the first stdout chunk, and resolves with the child's own exit status.
 */
async function closingReader(
  args: Array<string>,
  close: 'immediately' | 'after-first-chunk',
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  const child = spawn(process.execPath, [CLI_FILE, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  let stderr = '';
  if (close === 'immediately') {
    child.stdout.destroy();
    child.stderr.destroy();
  } else {
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.stdout.once('data', () => child.stdout.destroy());
  }

  return { ...(await exited), stderr };
}

async function command(
  ...args: Array<string>
): Promise<{ code: number | string | undefined; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [CLI_FILE, ...args],
      { timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        done({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}
