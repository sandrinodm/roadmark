import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { describe, it } from 'node:test';

import {
  allowedHost,
  HTML,
  JAVASCRIPT,
  MIME_TYPES,
  normalizeBase,
  parseRange,
  receivedTarget,
  requestFile,
  SITE_MARKER,
  splitTarget,
} from './request.ts';

/**
 * The message every rejected deployment base reports.
 */
const BAD_BASE = 'Use an absolute URL path for --base, such as / or /roadmap/.';

void describe('normalizeBase', () => {
  void it('slash-terminates absolute URL paths', () => {
    assert.equal(normalizeBase('/'), '/');
    assert.equal(normalizeBase('/roadmap'), '/roadmap/');
    assert.equal(normalizeBase('/roadmap/'), '/roadmap/');
    assert.equal(normalizeBase('/product/road-map_v2.~x/'), '/product/road-map_v2.~x/');
    assert.equal(normalizeBase('/.well/'), '/.well/');
  });

  void it('rejects empty, relative, absolute-URL, dot-segment and unsafe bases', () => {
    for (const input of [
      '',
      'roadmap',
      './roadmap',
      'https://example.com/',
      '//example.com/',
      '/a//b/',
      '/a/../b',
      '/..',
      '/./',
      '/a/.',
      '/a b/',
      '/a?b',
      '/a#b',
      '/a%2e%2e/',
      String.raw`\roadmap`,
    ]) {
      assert.throws(() => normalizeBase(input), { message: BAD_BASE }, input);
    }
  });
});

void describe('allowedHost', () => {
  void it('accepts loopback names on the bound port, case-insensitively', () => {
    for (const host of ['127.0.0.1:4173', 'localhost:4173', 'LocalHost:4173', '[::1]:4173']) {
      assert.equal(allowedHost(host, 4173), true, host);
    }
  });

  void it('accepts a portless loopback name only when bound to port 80', () => {
    assert.equal(allowedHost('localhost', 80), true);
    assert.equal(allowedHost('localhost:80', 80), true);
    assert.equal(allowedHost('localhost', 4173), false);
  });

  void it('rejects other ports, other names and rebinding hosts', () => {
    for (const host of [
      undefined,
      '',
      'localhost:8080',
      'evil.example:4173',
      'localhost.evil.example:4173',
      '127.0.0.2:4173',
      '::1:4173',
      '0.0.0.0:4173',
    ]) {
      assert.equal(allowedHost(host, 4173), false, String(host));
    }
  });
});

void describe('receivedTarget', () => {
  void it('splits an origin-form target with exactly one allowed Host header', () => {
    assert.deepEqual(receivedTarget('/items/a/?q=x', ['Host', 'localhost:4173'], 4173), {
      pathname: '/items/a/',
      query: 'q=x',
    });
    assert.deepEqual(receivedTarget('/', ['host', '127.0.0.1:9', 'Accept', '*/*'], 9), {
      pathname: '/',
      query: undefined,
    });
  });

  void it('rejects missing, duplicated and foreign Host headers', () => {
    assert.equal(receivedTarget('/', [], 4173), undefined);
    assert.equal(receivedTarget('/', ['Accept', 'localhost:4173'], 4173), undefined);
    assert.equal(
      receivedTarget('/', ['Host', 'localhost:4173', 'HOST', 'localhost:4173'], 4173),
      undefined,
    );
    assert.equal(receivedTarget('/', ['Host', 'attacker.example:4173'], 4173), undefined);
  });

  void it('accepts an absolute-form target naming this server and keeps the path raw', () => {
    const headers = ['Host', 'localhost:4173'];
    assert.deepEqual(receivedTarget('http://localhost:4173/a/../b?x', headers, 4173), {
      pathname: '/a/../b',
      query: 'x',
    });
    assert.deepEqual(receivedTarget('HTTP://LOCALHOST:4173', headers, 4173), {
      pathname: '/',
      query: undefined,
    });
    assert.deepEqual(receivedTarget('http://localhost:4173?x=1', headers, 4173), {
      pathname: '/',
      query: 'x=1',
    });
  });

  void it('rejects an absolute-form target for another authority or scheme', () => {
    const headers = ['Host', 'localhost:4173'];
    assert.equal(receivedTarget('http://evil.example/', headers, 4173), undefined);
    assert.equal(receivedTarget('https://localhost:4173/', headers, 4173), undefined);
    assert.equal(receivedTarget('*', headers, 4173), undefined);
    assert.equal(receivedTarget('localhost:4173', headers, 4173), undefined);
  });
});

void describe('splitTarget', () => {
  void it('splits at the first question mark only, keeping the remainder verbatim', () => {
    assert.deepEqual(splitTarget('/a'), { pathname: '/a', query: undefined });
    assert.deepEqual(splitTarget('/a?'), { pathname: '/a', query: '' });
    assert.deepEqual(splitTarget('/a?b=1?c=2'), { pathname: '/a', query: 'b=1?c=2' });
    assert.deepEqual(splitTarget('/a?b=\n1'), { pathname: '/a', query: 'b=\n1' });
  });
});

