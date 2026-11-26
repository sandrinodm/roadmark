import type { IncomingMessage } from 'node:http';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizeBase, preview } from './server.ts';

void describe('normalizeBase', () => {
  void it('normalizes absolute paths and rejects ambiguous URL segments', () => {
    assert.equal(normalizeBase('/team/roadmap'), '/team/roadmap/');
    assert.equal(normalizeBase('/'), '/');
    for (const path of ['', 'roadmap', '//example.com/', '/a/../', '/a//b/', '/a?b', '/%2e%2e/']) {
      assert.throws(() => normalizeBase(path), /absolute URL path/);
    }
  });
});

void describe('preview', () => {
  void it('serves its build base and byte ranges while keeping requests within the output', async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), 'roadmap-preview-test-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const directory = join(scratch, 'site');
    await mkdir(join(directory, 'sets', 'sample'), { recursive: true });
    await Promise.all([
      writeFile(join(directory, '.roadmark-site.json'), '{"base":"/plan/"}'),
      writeFile(join(directory, 'index.html'), '<h1>Roadmap</h1>'),
      writeFile(join(directory, 'sets', 'sample', 'index.html'), '<h1>Sample</h1>'),
      writeFile(join(directory, 'demo.mp4'), '0123456789'),
      writeFile(join(scratch, 'outside.txt'), 'private'),
    ]);
    await symlink(join(scratch, 'outside.txt'), join(directory, 'escape.txt'));

    const server = await preview(directory, 0);
    t.after(server.close);
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/plan\/$/);
    assert.equal(await (await fetch(server.url)).text(), '<h1>Roadmap</h1>');

    const redirect = await fetch(new URL('sets/sample?mode=full', server.url), {
      redirect: 'manual',
    });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/plan/sets/sample/?mode=full');
    assert.equal(
      await (await fetch(new URL('sets/sample/', server.url))).text(),
      '<h1>Sample</h1>',
    );

    const video = new URL('demo.mp4', server.url);
    const range = await fetch(video, { headers: { Range: 'bytes=3-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-type'), 'video/mp4');
    assert.equal(range.headers.get('content-range'), 'bytes 3-5/10');
    assert.equal(await range.text(), '345');

    const suffix = await fetch(video, { headers: { Range: 'bytes=-2' } });
    assert.equal(await suffix.text(), '89');

    const beyond = await fetch(video, { headers: { Range: 'bytes=11-' } });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), 'bytes */10');

    const head = await fetch(video, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');

    for (const path of ['/demo.mp4', '/plan/.roadmark-site.json', '/plan/escape.txt']) {
      assert.equal((await fetch(new URL(path, server.url))).status, 404);
    }

    for (const path of [
      '/plan/../outside.txt',
      '/plan/%2e%2e/outside.txt',
      '/plan/..%2Foutside.txt',
    ]) {
      const response = await rawRequest(server.url, path);
      assert.equal(response.statusCode, 404);
      response.resume();
    }
  });
});

void describe('preview requests', () => {
  void it('rejects foreign Host headers before routing and keeps HEAD ranges', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'roadmap-preview-host-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'sets'));
    await Promise.all([
      writeFile(join(directory, '.roadmark-site.json'), '{"base":"/plan/"}'),
      writeFile(join(directory, 'index.html'), '<h1>Roadmap</h1>'),
      writeFile(join(directory, 'demo.mp4'), '0123456789'),
    ]);
    const server = await preview(directory, 0);
    t.after(server.close);
    const { port } = new URL(server.url);
    assert.notEqual(port, '0');

    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1:1', 'localhost']) {
      for (const path of ['/', '/plan', '/plan/', '/plan/demo.mp4', '/plan/sets']) {
        const response = await rawRequest(server.url, path, { headers: { Host: host } });
        assert.equal(response.statusCode, 421, `${host} ${path}`);
        assert.equal(response.headers['x-content-type-options'], 'nosniff');
        response.resume();
      }
    }

    const absolute = await rawRequest(server.url, `http://evil.example:${port}/plan/`);
    assert.equal(absolute.statusCode, 421);
    absolute.resume();
    for (const host of [`localhost:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
      const response = await rawRequest(server.url, '/plan/', { headers: { Host: host } });
      assert.equal(response.statusCode, 200, host);
      response.resume();
    }

    const post = await fetch(server.url, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    assert.equal(post.headers.get('x-content-type-options'), 'nosniff');

    const video = new URL('demo.mp4', server.url);
    const head = await fetch(video, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(head.headers.get('content-length'), '3');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await head.text(), '');
  });
});

void describe('preview marker', () => {
  void it('names the marker file and the JSON syntax error when the marker is damaged', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'roadmap-preview-marker-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'index.html'), '<h1>Roadmap</h1>');
    await writeFile(join(directory, '.roadmark-site.json'), '{"base": "/",');
    await assert.rejects(
      preview(directory, 0),
      /Could not parse \S+\.roadmark-site\.json: .*JSON at position 13/,
    );

    await writeFile(join(directory, '.roadmark-site.json'), '{"generator":"roadmark"}');
    await assert.rejects(preview(directory, 0), /Expected a roadmap build in /);
  });
});

async function rawRequest(
  url: string,
  path: string,
  options: { headers?: Record<string, string> } = {},
): Promise<IncomingMessage> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const request = get({ hostname, port, path, ...options }, (response) => {
      request.off('error', reject);
      resolve(response);
    });
    request.once('error', reject);
  });
}
