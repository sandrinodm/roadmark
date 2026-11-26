import type { Brand } from '@roadmark/compiler/brand-schema';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from '../data.ts';
import type { Destination, Page } from './shell.ts';

import { siteData } from '../data.ts';
import {
  attr,
  BASE,
  compilation,
  dataFor,
  documentOf,
  findAll,
  findOne,
  HOSTILE,
  nth,
  textOf,
} from '../test-support.test.ts';
import { html } from './html.ts';
import { shell } from './shell.ts';

/**
 * A plain workspace whose title needs escaping.
 */
const DATA = dataFor([], { title: 'Plans & <Priorities>' });

/**
 * Header destinations and their addresses under the base path.
 */
const DESTINATIONS: Array<[Destination, string, string]> = [
  ['releases', 'Releases', BASE],
  ['sets', 'Feature sets', `${BASE}sets/`],
  ['items', 'Items', `${BASE}items/`],
  ['timeline', 'Timeline', `${BASE}timeline/`],
  ['people', 'People', `${BASE}people/`],
  ['teams', 'Teams', `${BASE}teams/`],
];

void describe('shell', () => {
  void it('writes the head with the page title, description and base-prefixed assets', () => {
    const root = documentOf(
      shell(DATA, { title: 'Items', description: HOSTILE }, html`<p>Main</p>`),
    );
    assert.equal(textOf(findOne(root, 'title')), 'Items · Plans & <Priorities>');
    assert.equal(attr(findOne(root, 'meta', { name: 'description' }), 'content'), HOSTILE);
    assert.equal(attr(findOne(root, 'meta', { name: 'color-scheme' }), 'content'), 'light');
    assert.equal(attr(findOne(root, 'meta', { name: 'theme-color' }), 'content'), '#ffffff');
    assert.equal(attr(findOne(root, 'link', { rel: 'icon' }), 'href'), `${BASE}assets/mark.svg`);
    assert.deepEqual(
      findAll(root, 'link', { rel: 'stylesheet' }).map((link) => attr(link, 'href')),
      [`${BASE}assets/site.css`],
    );
    assert.equal(
      attr(findOne(root, 'script', { type: 'module' }), 'src'),
      `${BASE}assets/client/boot.js`,
    );
    assert.equal(findAll(root, 'script').length, 1);
    assert.deepEqual(findAll(root, 'img', { src: 'x' }), []);
  });

  void it('falls back to the workspace title for the description', () => {
    const root = documentOf(shell(DATA, { title: 'Items' }, html``));
    assert.equal(
      attr(findOne(root, 'meta', { name: 'description' }), 'content'),
      'Plans & <Priorities>',
    );
  });

  void it('puts the content in the main landmark after a skip link', () => {
    const root = documentOf(shell(DATA, { title: 'Items' }, html`<p id="content">Main</p>`));
    const skip = findOne(root, 'a', { class: 'skip-link' });
    assert.equal(attr(skip, 'href'), '#main');
    const main = findOne(root, 'main', { id: 'main' });
    assert.equal(attr(main, 'tabindex'), '-1');
    assert.equal(findAll(main, 'p', { id: 'content' }).length, 1);
    assert.equal(attr(findOne(root, 'html'), 'lang'), 'en');
    assert.equal(attr(findOne(root, 'html'), 'class'), undefined);
    assert.equal(attr(findOne(root, 'body'), 'class'), undefined);
  });

  void it('marks the current destination in both navigations and names it in the menu', () => {
    for (const [nav, label, href] of DESTINATIONS) {
      const root = documentOf(shell(DATA, { title: label, nav }, html``));
      const navs = findAll(root, 'nav', { 'aria-label': 'Primary' });
      assert.equal(navs.length, 2);
      for (const navigation of navs) {
        const links = findAll(navigation, 'a');
        assert.deepEqual(
          links.map((link) => attr(link, 'href')),
          DESTINATIONS.map(([, , address]) => address),
        );
        const current = findAll(navigation, 'a', { 'aria-current': 'page' });
        assert.deepEqual(
          current.map((link) => [attr(link, 'href'), textOf(link)]),
          [[href, label]],
        );
      }

      assert.equal(findAll(nth(navs, 0), 'svg').length, 0);
      assert.equal(findAll(nth(navs, 1), 'svg').length, DESTINATIONS.length);
      const summary = findOne(root, 'summary');
      assert.equal(attr(summary, 'aria-label'), `Menu, current section ${label}`);
    }
  });

  void it('marks nothing current and names the menu "Menu" off the primary destinations', () => {
    const root = documentOf(shell(DATA, { title: 'Work scopes' }, html``));
    assert.deepEqual(findAll(root, 'a', { 'aria-current': 'page' }), []);
    assert.equal(attr(findOne(root, 'summary'), 'aria-label'), 'Menu, current section Menu');
  });

  void it('keeps filters on the Items link from the Items page and timelines only', () => {
    assert.deepEqual(preserved({ title: 'Items', nav: 'items' }), [
      `${BASE}items/`,
      `${BASE}items/`,
    ]);
    assert.deepEqual(preserved({ title: 'Timeline', nav: 'timeline', timeline: true }), [
      `${BASE}items/`,
      `${BASE}items/`,
    ]);
    assert.deepEqual(preserved({ title: 'Teams', nav: 'teams' }), []);
  });

  void it('links the brand home with the escaped workspace title and the search index', () => {
    const root = documentOf(shell(DATA, { title: 'Items' }, html``));
    const brand = findOne(root, 'a', { class: 'app-brand' });
    assert.equal(attr(brand, 'href'), BASE);
    assert.equal(attr(brand, 'aria-label'), 'Plans & <Priorities> home');
    assert.equal(textOf(brand), 'Plans & <Priorities>');
    assert.equal(attr(findOne(brand, 'img'), 'src'), `${BASE}assets/mark.svg`);
    const search = findOne(root, 'button', { class: 'app-search' });
    assert.equal(attr(search, 'data-index'), `${BASE}search-index.json`);
    assert.equal(attr(search, 'hidden'), '');
  });

  void it('uses the article shell for item pages', () => {
    const root = documentOf(shell(DATA, { title: 'Item', itemPage: true }, html``));
    assert.equal(attr(findOne(root, 'body'), 'class'), 'item-page');
  });

  void it('applies a dark brand surface, its logo, theme colour and stylesheet', () => {
    const root = documentOf(
      shell(
        branded({
          config: {
            schema_version: 1,
            colors: { surface: '#101418' },
            header: { background: '#202020', logo: { file: 'logo.png', show_title: false } },
          },
          logo: { output: 'media/logo.png', width: 40, height: 20 },
          fonts: {},
        }),
        { title: 'Items' },
        html``,
      ),
    );
    assert.equal(attr(findOne(root, 'html'), 'class'), 'dark');
    assert.equal(attr(findOne(root, 'meta', { name: 'color-scheme' }), 'content'), 'dark');
    assert.equal(attr(findOne(root, 'meta', { name: 'theme-color' }), 'content'), '#202020');
    assert.deepEqual(
      findAll(root, 'link', { rel: 'stylesheet' }).map((link) => attr(link, 'href')),
      [`${BASE}assets/site.css`, `${BASE}assets/brand.css`],
    );
    assert.equal(attr(findOne(root, 'link', { rel: 'icon' }), 'href'), `${BASE}media/logo.png`);
    const brand = findOne(root, 'a', { class: 'app-brand' });
    const logo = findOne(brand, 'img');
    assert.equal(attr(logo, 'width'), '40');
    assert.equal(attr(logo, 'height'), '20');
    assert.equal(textOf(brand), '');
  });

  void it('keeps the title beside a brand logo unless it is turned off, and uses the surface as theme colour', () => {
    const root = documentOf(
      shell(
        branded({
          config: { schema_version: 1, colors: { surface: '#fafafa' } },
          logo: { output: 'media/logo.png', width: 28, height: 28 },
          fonts: {},
        }),
        { title: 'Items' },
        html``,
      ),
    );
    assert.equal(textOf(findOne(root, 'a', { class: 'app-brand' })), 'Plans & <Priorities>');
    assert.equal(attr(findOne(root, 'meta', { name: 'theme-color' }), 'content'), '#fafafa');
    assert.equal(attr(findOne(root, 'html'), 'class'), undefined);
  });
});

/**
 * Indexes the plain workspace with a resolved brand.
 *
 * @param brand Brand configuration and assets.
 * @returns Site data.
 */
function branded(brand: Brand): SiteData {
  return siteData({ ...compilation([], { title: 'Plans & <Priorities>' }), brand }, BASE);
}

/**
 * Lists the links that keep the reader's filters on a page.
 *
 * @param page Page metadata.
 * @returns Link targets.
 */
function preserved(page: Page): Array<string | undefined> {
  return findAll(documentOf(shell(DATA, page, html``)), 'a', { 'data-preserve-filters': true }).map(
    (link) => attr(link, 'href'),
  );
}