void describe('requestFile', () => {
  void it('decodes mount-relative paths and keeps the pathname and query', () => {
    assert.deepEqual(requestFile('/roadmap/items/a/', 'q=1', '/roadmap/'), {
      path: ['items', 'a'].join(sep),
      pathname: '/roadmap/items/a/',
      query: 'q=1',
    });
    assert.deepEqual(requestFile('/assets/caf%C3%A9%20menu.png', undefined, '/'), {
      path: ['assets', 'café menu.png'].join(sep),
      pathname: '/assets/caf%C3%A9%20menu.png',
      query: undefined,
    });
    assert.deepEqual(requestFile('/roadmap/', undefined, '/roadmap/'), {
      path: '',
      pathname: '/roadmap/',
      query: undefined,
    });
  });

  void it('rejects paths outside the base', () => {
    assert.equal(requestFile('/other/index.html', undefined, '/roadmap/'), undefined);
    assert.equal(requestFile('/roadmap', undefined, '/roadmap/'), undefined);
  });

  void it('rejects traversal through raw or encoded dot segments and separators', () => {
    for (const pathname of [
      '/../etc/passwd',
      '/a/../../etc/passwd',
      '/%2e%2e/etc/passwd',
      '/%2E%2E/etc/passwd',
      '/a/%2e/b',
      '/./index.html',
      '/a%2f..%2f..%2fetc',
      '/a%5c..%5cetc',
      '/..%5cetc',
      '/a//b',
      '/a/%00',
      '/a%0a',
      '/%E0%A4%A',
    ]) {
      assert.equal(requestFile(pathname, undefined, '/'), undefined, pathname);
    }
  });

  void it('never serves the build marker at any depth', () => {
    assert.equal(requestFile(`/${SITE_MARKER}`, undefined, '/'), undefined);
    assert.equal(requestFile('/%2Eroadmark-site.json', undefined, '/'), undefined);
    assert.equal(requestFile(`/assets/${SITE_MARKER}/x`, undefined, '/'), undefined);
    assert.equal(requestFile('/.roadmark-site.json.bak', undefined, '/'), undefined);
  });

  void it('never serves hidden files or folders, but routes the development endpoints', () => {
    for (const pathname of [
      '/.env',
      '/%2Eenv',
      '/.git/config',
      '/assets/.hidden/x.png',
      '/roadmap/.env',
      '/.roadmap-dev.js/x',
      '/assets/.roadmap-events',
    ]) {
      assert.equal(requestFile(pathname, undefined, '/'), undefined, pathname);
    }

    assert.equal(requestFile('/plan/.env', undefined, '/plan/'), undefined);
    for (const name of ['.roadmap-events', '.roadmap-dev.js']) {
      assert.deepEqual(requestFile(`/plan/${name}`, undefined, '/plan/'), {
        path: name,
        pathname: `/plan/${name}`,
        query: undefined,
      });
    }
  });
});

void describe('parseRange', () => {
  void it('parses closed, open and suffix ranges, clamping the end to the file', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
    assert.deepEqual(parseRange('bytes=999-999', 1000), { start: 999, end: 999 });
  });

  void it('rejects unsatisfiable, malformed and multi-part ranges and empty files', () => {
    for (const header of [
      'bytes=1000-',
      'bytes=5-4',
      'bytes=-0',
      'bytes=-',
      'bytes=0-1,5-6',
      'items=0-1',
      'bytes= 0-1',
      'bytes=a-b',
    ]) {
      assert.equal(parseRange(header, 1000), undefined, header);
    }

    assert.equal(parseRange('bytes=0-', 0), undefined);
  });
});

void describe('content types', () => {
  void it('maps published extensions, with charsets on text types', () => {
    assert.equal(MIME_TYPES.get('.html'), HTML);
    assert.equal(HTML, 'text/html; charset=utf-8');
    assert.equal(MIME_TYPES.get('.js'), JAVASCRIPT);
    assert.equal(JAVASCRIPT, 'text/javascript; charset=utf-8');
    assert.equal(MIME_TYPES.get('.css'), 'text/css; charset=utf-8');
    assert.equal(MIME_TYPES.get('.json'), 'application/json; charset=utf-8');
    assert.equal(MIME_TYPES.get('.svg'), 'image/svg+xml');
    assert.equal(MIME_TYPES.get('.jpg'), MIME_TYPES.get('.jpeg'));
    assert.equal(MIME_TYPES.get('.woff2'), 'font/woff2');
    assert.equal(MIME_TYPES.get('.vtt'), 'text/vtt; charset=utf-8');
    assert.equal(MIME_TYPES.get('.txt'), 'text/plain; charset=utf-8');
    assert.equal(MIME_TYPES.get('.ts'), undefined);
    for (const [extension, type] of MIME_TYPES) {
      assert.match(extension, /^\.[a-z0-9]+$/);
      assert.equal(
        type.startsWith('text/') || type === 'application/json; charset=utf-8',
        type.includes('charset=utf-8'),
      );
    }
  });
});
