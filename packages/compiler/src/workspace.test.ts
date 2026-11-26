import type { TestContext } from 'node:test';

import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';

import type { Diagnostic } from './model.ts';
import type { Position } from './source.ts';

import { readWorkspace, uniqueRegistryIds } from './workspace.ts';

/**
 * Creates a temporary workspace with the given files, removed after the test.
 */
async function workspace(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-workspace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(root, file), content);
  }

  return root;
}

/**
 * Reads the workspace settings and registries, collecting diagnostics.
 */
async function read(root: string) {
  const diagnostics: Array<Diagnostic> = [];
  const result = await Effect.runPromise(readWorkspace(root, diagnostics));
  return { result, diagnostics };
}

/**
 * Reduces diagnostics to their rule and source location.
 */
function located(diagnostics: Array<Diagnostic>): Array<[string, string, number, number]> {
  return diagnostics.map(({ rule, file, line, column }) => [rule, file, line, column]);
}

void describe('readWorkspace', () => {
  void it('resolves inline registries and normalizes the Jira base URL', async (t) => {
    const root = await workspace(t, {
      'roadmap.yaml': [
        'schema_version: 1',
        'title: Atlas',
        'people:',
        '  alex: Alex Park',
        '  stevie: { name: Stevie Reed, role: Engineer, teams: [core] }',
        'teams: { core: Core }',
        'jira_base_url: https://example.atlassian.net/jira//',
      ].join('\n'),
    });
    const { result, diagnostics } = await read(root);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(result, {
      workspace: {
        schema_version: 1,
        title: 'Atlas',
        people: { alex: 'Alex Park', stevie: 'Stevie Reed' },
        teams: { core: 'Core' },
        person_details: { stevie: { role: 'Engineer', teams: ['core'] } },
        jira_base_url: 'https://example.atlassian.net/jira',
      },
      avatars: [],
      registryFiles: { people: 'roadmap.yaml', teams: 'roadmap.yaml' },
    });
  });

  void it('reads external registries and records where each one comes from', async (t) => {
    const root = await workspace(t, {
      'roadmap.yaml': 'schema_version: 1\ntitle: Atlas\npeople: { alex: Alex }\n',
      'teams.yaml': 'core: Core\nweb:\n  name: Web\n  description: Site.\n',
    });
    const { result, diagnostics } = await read(root);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(result?.registryFiles, { people: 'roadmap.yaml', teams: 'teams.yaml' });
    assert.deepEqual(result.workspace.teams, { core: 'Core', web: 'Web' });
    assert.deepEqual(result.workspace.team_details, { web: { description: 'Site.' } });
    assert.equal(result.workspace.person_details, undefined);
    assert.equal(result.workspace.jira_base_url, undefined);
  });

  void it('rejects a registry declared twice or not at all', async (t) => {
    const root = await workspace(t, {
      'roadmap.yaml': 'schema_version: 1\ntitle: Atlas\npeople: { alex: Alex }\n',
      'people.yaml': 'alex: Alex\n',
    });
    const { result, diagnostics } = await read(root);
    assert.equal(result, undefined);
    assert.deepEqual(located(diagnostics), [
      ['duplicate-registry', 'roadmap.yaml', 3, 1],
      ['missing-registry', 'roadmap.yaml', 1, 1],
    ]);
    assert.deepEqual(diagnostics[0]?.related, [{ file: 'people.yaml', line: 1, column: 1 }]);
    assert.match(diagnostics[1]?.fix ?? '', /create teams\.yaml/);
  });

  void it('returns nothing when the settings cannot be read', async (t) => {
    const missing = await workspace(t, {});
    const absent = await read(missing);
    assert.equal(absent.result, undefined);
    assert.deepEqual(located(absent.diagnostics), [['unreadable-source', 'roadmap.yaml', 1, 1]]);

    const invalid = await workspace(t, { 'roadmap.yaml': 'title: Atlas\n' });
    const broken = await read(invalid);
    assert.equal(broken.result, undefined);
    assert.deepEqual(
      broken.diagnostics.map(({ rule }) => rule),
      ['invalid-field'],
    );
  });

  void it('rejects Jira base URLs with credentials, queries, fragments or spaces', async (t) => {
    for (const url of [
      'https://user:pass@example.atlassian.net',
      'https://example.atlassian.net/?project=X',
      'https://example.atlassian.net/#board',
      'https://example.atlassian.net/my jira',
      'https://',
    ]) {
      const root = await workspace(t, {
        'roadmap.yaml': `schema_version: 1\ntitle: Atlas\npeople: {}\nteams: {}\njira_base_url: "${url}"\n`,
      });
      const { result, diagnostics } = await read(root);
      assert.deepEqual(
        located(diagnostics),
        [['invalid-jira-base-url', 'roadmap.yaml', 5, 1]],
        url,
      );
      assert.equal(result?.workspace.jira_base_url, undefined, url);
    }
  });

  void it('checks team memberships against the resolved teams registry', async (t) => {
    const root = await workspace(t, {
      'roadmap.yaml': 'schema_version: 1\ntitle: Atlas\n',
      'teams.yaml': 'core: Core\n',
      'people.yaml': 'alex:\n  name: Alex\n  teams: [core, mobile, core]\n',
    });
    const { result, diagnostics } = await read(root);
    assert.ok(result);
    assert.deepEqual(located(diagnostics), [
      ['unknown-team', 'people.yaml', 3, 17],
      ['duplicate-registry-reference', 'people.yaml', 3, 25],
    ]);
    assert.match(diagnostics[0]?.message ?? '', /missing from the teams registry in teams\.yaml/);
  });

  void it('publishes avatar thumbnails and points person details at them', async (t) => {
    const root = await workspace(t, {
      'roadmap.yaml': 'schema_version: 1\ntitle: Atlas\nteams: {}\n',
      'people.yaml': 'alex:\n  name: Alex\n  avatar: alex.png\n',
    });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toFile(join(root, 'alex.png'));
    const { result, diagnostics } = await read(root);
    assert.deepEqual(diagnostics, []);
    assert.equal(result?.avatars.length, 1);
    assert.equal(result.workspace.person_details?.['alex']?.avatar, result.avatars[0]?.output);
  });
});

