import type { Entity } from '@roadmark/compiler/model';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from '../data.ts';
import type { Element } from '../test-support.test.ts';

import { renderSite } from '../render.ts';
import {
  attr,
  BASE,
  dataFor,
  done,
  entity,
  findAll,
  findOne,
  fixture,
  fragment,
  HOSTILE,
  hrefs,
  nth,
  pageText,
  spare,
  TEAM_BASE,
  textOf,
} from '../test-support.test.ts';
import { factList } from '../ui/facts.ts';
import { recordFacts, releaseNeighbours, releaseOf, resourceLinks } from './record-facts.ts';

/**
 * A fully assigned item, a bare item, a set and three releases in target order.
 */
const RECORDS = [
  entity({ kind: 'set', id: 'onboarding', title: 'Onboarding' }),
  entity({ kind: 'release', id: 'spring', title: 'Spring', target: '2027-Q2' }),
  entity({ kind: 'release', id: 'winter', title: 'Winter', target: '2027-01' }),
  entity({ kind: 'release', id: 'later', title: HOSTILE }),
  entity({
    id: 'setup',
    title: 'Setup',
    set: 'onboarding',
    release: 'spring',
    start: '2027-03-08',
    target: '2027-04',
    pm: 'maya',
    inherited_pm: true,
    contributors: ['noor', 'maya'],
    engineering_team: 'growth',
    inherited_engineering_team: true,
    contributing_teams: ['platform', 'analytics'],
    jira: ['ONB-1', 'PLAT 2'],
  }),
  entity({ id: 'bare', title: 'Bare' }),
];

/**
 * The records with people and teams, without a Jira base URL.
 */
const DATA = dataFor(RECORDS, {
  people: { maya: 'Maya Chen', noor: 'Noor Patel' },
  teams: { growth: 'Growth', platform: 'Platform', analytics: 'Analytics' },
});

void describe('recordFacts', () => {
  void it('lists every fact in rail order with links under the base path', () => {
    const facts = recordFacts(DATA, record(DATA, 'setup'));
    assert.deepEqual(
      facts.map(({ term, wide }) => `${term}${wide ? ' (wide)' : ''}`),
      [
        'Feature set (wide)',
        'Start',
        'Target',
        'Shipped',
        'Product manager (wide)',
        'Contributors (wide)',
        'Engineering team (wide)',
        'Contributing teams (wide)',
        'Release (wide)',
        'Jira',
        'ID',
      ],
    );
    const values = factValues(DATA, 'setup');
    assert.deepEqual(hrefs(shown(values, 'Feature set')), [`${BASE}sets/onboarding/`]);
    assert.equal(attr(findOne(shown(values, 'Start'), 'time'), 'datetime'), '2027-03-08');
    assert.equal(textOf(shown(values, 'Target')), 'Apr 2027');
    assert.equal(values['Shipped'], undefined);
    const owner = shown(values, 'Product manager');
    assert.deepEqual(hrefs(owner), [`${BASE}people/maya/`]);
    assert.equal(textOf(findOne(owner, 'span', { class: 'inherited' })), 'From feature set');
    assert.deepEqual(hrefs(shown(values, 'Contributors')), [
      `${BASE}people/noor/`,
      `${BASE}people/maya/`,
    ]);
    const team = shown(values, 'Engineering team');
    assert.deepEqual(hrefs(team), [`${BASE}teams/growth/`]);
    assert.equal(textOf(findOne(team, 'span', { class: 'inherited' })), 'From feature set');
    const contributing = shown(values, 'Contributing teams');
    assert.deepEqual(hrefs(contributing), [`${BASE}teams/platform/`, `${BASE}teams/analytics/`]);
    assert.equal(findAll(contributing, 'br').length, 1);
    assert.deepEqual(hrefs(shown(values, 'Release')), [`${BASE}releases/spring/`]);
    assert.deepEqual(
      findAll(shown(values, 'Jira'), 'code').map((code) => textOf(code)),
      ['ONB-1', 'PLAT 2'],
    );
    assert.deepEqual(hrefs(shown(values, 'Jira')), []);
    assert.equal(textOf(shown(values, 'ID')), 'setup');
  });

  void it('leaves direct ownership unmarked', () => {
    const data = dataFor([entity({ id: 'a', title: 'A', pm: 'maya', engineering_team: 'growth' })]);
    const values = factValues(data, 'a');
    assert.deepEqual(findAll(shown(values, 'Product manager'), 'span', { class: 'inherited' }), []);
    assert.deepEqual(
      findAll(shown(values, 'Engineering team'), 'span', { class: 'inherited' }),
      [],
    );
  });

  void it('keeps only the facts a bare item has, calling its release Unassigned', () => {
    const values = factValues(DATA, 'bare');
    assert.deepEqual(Object.keys(values), ['Release', 'ID']);
    assert.equal(textOf(shown(values, 'Release')), 'Unassigned');
  });

  void it('leaves out the release and ID of scopes', () => {
    assert.deepEqual(Object.keys(factValues(DATA, 'onboarding')), []);
    assert.deepEqual(Object.keys(factValues(DATA, 'spring')), ['Target']);
  });

  void it('links Jira keys to the browse path of the workspace Jira, once', () => {
    for (const base of [
      'https://example.atlassian.net',
      'https://example.atlassian.net/',
      'https://example.atlassian.net/browse//',
    ]) {
      const data = dataFor(RECORDS, { jira_base_url: base });
      assert.deepEqual(hrefs(shown(factValues(data, 'setup'), 'Jira')), [
        'https://example.atlassian.net/browse/ONB-1',
        'https://example.atlassian.net/browse/PLAT%202',
      ]);
    }

    const nested = dataFor(RECORDS, { jira_base_url: 'https://tools.example.com/jira' });
    assert.deepEqual(hrefs(shown(factValues(nested, 'setup'), 'Jira')), [
      'https://tools.example.com/jira/browse/ONB-1',
      'https://tools.example.com/jira/browse/PLAT%202',
    ]);
  });
});

