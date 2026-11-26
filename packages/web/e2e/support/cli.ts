import type { ChildProcess } from 'node:child_process';

import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The `roadmark` CLI entry, run from source. The suites drive the CLI as a process instead of
 * importing it, so `@roadmark/web` never depends on the package that depends on it.
 */
const CLI = fileURLToPath(new URL('../../../../apps/cli/src/main.ts', import.meta.url));

/**
 * The line `roadmark preview` prints once it listens, with the site URL.
 */
const READY = /Roadmap available at (\S+)/;

/**
 * How long a preview server gets to print its URL, in milliseconds.
 */
const PREVIEW_STARTUP_MS = 30_000;

/**
 * How long a preview server gets to exit after SIGTERM before it is killed, in milliseconds.
 */
const STOP_GRACE_MS = 5000;

/**
 * Runs a child process to completion and resolves with its output.
 */
const run = promisify(execFile);

/**
 * A preview server the suite started.
 */
export type Preview = {
  /**
   * The site URL at its base path, with a trailing slash, such as `http://127.0.0.1:5000/roadmap/`.
   */
  url: string;

  /**
   * Stops the server.
   */
  close: () => Promise<void>;
};

/**
 * A built site served by its own preview server, in a temporary directory removed on close.
 */
export type Site = Preview & {
  /**
   * The workspace the site was built from.
   */
  workspace: string;

  /**
   * The built site's directory.
   */
  output: string;
};

/**
 * Builds a workspace with `roadmark build --strict` and fails on any diagnostic: the CLI exits
 * non-zero on a strict failure and writes every diagnostic to stderr, so a clean build is exit code
 * 0 with nothing on stderr (what the suites asserted as `model.diagnostics` being empty).
 *
 * @param root Workspace directory.
 * @param out Output directory.
 * @param base Deployment base path, such as `/roadmap/`.
 */
export async function build(root: string, out: string, base: string): Promise<void> {
  const { stderr } = await run(process.execPath, [
    CLI,
    'build',
    '--root',
    root,
    '--out',
    out,
    '--base',
    base,
    '--strict',
  ]);
  if (stderr.trim() !== '') {
    throw new Error(`roadmark build reported diagnostics:\n${stderr}`);
  }
}

/**
 * Serves a built site with `roadmark preview` and waits for the URL it prints.
 *
 * @param dir Built site directory.
 * @param port Port to listen on; 0 picks a free one.
 * @param inherit Whether the server writes its output to this process's stdout and stderr.
 */
export async function preview(dir: string, port = 0, inherit = false): Promise<Preview> {
  const child = spawn(process.execPath, [CLI, 'preview', '--dir', dir, '--port', String(port)], {
    stdio: ['ignore', 'pipe', inherit ? 'inherit' : 'pipe'],
  });
  const exited = once(child, 'exit');
  const { stdout, stderr } = child;
  if (stdout === null) {
    throw new Error('roadmark preview started without a stdout pipe.');
  }

  const started = new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`roadmark preview printed no URL within ${PREVIEW_STARTUP_MS} ms.`));
    }, PREVIEW_STARTUP_MS);
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      if (inherit) {
        process.stdout.write(chunk);
      }

      output += chunk;
      const found = READY.exec(output)?.[1];
      if (found !== undefined) {
        clearTimeout(timer);
        resolve(found);
      }
    });
    stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`roadmark preview exited with ${code}:\n${output}`));
    });
  });
  try {
    const url = await started;
    return { url, close: async () => stop(child, exited) };
  } catch (error) {
    // A server that never printed its URL may still be running; never leave it behind.
    await stop(child, exited);
    throw error;
  }
}

/**
 * Stops a child process: SIGTERM first, then SIGKILL if it has not exited within
 * {@link STOP_GRACE_MS}, and waits until it has exited.
 *
 * @param child The process to stop.
 * @param exited Resolves once the process has exited, registered when it was spawned.
 */
async function stop(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Copies a workspace into a fresh temporary directory, lets the caller change it, builds it and
 * serves the result. `close` stops the server and removes the directory.
 *
 * @param source Workspace to copy.
 * @param base Deployment base path.
 * @param prefix Temporary directory name prefix.
 * @param change Edits the copied workspace before the build.
 */
export async function serveCopy(
  source: string | URL,
  base: string,
  prefix: string,
  change: (workspace: string) => Promise<void> = async () => {},
): Promise<Site> {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const workspace = join(temporary, 'workspace');
    const output = join(temporary, 'site');
    await cp(source, workspace, { recursive: true });
    await change(workspace);
    await build(workspace, output, base);
    const server = await preview(output);
    return {
      ...server,
      workspace,
      output,
      close: async () => {
        await server.close();
        await rm(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