/**
 * Locates a list entry on line 10 plus its index, in a column equal to the path depth.
 */
function indexField(path: ReadonlyArray<PropertyKey>): Position {
  return { file: 'item.md', line: 10 + Number(path.at(-1)), column: path.length };
}

void describe('uniqueRegistryIds', () => {
  void it('yields the first occurrence of each ID and reports repeats against it', () => {
    const diagnostics: Array<Diagnostic> = [];
    const unique = [
      ...uniqueRegistryIds(['a', 'b', 'a', 'a', 'c'], ['contributors'], indexField, diagnostics),
    ];
    assert.deepEqual(unique, [
      [0, 'a'],
      [1, 'b'],
      [4, 'c'],
    ]);
    assert.deepEqual(
      diagnostics.map(({ rule, line, column, related, message }) => [
        rule,
        line,
        column,
        related,
        message,
      ]),
      [
        [
          'duplicate-registry-reference',
          12,
          2,
          [{ file: 'item.md', line: 10, column: 2 }],
          '"a" is already listed here.',
        ],
        [
          'duplicate-registry-reference',
          13,
          2,
          [{ file: 'item.md', line: 10, column: 2 }],
          '"a" is already listed here.',
        ],
      ],
    );
  });

  void it('yields nothing for an empty list', () => {
    const diagnostics: Array<Diagnostic> = [];
    assert.deepEqual([...uniqueRegistryIds([], ['teams'], indexField, diagnostics)], []);
    assert.deepEqual(diagnostics, []);
  });
});
