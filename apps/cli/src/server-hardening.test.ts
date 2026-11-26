import type { TestContext } from 'node:test';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { preview } from './server.ts';

const CLOSE_TIMEOUT_MS = 5000;

async function site(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'roadmap-preview-hardening-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'sets'));
  await Promise.all([
    writeFile(join(directory, '.roadmark-site.json'), '{"base":"/plan/"}'),
    writeFile(join(directory, 'index.html'), '<h1>Roadmap</h1>'),
    writeFile(join(directory, 'demo.mp4'), '0123456789'),
  ]);
  return directory;
}

/**
 * Sends raw bytes and resolves with the whole response once the server closes the connection.
 */
async function exchange(url: string, request: string): Promise<string> {
  const { hostname, port } = new URL(url);
  const socket = connect(Number(port), hostname);
  socket.setEncoding('utf8');
  let response = '';
  socket.on('data', (chunk: string) => {
    response += chunk;
  });
  socket.write(request);
  await once(socket, 'close');
  return response;
}

function statusOf(response: string): number {
  return Number(response.split(' ')[1]);
}

void describe('preview request targets', () => {
  void it('validates the original Host header and absolute-form target before routing', async (t) => {
    const server = await preview(await site(t), 0);
    t.after(server.close);
    const { host } = new URL(server.url);
    const send = async (target: string, headers: Array<string>) =>
      statusOf(
        await exchange(
          server.url,
          [`GET ${target} HTTP/1.1`, ...headers, 'Connection: close', '', ''].join('\r\n'),
        ),
      );
    assert.equal(await send('/plan/', [`Host: ${host}`]), 200);
    // A loopback target must not launder a foreign Host header.
    assert.equal(await send(`http://${host}/plan/`, ['Host: evil.example']), 421);
    assert.equal(await send(`http://evil.example/plan/`, [`Host: ${host}`]), 421);
    assert.equal(await send(`http://${host}/plan/`, [`Host: ${host}`]), 200);
    // Dot segments in an absolute-form target are rejected, not normalized away.
    assert.equal(await send(`http://${host}/plan/sets/../index.html`, [`Host: ${host}`]), 404);
    assert.equal(await send(`http://${host}/plan/%2e%2e/index.html`, [`Host: ${host}`]), 404);
    assert.equal(await send('/plan/', [`Host: ${host}`, 'Host: evil.example']), 421);
    assert.equal(await send('/plan/', ['Host: evil.example', `Host: ${host}`]), 421);
  });

  void it('hides the build marker behind an in-tree symbolic link and never opens a FIFO', async (t) => {
    const directory = await site(t);
    await symlink(join(directory, '.roadmark-site.json'), join(directory, 'marker.json'));
    await symlink(directory, join(directory, 'sets', 'loop'));
    // Opening a FIFO would block until a writer appears; it is refused without being opened.
    execFileSync('mkfifo', [join(directory, 'pipe.txt')]);
    const server = await preview(directory, 0);
    t.after(server.close);
    const hidden = ['marker.json', 'sets/loop/.roadmark-site.json', 'sets/loop/marker.json'];
    for (const path of [...hidden, 'pipe.txt']) {
      assert.equal((await fetch(new URL(path, server.url))).status, 404, path);
    }
  });
});

void describe('preview byte ranges', () => {
  void it('keeps range headers and body consistent while the file is replaced', async (t) => {
    const directory = await site(t);
    const long = join(directory, 'long.bin');
    const short = join(directory, 'short.bin');
    const target = join(directory, 'demo.mp4');
    // The target exists before the first request, and each rename replaces it atomically.
    await writeFile(target, '0123456789');
    const server = await preview(directory, 0);
    t.after(server.close);
    const swap = { running: true };
    const swapper = (async () => {
      while (swap.running) {
        await writeFile(long, '0123456789');
        await rename(long, target);
        await writeFile(short, 'abcd');
        await rename(short, target);
      }
    })();

    const video = new URL('demo.mp4', server.url);
    try {
      // Either version of the file satisfies the range, so every response is partial content whose
      // headers and body all describe the same version.
      const versions = [
        { range: 'bytes 2-9/10', length: '8', body: '23456789' },
        { range: 'bytes 2-3/4', length: '2', body: 'cd' },
      ];
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const response = await fetch(video, { headers: { Range: 'bytes=2-9' } });
        const received = {
          range: response.headers.get('content-range'),
          length: response.headers.get('content-length'),
          body: await response.text(),
        };
        assert.equal(response.status, 206, `attempt ${attempt}`);
        assert.ok(
          versions.some((version) => isDeepStrictEqual(version, received)),
          `attempt ${attempt}: ${JSON.stringify(received)}`,
        );
      }
    } finally {
      swap.running = false;
      await swapper;
    }
  });
});

void describe('preview shutdown', () => {
  void it(
    'closes while a client is stalled half way through its request headers',
    { timeout: CLOSE_TIMEOUT_MS },
    async (t) => {
      const server = await preview(await site(t), 0);
      const { hostname, port } = new URL(server.url);
      const socket = connect(Number(port), hostname);
      t.after(() => socket.destroy());
      socket.on('error', () => {});
      // A reset is expected; only the close matters.
      const ended = new Promise<void>((resolve) => {
        socket.once('close', () => {
          resolve();
        });
      });
      await once(socket, 'connect');
      // One complete request, then the start of a second in the same packet: once the first
      // response arrives the server has read the stalled headers too.
      const host = `Host: ${hostname}:${port}\r\n`;
      socket.write(`GET /plan/ HTTP/1.1\r\n${host}\r\nGET /plan/ HTTP/1.1\r\n${host}X-Partial: `);
      await once(socket, 'data');
      await server.close();
      // The server, not the client, ends the stalled connection, so the process can exit.
      await ended;
    },
  );
});
