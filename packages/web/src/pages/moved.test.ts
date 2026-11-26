import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { siteData } from '../data.ts';
import {
  attr,
  BASE,
  compilation,
  dataFor,
  documentOf,
  findAll,
  findOne,
  hrefs,
  textOf,
} from '../test-support.test.ts';
import { movedPage } from './moved.ts';

void describe('movedPage', () => {
  void it('refreshes to the new address at once and links it for readers without refresh', () => {
    const root = documentOf(movedPage(dataFor([], { title: 'Atlas' }), 'Releases', BASE));
    assert.equal(
      attr(findOne(root, 'meta', { 'http-equiv': 'refresh' }), 'content'),
      `0; url=${BASE}`,
    );
    assert.equal(attr(findOne(root, 'link', { rel: 'canonical' }), 'href'), BASE);
    assert.equal(textOf(findOne(root, 'title')), 'Releases · Atlas');
    assert.equal(
      attr(findOne(root, 'link', { rel: 'stylesheet' }), 'href'),
      `${BASE}assets/site.css`,
    );
    const note = findOne(root, 'p', { class: 'page-note' });
    assert.equal(textOf(note), 'Releases moved to Atlas.');
    assert.deepEqual(hrefs(note), [BASE]);
    assert.equal(attr(findOne(root, 'main'), 'id'), 'main');
  });

  void it('loads no scripts', () => {
    const root = documentOf(movedPage(dataFor([]), 'Releases', BASE));
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('escapes the workspace title, page title and target', () => {
    const target = `${BASE}items/?a=1&b="2"`;
    const markup = movedPage(dataFor([], { title: '<Atlas> & co' }), 'Old <page>', target);
    const root = documentOf(markup);
    assert.equal(textOf(findOne(root, 'title')), 'Old <page> · <Atlas> & co');
    assert.equal(attr(findOne(root, 'link', { rel: 'canonical' }), 'href'), target);
    assert.deepEqual(hrefs(findOne(root, 'main')), [target]);
    assert.match(markup, /&lt;Atlas&gt; &amp; co/);
  });

  void it('follows a dark brand surface', () => {
    const data = siteData(
      {
        ...compilation([]),
        brand: { config: { schema_version: 1, colors: { surface: '#111111' } }, fonts: {} },
      },
      BASE,
    );
    const root = documentOf(movedPage(data, 'Releases', BASE));
    assert.equal(attr(findOne(root, 'meta', { name: 'color-scheme' }), 'content'), 'dark');
    assert.equal(
      attr(
        findOne(documentOf(movedPage(dataFor([]), 'Releases', BASE)), 'meta', {
          name: 'color-scheme',
        }),
        'content',
      ),
      'light',
    );
  });
});