void describe('releaseNeighbours', () => {
  void it('links the previous and next releases in target order', () => {
    const root = fragment(releaseNeighbours(DATA, record(DATA, 'spring')));
    const nav = findOne(root, 'nav', { 'aria-label': 'Releases' });
    assert.deepEqual(
      findAll(nav, 'a').map((link) => [attr(link, 'rel'), attr(link, 'href')]),
      [
        ['prev', `${BASE}releases/winter/`],
        ['next', `${BASE}releases/later/`],
      ],
    );
    assert.equal(textOf(findOne(nav, 'a', { rel: 'next' })), `Next release${HOSTILE}`);
    assert.deepEqual(findAll(root, 'script'), []);
  });

  void it('links only one side at either end', () => {
    const first = fragment(releaseNeighbours(DATA, record(DATA, 'winter')));
    assert.deepEqual(
      findAll(first, 'a').map((link) => attr(link, 'rel')),
      ['next'],
    );
    const last = fragment(releaseNeighbours(DATA, record(DATA, 'later')));
    assert.deepEqual(
      findAll(last, 'a').map((link) => attr(link, 'rel')),
      ['prev'],
    );
  });

  void it('renders nothing for a release that stands alone', () => {
    const only = entity({ kind: 'release', id: 'only', title: 'Only' });
    assert.equal(releaseNeighbours(dataFor([only]), only), '');
  });
});

void describe('releaseOf', () => {
  void it('links the release, says Unassigned for items and nothing for other records', () => {
    assert.deepEqual(hrefs(fragment(releaseOf(DATA, record(DATA, 'setup')))), [
      `${BASE}releases/spring/`,
    ]);
    assert.equal(String(releaseOf(DATA, record(DATA, 'bare'))), 'Unassigned');
    assert.equal(releaseOf(DATA, record(DATA, 'onboarding')), '');
  });
});

