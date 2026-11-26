import type { HttpBody, HttpServerResponse } from 'effect/http';
import type { Readable } from 'node:stream';

import { Effect, Predicate } from 'effect';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { after, before, describe, it } from 'node:test';

import { SITE_MARKER } from './request.ts';
import { fileResponse, locate, openFile } from './static-file.ts';

/**
 * Temporary directory holding the served site and a sibling outside it.
 */
let home = '';

/**
 * Canonical served directory inside {@link home}.
 */
let site = '';

/**
 * Bytes of the media file the range tests read.
 */
const MEDIA = '0123456789abcdefghij';

before(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'roadmap-static-file-')));
  site = path.join(home, 'site');
  await mkdir(path.join(site, 'items', 'a'), { recursive: true });
  await writeFile(path.join(site, 'items', 'a', 'index.html'), '<p>A</p>');
  await writeFile(path.join(site, 'clip.mp4'), MEDIA);
  await writeFile(path.join(site, SITE_MARKER), '{"base":"/"}');
  await writeFile(path.join(home, 'secret.txt'), 'outside');
  await symlink(path.join(home, 'secret.txt'), path.join(site, 'escape.txt'));
  await symlink(home, path.join(site, 'parent'));
  await symlink(path.join(site, SITE_MARKER), path.join(site, 'marker-alias.json'));
  await symlink(path.join(site, 'clip.mp4'), path.join(site, 'clip-alias.mp4'));
  await writeFile(path.join(site, '.env'), 'SECRET=1');
  await mkdir(path.join(site, '.git'));
  await writeFile(path.join(site, '.git', 'config'), '[core]');
  await writeFile(path.join(site, '.roadmap-dev.js'), 'stale');
  await symlink(path.join(site, '.env'), path.join(site, 'env-alias.txt'));
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

/**
 * Narrows a response body to the raw stream body that file responses carry.
 */
function rawBody(response: HttpServerResponse.HttpServerResponse): HttpBody.Raw {
  const { body } = response;
  assert.ok(body._tag === 'Raw', `Expected a raw body, got ${body._tag}`);
  return body;
}

/**
 * Recognizes a Node readable stream by the members the body reader relies on.
 */
function isReadable(value: HttpBody.Raw['body']): value is Readable {
  return (
    Predicate.hasProperty(value, 'readableEnded') &&
    Predicate.hasProperty(value, 'pipe') &&
    Predicate.isFunction(value.pipe)
  );
}

/**
 * Collects a raw response body stream into a string.
 */
async function bodyText(response: HttpServerResponse.HttpServerResponse): Promise<string> {
  const { body } = rawBody(response);
  assert.ok(isReadable(body));
  return text(body);
}

void describe('locate', () => {
  void it('resolves files and directories beneath the site', async () => {
    assert.deepEqual(await locate(site, path.join('items', 'a', 'index.html')), {
      path: path.join(site, 'items', 'a', 'index.html'),
      directory: false,
      file: true,
    });
    assert.deepEqual(await locate(site, 'items'), {
      path: path.join(site, 'items'),
      directory: true,
      file: false,
    });
    assert.deepEqual(await locate(site, ''), { path: site, directory: true, file: false });
  });

  void it('follows a symbolic link that stays inside the site to its canonical path', async () => {
    assert.equal((await locate(site, 'clip-alias.mp4'))?.path, path.join(site, 'clip.mp4'));
  });

  void it('treats missing paths and paths through a file as absent', async () => {
    assert.equal(await locate(site, 'missing.html'), undefined);
    assert.equal(await locate(site, path.join('clip.mp4', 'child')), undefined);
  });

  void it('refuses symbolic links and dot segments that leave the site', async () => {
    assert.equal(await locate(site, 'escape.txt'), undefined);
    assert.equal(await locate(site, path.join('parent', 'secret.txt')), undefined);
    assert.equal(await locate(site, 'parent'), undefined);
    assert.equal(await locate(site, path.join('..', 'secret.txt')), undefined);
  });

  void it('refuses hidden files and folders directly and through an alias', async () => {
    for (const hidden of [
      '.env',
      path.join('.git', 'config'),
      '.git',
      '.roadmap-dev.js',
      'env-alias.txt',
    ]) {
      assert.equal(await locate(site, hidden), undefined, hidden);
    }
  });

  void it('refuses the build marker directly and through an alias', async () => {
    assert.equal(await locate(site, SITE_MARKER), undefined);
    assert.equal(await locate(site, 'marker-alias.json'), undefined);
  });
});

void describe('openFile', () => {
  void it('opens a regular file with its size', async () => {
    const opened = await openFile(path.join(site, 'clip.mp4'));
    assert.ok(opened);
    try {
      assert.equal(opened.size, MEDIA.length);
    } finally {
      await opened.handle.close();
    }
  });

  void it('returns undefined for a directory and rejects a missing path', async () => {
    assert.equal(await openFile(path.join(site, 'items')), undefined);
    await assert.rejects(openFile(path.join(site, 'missing')), { code: 'ENOENT' });
  });
});

void describe('fileResponse', () => {
  void it('streams the whole file with its type, length and Accept-Ranges', async () => {
    const opened = await openFile(path.join(site, 'clip.mp4'));
    assert.ok(opened);
    const response = await Effect.runPromise(fileResponse(opened, 'video/mp4', undefined));
    assert.equal(response.status, 200);
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['content-range'], undefined);
    assert.equal(response.body._tag, 'Raw');
    assert.equal(response.body.contentType, 'video/mp4');
    assert.equal(response.body.contentLength, MEDIA.length);
    assert.equal(await bodyText(response), MEDIA);
    assert.equal(opened.handle.fd, -1);
  });

  void it('streams a satisfiable byte range as 206 with Content-Range', async () => {
    for (const [header, start, end] of [
      ['bytes=2-5', 2, 5],
      ['bytes=15-', 15, 19],
      ['bytes=-3', 17, 19],
      ['bytes=10-999', 10, 19],
    ] as const) {
      const opened = await openFile(path.join(site, 'clip.mp4'));
      assert.ok(opened);
      const response = await Effect.runPromise(fileResponse(opened, 'video/mp4', header));
      assert.equal(response.status, 206, header);
      assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${MEDIA.length}`);
      assert.equal(response.headers['accept-ranges'], 'bytes');
      assert.equal(rawBody(response).contentLength, end - start + 1);
      assert.equal(await bodyText(response), MEDIA.slice(start, end + 1));
    }
  });

  void it('answers an unsatisfiable or malformed range with 416 and closes the file', async () => {
    for (const header of ['bytes=20-', 'bytes=5-1', 'bytes=0-1,4-5', 'lines=1-2']) {
      const opened = await openFile(path.join(site, 'clip.mp4'));
      assert.ok(opened);
      const response = await Effect.runPromise(fileResponse(opened, 'video/mp4', header));
      assert.equal(response.status, 416, header);
      assert.equal(response.headers['content-range'], `bytes */${MEDIA.length}`);
      assert.equal(response.headers['accept-ranges'], 'bytes');
      assert.equal(response.body._tag, 'Uint8Array');
      assert.equal(response.body.contentType, 'text/plain; charset=utf-8');
      assert.equal(opened.handle.fd, -1);
    }
  });
});
