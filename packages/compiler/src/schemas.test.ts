import { Result, Schema, SchemaIssue } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { schemaFor, schemas, SLUG_PATTERN } from './schemas.ts';

/**
 * Decodes like the front-matter reader: every issue at once and unknown keys rejected.
 */
const OPTIONS = { errors: 'all', onExcessProperty: 'error' } as const;

/**
 * Flattens nested decoder issues into one entry per field path.
 */
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Minimal valid item front matter that each case extends.
 */
const ITEM = {
  id: 'work',
  title: 'Work',
  description: 'A useful item.',
  outcome: 'Readers can see what changed.',
  status: 'planned',
};

/**
 * Decodes a value and returns the issue paths, or an empty list when it is accepted.
 */
function issues(schema: Schema.Decoder<unknown>, value: unknown): Array<string> {
  const result = Schema.decodeUnknownResult(schema, OPTIONS)(value);
  if (Result.isSuccess(result)) {
    return [];
  }

  return formatIssue(result.failure.issue).issues.map(({ path = [] }) =>
    path.map((part) => String(typeof part === 'object' ? part.key : part)).join('.'),
  );
}

void describe('schemas', () => {
  void it('exports strict schemas with shared registry and nested field formats', () => {
    const docs = schemas();
    assert.deepEqual(Object.keys(docs), [
      'workspace',
      'set',
      'item',
      'release',
      'teams',
      'people',
      'brand',
    ]);
    assert.match(JSON.stringify(docs['workspace']), /patternProperties/);
    assert.match(JSON.stringify(docs['release']), /additionalProperties":false/);
    const serializedItem = JSON.stringify(docs['item']);
    assert.equal(serializedItem.match(/additionalProperties":false/g)?.length, 3);
    assert.match(serializedItem, /"status":\{"type":"string","enum":/);
    assert.match(serializedItem, /"target":\{"type":"string","pattern":/);
  });

  void it('declares each document as a draft 2020-12 JSON Schema with its definitions', () => {
    for (const [name, document] of Object.entries(schemas())) {
      assert.equal(document['$schema'], 'https://json-schema.org/draft/2020-12/schema', name);
      assert.ok(Object.hasOwn(document, '$defs'), name);
    }
  });
});

void describe('SLUG_PATTERN', () => {
  void it('accepts lowercase words joined by single hyphens', () => {
    for (const slug of ['a', 'item-2', '2028-q1', 'set-billing']) {
      assert.ok(SLUG_PATTERN.test(slug), slug);
    }

    for (const slug of [
      '',
      'Item',
      'double--hyphen',
      '-leading',
      'trailing-',
      'snake_case',
      'a b',
    ]) {
      assert.ok(!SLUG_PATTERN.test(slug), slug);
    }

    assert.ok(!SLUG_PATTERN.test('item\n'));
  });
});

void describe('schemaFor', () => {
  void it('accepts a complete item and rejects unknown keys', () => {
    assert.deepEqual(
      issues(schemaFor('item'), {
        ...ITEM,
        release: 'summer',
        start: '2028-01-15',
        target: '2028-Q1',
        pm: 'alex',
        engineering_team: 'core',
        contributors: ['stevie'],
        contributing_teams: ['web'],
        depends_on: [{ item: 'setup', reason: 'Needs events.' }],
        jira: ['ROAD-123', 'A1-9'],
        links: [{ label: 'Board', url: 'HTTPS://example.com/board?x=1#top' }],
      }),
      [],
    );
    assert.deepEqual(issues(schemaFor('item'), { ...ITEM, milestone: 'beta' }), ['milestone']);
  });

  void it('reports every malformed item field at its path', () => {
    assert.deepEqual(
      issues(schemaFor('item'), {
        id: 'Bad ID',
        title: '   ',
        description: 'Fine.',
        outcome: 'Fine.',
        status: 'blocked',
        start: '2028-01',
        target: '2028-Q5',
        jira: ['road-1', 'ROAD-0'],
        depends_on: [{ item: 'ok', because: 'typo' }],
      }),
      ['id', 'title', 'status', 'start', 'target', 'depends_on.0.because', 'jira.0', 'jira.1'],
    );
  });

  void it('requires absolute web links without credentials, controls or backslashes', () => {
    const link = (url: string) =>
      issues(schemaFor('item'), { ...ITEM, links: [{ label: 'L', url }] });
    assert.deepEqual(link('http://intranet.example/guide'), []);
    for (const url of [
      'javascript:alert(1)',
      '//example.com/doc',
      'ftp://example.com/file',
      'https://',
      'https://user:secret@example.com/doc',
      'https://example.com/a b',
      String.raw`https://example.com\path`,
      'https://[invalid/',
    ]) {
      assert.deepEqual(link(url), ['links.0.url'], url);
    }

    assert.deepEqual(
      issues(schemaFor('item'), { ...ITEM, links: [{ label: ' ', url: 'https://a.b' }] }),
      ['links.0.label'],
    );
  });

  void it('requires a release target and accepts only release statuses', () => {
    const release = {
      id: 'summer',
      title: 'Summer',
      description: 'Release.',
      outcome: 'Shipped.',
      status: 'shipped',
      target: '2028-07',
      shipped_on: '2028-07-12',
    };
    assert.deepEqual(issues(schemaFor('release'), release), []);
    assert.deepEqual(issues(schemaFor('release'), { ...release, target: undefined }), ['target']);
    assert.deepEqual(issues(schemaFor('release'), { ...release, status: 'done' }), ['status']);
    assert.deepEqual(issues(schemaFor('release'), { ...release, shipped_on: '2028-07' }), [
      'shipped_on',
    ]);
  });

  void it('requires feature-set owners', () => {
    const set = { id: 's', title: 'S', description: 'D.', outcome: 'O.', pm: 'alex' };
    assert.deepEqual(issues(schemaFor('set'), set), ['engineering_team']);
    assert.deepEqual(issues(schemaFor('set'), { ...set, engineering_team: 'core' }), []);
  });

  void it('validates workspace settings and inline registries', () => {
    const workspace = { schema_version: 1, title: 'Roadmap' };
    assert.deepEqual(
      issues(schemaFor('workspace'), {
        ...workspace,
        people: { alex: 'Alex', stevie: { name: 'Stevie', teams: ['core'] } },
        teams: { core: 'Core' },
        jira_base_url: 'https://example.atlassian.net',
      }),
      [],
    );
    assert.deepEqual(issues(schemaFor('workspace'), { ...workspace, schema_version: 2 }), [
      'schema_version',
    ]);
    assert.deepEqual(
      issues(schemaFor('workspace'), { ...workspace, jira_base_url: 'http://example.com' }),
      ['jira_base_url'],
    );
    assert.deepEqual(
      issues(schemaFor('workspace'), { ...workspace, teams: { core: { name: 'Core' } } }),
      ['teams.core'],
    );
  });

  void it('accepts names or profiles in external registries and still portraits as avatars', () => {
    assert.deepEqual(
      issues(schemaFor('people'), {
        alex: 'Alex Park',
        stevie: { name: 'Stevie', role: 'Engineer', avatar: 'people/stevie.jpeg', teams: ['web'] },
      }),
      [],
    );
    assert.deepEqual(issues(schemaFor('people'), { alex: { name: 'Alex', avatar: 'alex.gif' } }), [
      'alex.avatar',
    ]);
    assert.deepEqual(
      issues(schemaFor('teams'), { web: { name: 'Web', description: 'Site.' } }),
      [],
    );
    assert.deepEqual(issues(schemaFor('teams'), { web: { name: 'Web', lead: 'alex' } }), [
      'web.lead',
    ]);
  });
});