void describe('resourceLinks', () => {
  void it('lists links in order with their host and escapes labels and URLs', () => {
    const markup = resourceLinks([
      { label: HOSTILE, url: 'https://docs.example.com:8443/p?a=1&b=2' },
      { label: 'Repo', url: 'https://github.com/org/repo' },
    ]);
    const root = fragment(markup);
    const section = findOne(root, 'section', { class: 'resource-links' });
    assert.equal(attr(section, 'aria-label'), 'Links');
    assert.equal(textOf(findOne(section, 'h2')), 'Links');
    const links = findAll(section, 'a', { class: 'resource-link' });
    assert.deepEqual(
      links.map((link) => [
        attr(link, 'href'),
        textOf(findOne(link, 'span', { class: 'resource-label' })),
        textOf(findOne(link, 'span', { class: 'resource-host' })),
      ]),
      [
        ['https://docs.example.com:8443/p?a=1&b=2', HOSTILE, 'docs.example.com:8443'],
        ['https://github.com/org/repo', 'Repo', 'github.com'],
      ],
    );
    assert.deepEqual(findAll(root, 'script'), []);
    assert.match(String(markup), /href="https:\/\/docs\.example\.com:8443\/p\?a=1&amp;b=2"/);
  });

  void it('renders nothing without links', () => {
    assert.equal(resourceLinks(undefined), '');
    assert.equal(resourceLinks([]), '');
  });

  void it('uses the globe for local and reserved names and a favicon for public ones', () => {
    assert.deepEqual(faviconsFor('https://WWW.Example.org./x'), [
      'https://www.google.com/s2/favicons?domain=www.example.org&sz=32',
    ]);
    for (const url of [
      'http://printer.local/',
      'http://router.lan/',
      'https://test.example/',
      'http://10.0.0.1/',
      'http://[2001:db8::1]/',
      'http://localhost:3000/',
      'http://abc.onion/',
    ]) {
      assert.deepEqual(faviconsFor(url), [], url);
    }
  });

  void it('renders named external links as escaped static anchors only on the owning record', async () => {
    const links = [
      { label: 'Spec <draft>', url: 'https://docs.example.com/p?a=1&b=2#scope' },
      { label: 'Channel', url: 'https://app.slack.com/client/T1/C1' },
    ];
    const model = {
      ...fixture,
      entities: [
        { ...done, links },
        { ...spare, links: [] },
      ],
    };
    const files = await renderSite(model, TEAM_BASE);
    const page = pageText(files, 'items/done/index.html');
    assert.ok(page.includes('href="https://docs.example.com/p?a=1&amp;b=2#scope"'));
    assert.ok(page.includes('>Spec &lt;draft&gt;</span>'));
    assert.ok(page.indexOf('Spec &lt;draft&gt;') < page.indexOf('>Channel</span>'));
    assert.match(page, />docs\.example\.com<\/span>/);
    assert.doesNotMatch(pageText(files, 'items/spare/index.html'), /class="resource-links"/);
  });

  void it('looks up only hostnames and keeps local destinations offline', async () => {
    const urls = [
      'https://github.com:8443/example/docs?ticket=secret#proposal',
      'http://intranet/team',
      'https://wiki.internal/projects',
      'http://127.0.0.1:80/',
      'http://[::1]/',
      'http://docs.localhost./',
    ];
    const files = await renderSite(
      {
        ...fixture,
        entities: [
          {
            ...done,
            links: urls.map((url) => ({ label: 'Project', url })),
          },
        ],
      },
      TEAM_BASE,
    );
    const page = pageText(files, 'items/done/index.html');
    const icons = [...page.matchAll(/<img src="(https:\/\/www\.google\.com[^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(icons, ['https://www.google.com/s2/favicons?domain=github.com&amp;sz=32']);
    assert.equal(page.split('class="resource-icon"').length - 1, urls.length);
    assert.match(page, /referrerpolicy="no-referrer"/);
  });
});

/**
 * Lists the favicon requests the link to a URL makes.
 *
 * @param url Link destination.
 * @returns Image sources.
 */
function faviconsFor(url: string): Array<string | undefined> {
  return findAll(fragment(resourceLinks([{ label: 'L', url }])), 'img').map((image) =>
    attr(image, 'src'),
  );
}

/**
 * Looks up a record.
 *
 * @param data Indexed roadmap.
 * @param id Record ID.
 * @returns The record.
 */
function record(data: SiteData, id: string): Entity {
  const found = data.byId.get(id);
  assert.ok(found, id);
  return found;
}

/**
 * Renders a record's facts as the rail does and parses each shown value.
 *
 * @param data Indexed roadmap.
 * @param id Record ID.
 * @returns Parsed values keyed by term, for the facts that are shown.
 */
function factValues(data: SiteData, id: string): Record<string, Element> {
  const root = fragment(factList(recordFacts(data, record(data, id))));
  const values = findAll(root, 'dd');
  return Object.fromEntries(
    findAll(root, 'dt').map((term, index) => [textOf(term), nth(values, index)]),
  );
}

/**
 * Reads the value of a fact that must be shown.
 *
 * @param values Parsed values keyed by term.
 * @param term Fact term.
 * @returns The value element.
 */
function shown(values: Record<string, Element>, term: string): Element {
  const value = values[term];
  assert.ok(value, `${term} is shown`);
  return value;
}
