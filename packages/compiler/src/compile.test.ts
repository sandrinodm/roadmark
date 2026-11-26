import type { Schema } from 'effect';
import type { TestContext } from 'node:test';

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { stringify } from 'yaml';

import { compile } from './compile.ts';

/**
 * The shared Atlas workspace, copied before each MDX test that edits it.
 */
const example = ATLAS_DIRECTORY;

/**
 * An Atlas MDX item extended by the MDX cases.
 */
const template = 'feature-sets/onboarding/items/starter-templates.mdx';

/**
 * Deployment base used by the Atlas cases.
 */
const base = '/products/atlas/';

const SET_FILE = 'feature-sets/first/README.md';
const ITEM_DIR = 'feature-sets/first/items';
const BASE = '/roadmap/demo/';
const OUTCOME = 'Readers can see what changed.';
const PARENT = {
  id: 'parent-id',
  title: 'Feature set',
  description: 'A useful set.',
  outcome: OUTCOME,
  pm: 'alex',
  engineering_team: 'core',
};
const ITEM = {
  title: 'Work item',
  description: 'A useful item.',
  outcome: OUTCOME,
  status: 'planned',
};
const RELEASE = {
  title: 'Release',
  description: 'A useful release.',
  outcome: OUTCOME,
  status: 'planned',
  target: '2028-Q1',
};
const WORKSPACE = {
  schema_version: 1,
  title: 'Test roadmap',
  people: { alex: 'Alex Park', stevie: 'Stevie Reed' },
  teams: { core: 'Core', web: 'Web' },
  jira_base_url: 'https://work.atlassian.net/',
};

void describe('compile', () => {
  void it('keeps stable IDs, date precision and independent ownership', async (test) => {
    const root = await workspace(test);
    await putItem(root, 'file-renamed', {
      id: 'item-stable',
      pm: 'stevie',
      target: '2028-Q1',
      start: '2028-02-29',
      jira: ['WEB-12'],
      contributors: ['alex'],
      contributing_teams: ['web'],
    });

    const result = await compile(root, BASE);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.workspace.jira_base_url, 'https://work.atlassian.net');

    const item = result.entities.find(({ id }) => id === 'item-stable');
    assert.ok(item);
    assert.equal(item.set, 'parent-id');
    assert.equal(item.pm, 'stevie');
    assert.equal(item.inherited_pm, undefined);
    assert.equal(item.engineering_team, 'core');
    assert.equal(item.inherited_engineering_team, true);
    assert.equal(item.start, '2028-02-29');
    assert.equal(item.target, '2028-Q1');
    assert.deepEqual(item.jira, ['WEB-12']);
    assert.deepEqual(item.contributors, ['alex']);
  });

  void it('retains each brief’s own links, including query strings and fragments', async (test) => {
    const root = await workspace(test);
    const setLinks = [
      {
        label: 'Confluence design',
        url: 'https://work.atlassian.net/wiki/spaces/D/pages/1#Decisions',
      },
      { label: 'Slack channel', url: 'https://app.slack.com/client/T123/C456' },
    ];
    const itemLinks = [
      { label: 'Repository', url: 'https://github.com/example/roadmap' },
      { label: 'Delivery board', url: 'https://jira.example.com/issues/?jql=project%3DX&filter=1' },
      { label: 'Team handbook', url: 'http://intranet.example/guide' },
    ];
    await frontMatter(root, SET_FILE, { ...PARENT, links: setLinks });
    await putItem(root, 'work', { id: 'work', links: itemLinks, jira: ['PM-1'] });
    await putItem(root, 'sibling', { id: 'sibling' });

    const { entities, diagnostics } = await compile(root);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(entities.find(({ kind }) => kind === 'set')?.links, setLinks);
    assert.deepEqual(entities.find(({ id }) => id === 'work')?.links, itemLinks);
    assert.deepEqual(entities.find(({ id }) => id === 'work')?.jira, ['PM-1']);
    assert.equal(entities.find(({ id }) => id === 'sibling')?.links, undefined);
  });

  void it('pinpoints invalid resource labels, URL schemes, credentials and malformed hosts', async (test) => {
    const root = await workspace(test);
    const file = ITEM_DIR + '/invalid.md';
    await frontMatter(root, file, {
      ...ITEM,
      id: 'invalid',
      links: [
        { label: ' ', url: 'https://example.com' },
        { label: 'Relative', url: '//example.com/doc' },
        { label: 'Script', url: 'javascript:alert(1)' },
        { label: 'Credentials', url: 'https://user:secret@example.com/doc' },
        { label: 'Invalid host', url: 'https://[invalid/' },
      ],
    });
    const { diagnostics } = await compile(root);
    const findings = diagnostics.filter((finding) => finding.file === file);
    assert.equal(findings.length, 5);
    assert.ok(findings.every(({ line, rule }) => line > 1 && rule === 'invalid-field'));
    assert.equal(new Set(findings.map(({ line }) => line)).size, 5);
  });

  void it('resolves external registries with shorthand and detailed entries', async (test) => {
    const root = await workspace(test);
    await put(root, 'roadmap.yaml', 'schema_version: 1\ntitle: Test roadmap\n');
    await put(
      root,
      'teams.yaml',
      'core: Core\nweb:\n  name: Web\n  description: Maintains the site.\n',
    );
    await put(
      root,
      'people.yaml',
      'alex: Alex Park\nstevie:\n  name: Stevie Reed\n  role: Engineer\n  teams: [core, web]\n',
    );
    await putItem(root, 'feature', { id: 'item-feature', contributors: ['stevie'] });

    const result = await compile(root);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.workspace.teams, { core: 'Core', web: 'Web' });
    assert.deepEqual(result.workspace.people, { alex: 'Alex Park', stevie: 'Stevie Reed' });
    assert.deepEqual(result.workspace.team_details, {
      web: { description: 'Maintains the site.' },
    });
    assert.deepEqual(result.workspace.person_details, {
      stevie: { role: 'Engineer', teams: ['core', 'web'] },
    });
    const item = result.entities.find(({ id }) => id === 'item-feature');
    assert.equal(item?.pm, 'alex');
    assert.deepEqual(item.contributors, ['stevie']);
  });

  void it('publishes one square thumbnail for shared portraits and reports bad avatar files at the field', async (test) => {
    const root = await workspace(test);
    await sharp({ create: { width: 48, height: 23, channels: 3, background: 'teal' } })
      .png()
      .toFile(join(root, 'portrait.png'));
    await put(
      root,
      'roadmap.yaml',
      stringify({
        ...WORKSPACE,
        people: {
          alex: { name: 'Alex Park', avatar: 'portrait.png' },
          stevie: { name: 'Stevie Reed', avatar: 'portrait.png' },
        },
      }),
    );
    const result = await compile(root);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.assets.length, 1);
    const [asset] = result.assets;
    assert.ok(asset?.bytes);
    const metadata = await sharp(asset.bytes).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 128, 128]);
    assert.match(asset.output, /^avatars\/[a-f0-9]{16}\.webp$/);
    assert.equal(result.workspace.person_details?.['alex']?.avatar, asset.output);
    assert.equal(result.workspace.person_details['stevie']?.avatar, asset.output);

    await put(root, 'roadmap.yaml', 'schema_version: 1\ntitle: Roadmap\nteams: {core: Core}\n');
    await put(root, 'people.yaml', 'alex:\n  name: Alex Park\n  avatar: bad.jpg\n');
    await put(root, 'bad.jpg', 'invalid image contents');
    const invalid = await compile(root);
    assert.deepEqual(invalid.assets, []);
    assert.deepEqual(
      invalid.diagnostics.map(({ rule, file, line }) => [rule, file, line]),
      [['unreadable-avatar', 'people.yaml', 3]],
    );
  });

  void it('checks team memberships and contributors at their source locations', async (test) => {
    const root = await workspace(test);
    await put(
      root,
      'roadmap.yaml',
      'schema_version: 1\ntitle: Test roadmap\nteams: { core: Core }\n',
    );
    await put(root, 'people.yaml', 'alex:\n  name: Alex Park\n  teams:\n    - missing\n');
    await putItem(root, 'feature', { id: 'item-feature', contributors: ['missing'] });

    const { diagnostics } = await compile(root);
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[0]?.file, `${ITEM_DIR}/feature.md`);
    assert.equal(diagnostics[0].rule, 'unknown-owner');
    assert.match(diagnostics[0].message, /people\.yaml/);
    assert.equal(diagnostics[1]?.rule, 'unknown-team');
    assert.equal(diagnostics[1].file, 'people.yaml');
    assert.equal(diagnostics[1].line, 4);
    assert.equal(diagnostics[1].column, 7);
    assert.match(diagnostics[1].message, /roadmap\.yaml/);
  });

  void it('rejects inline registries when the same external registry is present', async (test) => {
    const root = await workspace(test);
    await put(root, 'teams.yaml', 'core: Core\n');

    const { diagnostics } = await compile(root);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.rule, 'duplicate-registry');
    assert.equal(diagnostics[0].file, 'roadmap.yaml');
    assert.deepEqual(diagnostics[0].related, [{ file: 'teams.yaml', line: 1, column: 1 }]);
  });

  void it('points repeated registry IDs back to their first entries', async (test) => {
    const root = await workspace(test);
    await put(
      root,
      'roadmap.yaml',
      'schema_version: 1\ntitle: Test roadmap\nteams: { core: Core }\n',
    );
    await put(root, 'people.yaml', 'alex:\n  name: Alex Park\n  teams: [core, core]\n');
    const item = `${ITEM_DIR}/duplicate-references.md`;
    await put(
      root,
      item,
      [
        '---',
        'id: duplicate-references',
        'title: Duplicate references',
        'description: A useful item.',
        `outcome: ${OUTCOME}`,
        'status: planned',
        'contributors:',
        '  - alex',
        '  - alex',
        'contributing_teams: [core, core]',
        '---',
        '',
      ].join('\n'),
    );

    const { diagnostics } = await compile(root);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      Array(3).fill('duplicate-registry-reference'),
    );
    assert.deepEqual(
      diagnostics.map(({ file, line, column, related }) => ({ file, line, column, related })),
      [
        { file: item, line: 9, column: 5, related: [{ file: item, line: 8, column: 5 }] },
        { file: item, line: 10, column: 28, related: [{ file: item, line: 10, column: 22 }] },
        {
          file: 'people.yaml',
          line: 3,
          column: 17,
          related: [{ file: 'people.yaml', line: 3, column: 11 }],
        },
      ],
    );
  });

  void it('requires a source for each registry', async (test) => {
    const root = await workspace(test);
    await put(root, 'roadmap.yaml', 'schema_version: 1\ntitle: Test roadmap\npeople: {}\n');

    const { diagnostics } = await compile(root);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.rule, 'missing-registry');
    assert.equal(diagnostics[0].file, 'roadmap.yaml');
    assert.match(diagnostics[0].fix, /teams\.yaml/);
  });

  void it('rejects malformed external registry keys and entries at their source', async (test) => {
    const root = await workspace(test);
    await put(root, 'roadmap.yaml', 'schema_version: 1\ntitle: Test roadmap\n');
    await put(root, 'teams.yaml', 'Uppercase: Invalid ID\n');
    await put(root, 'people.yaml', 'alex:\n  name: Alex Park\n  unknown: typo\n');

    const { diagnostics } = await compile(root);
    const unknown = diagnostics.find(({ rule }) => rule === 'unknown-field');
    assert.equal(unknown?.file, 'people.yaml');
    assert.equal(unknown.line, 3);
    assert.equal(unknown.column, 3);
    const invalid = diagnostics.find(({ rule }) => rule === 'invalid-registry-id');
    assert.equal(invalid?.file, 'teams.yaml');
    assert.equal(invalid.line, 1);
  });

  void it('points strict YAML diagnostics to the offending keys', async (test) => {
    const root = await workspace(test);
    const item = `${ITEM_DIR}/dup.md`;
    await put(root, item, '---\nid: dup\nid: duplicate\n---\n');
    await putItem(root, 'unknown', { id: 'unknown', unknown_field: 'typo' });
    await putItem(root, 'nested', { id: 'nested', depends_on: [{ item: 'dep', because: 'typo' }] });

    const { diagnostics } = await compile(root);
    const duplicateKey = diagnostics.find(({ rule }) => rule === 'duplicate-yaml-key');
    assert.equal(duplicateKey?.file, item);
    assert.equal(duplicateKey.line, 3);
    assert.equal(duplicateKey.column, 1);

    const fields = diagnostics.filter(({ rule }) => rule === 'unknown-field');
    assert.deepEqual(
      fields.map(({ message }) => message.split(':')[0]),
      ['depends_on[0].because', 'unknown_field'],
    );
    assert.equal(fields[0]?.column, 5);
  });

  void it('reports duplicate IDs and missing or wrong-kind references', async (test) => {
    const root = await workspace(test);
    await frontMatter(root, 'releases/release.md', { ...RELEASE, id: 'repeated' });
    await putItem(root, 'a', { id: 'repeated' });
    await putItem(root, 'b', {
      id: 'b',
      release: 'parent-id',
      depends_on: [{ item: 'missing' }],
      engineering_team: 'unknown',
    });

    const { diagnostics } = await compile(root);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['wrong-reference-kind', 'unknown-reference', 'unknown-owner', 'duplicate-id'],
    );
    const duplicate = diagnostics.at(-1);
    assert.equal(duplicate?.file, 'releases/release.md');
    assert.deepEqual(duplicate.related, [{ file: `${ITEM_DIR}/a.md`, column: 1, line: 6 }]);
  });

  void it('rejects impossible dates and release schedule conflicts', async (test) => {
    const root = await workspace(test);
    await frontMatter(root, 'releases/a.md', { ...RELEASE, id: 'release-a', start: '2028-04-01' });
    await frontMatter(root, 'releases/b.md', { ...RELEASE, id: 'release-b', status: 'shipped' });
    await putItem(root, 'range', { id: 'range', start: '2028-05-01', target: '2028-04' });
    await putItem(root, 'invalid', {
      id: 'invalid',
      release: 'release-b',
      start: '2027-02-29',
    });

    const { diagnostics } = await compile(root);
    const issues = diagnostics.map(({ severity, rule }) => [severity, rule]);
    assert.deepEqual(issues, [
      ['warning', 'shipped-release-open-item'],
      ['error', 'invalid-date'],
      ['error', 'invalid-schedule'],
      ['error', 'invalid-schedule'],
      ['error', 'missing-shipped-on'],
    ]);
  });

  void it('reports cycles and disjoint prerequisite target windows', async (test) => {
    const root = await workspace(test);
    await putItem(root, 'a', {
      id: 'a',
      status: 'done',
      start: '2028-03-02',
      depends_on: [{ item: 'b' }, { item: 'c' }],
    });
    await putItem(root, 'b', { id: 'b', target: '2028-Q2', depends_on: [{ item: 'a' }] });
    await putItem(root, 'c', { id: 'c', target: '2028-Q1', status: 'done' });
    await putItem(root, 'd', { id: 'd', depends_on: [{ item: 'd' }] });
    await putItem(root, 'e', { id: 'e', target: '2028-03', depends_on: [{ item: 'b' }] });
    await putItem(root, 'f', { id: 'f', target: '2028-04', depends_on: [{ item: 'b' }] });

    const { diagnostics } = await compile(root);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      [
        'dependency-schedule-conflict',
        'incomplete-dependency',
        'dependency-cycle',
        'dependency-cycle',
        'dependency-schedule-conflict',
      ],
    );
    assert.match(diagnostics[2]?.message ?? '', /a → b → a/);
    assert.match(diagnostics[3]?.message ?? '', /d → d/);
    assert.equal(diagnostics[0]?.related?.length, 2);
    assert.match(diagnostics[4]?.message ?? '', /after this item’s target window/);
  });

  void it('fails workspaces that still use milestones or team requests and says what to delete', async (test) => {
    const root = await workspace(test);
    await mkdir(join(root, 'milestones'));
    await putItem(root, 'old', {
      id: 'old',
      milestone: 'beta',
      completed_on: '2028-01-02',
      team_dependencies: [{ team: 'web', need: 'Review copy.', status: 'open' }],
    });

    const { diagnostics } = await compile(root);
    const removed = diagnostics.map(({ severity, rule, message, fix }) => [
      severity,
      rule,
      message,
      fix,
    ]);
    assert.deepEqual(
      removed.map(([severity, rule]) => [severity, rule]),
      [
        ['error', 'removed-field'],
        ['error', 'removed-field'],
        ['error', 'removed-field'],
        ['error', 'removed-milestones'],
      ],
    );
    const text = removed.map((entry) => entry.join(' ')).join('\n');
    assert.match(text, /milestone: Milestones are no longer part of the roadmap format/);
    assert.match(text, /team_dependencies: Team requests are no longer part of the roadmap format/);
    assert.match(text, /Delete the milestones\/ folder/);
    assert.equal(diagnostics.at(-1)?.file, 'milestones');
  });

  void it('rewrites links and anchors and renders GFM with escaped HTML', async (test) => {
    const root = await workspace(test);
    await putItem(
      root,
      'details',
      { id: 'stable-details' },
      [
        '## Café',
        '',
        '### Main',
        '',
        '## Café',
        '',
        '[Reserved anchor](#main)',
        '',
        '| Name | State |',
        '| :--- | ---: |',
        '| Step | **Done** |',
        '',
        '- [x] ~Complete~',
        '',
        '<script>alert("escaped")</script>',
        '',
        '+ Note[^n]',
        '',
        '[^n]: Text.',
      ].join('\n'),
    );
    await putItem(
      root,
      'linker',
      { id: 'links' },
      '[Details][details]\n\n[details]: details.md#caf%C3%A9-1',
    );

    const { entities, diagnostics } = await compile(root, BASE);
    assert.deepEqual(diagnostics, []);

    const html = entities.find(({ id }) => id === 'stable-details')?.html ?? '';
    assert.match(html, /id="café-1"/);
    assert.match(html, /id="heading:main"/);
    assert.match(html, /href="#heading%3Amain"/);
    assert.match(html, /<table>/);
    assert.match(html, /<del>Complete<\/del>/);
    assert.match(html, /disabled checked/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /href="#footnote:[\w-]+"/);

    const linked = entities.find(({ id }) => id === 'links');
    assert.ok(linked?.html.includes(`href="${BASE}items/stable-details/#caf%C3%A9-1"`));
  });

  void it('reports unsafe and unresolved links at their Markdown lines', async (test) => {
    const root = await workspace(test);
    await put(root, 'file.png', 'private');
    await symlink(join(root, 'file.png'), join(root, ITEM_DIR, 'shortcut.png'));
    await putItem(
      root,
      'unsafe',
      { id: 'unsafe' },
      [
        '[Bad](javascript:alert%281%29)',
        '[Outside](../../../../file.png)',
        '[Absent](#missing)',
        '[Bad media](shortcut.png)',
        '[Missing document](nothing.md)',
      ].join('\n'),
    );

    const { diagnostics, assets } = await compile(root);
    const lint = diagnostics.filter(({ file }) => file.endsWith('/unsafe.md'));
    assert.deepEqual(
      lint.map(({ rule }) => rule),
      ['unsafe-url', 'unsafe-url', 'broken-anchor', 'unreadable-asset', 'broken-markdown-link'],
    );
    assert.deepEqual(
      lint.map(({ line }) => line),
      [8, 9, 10, 11, 12],
    );
    assert.deepEqual(assets, []);
  });

  void it('fingerprints media and embeds standalone captioned videos', async (test) => {
    const root = await workspace(test);
    const imagePath = `${ITEM_DIR}/preview.png`;
    await sharp({ create: { width: 6, height: 4, channels: 3, background: '#113366' } })
      .png()
      .toFile(join(root, imagePath));
    await put(root, `${ITEM_DIR}/demo.mp4`, 'video bytes');
    await put(root, `${ITEM_DIR}/demo.en.vtt`, 'WEBVTT\n\n');
    await put(root, `${ITEM_DIR}/demo.en-x.vtt`, 'WEBVTT\n\n');
    await putItem(
      root,
      'media',
      { id: 'media-demo' },
      [
        '![Preview](preview.png)',
        '',
        'See this [video](demo.mp4) for details.',
        '',
        '[Walkthrough](demo.mp4)',
      ].join('\n'),
    );

    const { assets, diagnostics, entities } = await compile(root, BASE);
    assert.deepEqual(diagnostics, []);
    assert.equal(assets.length, 3);

    const html = entities.find(({ id }) => id === 'media-demo')?.html ?? '';
    assert.match(html, /<figure><a href="[^"]+"><img[^>]+width="6" height="4"/);
    assert.match(html, /<video controls preload="none"/);
    assert.match(html, /srclang="en"/);
    assert.ok(html.includes(`src="${BASE}media/`));
    assert.equal(html.match(/<video\b/g)?.length, 1);
    assert.match(html, / download>Download video/);
  });

  void it('warns about misplaced Markdown, missing alt text and missing captions', async (test) => {
    const root = await workspace(test);
    await put(root, 'feature-sets/first/explainer.md', '# Not a roadmap document');
    await put(root, `${ITEM_DIR}/uncaptioned.webm`, 'video bytes');
    await putItem(
      root,
      'warnings',
      { id: 'warnings' },
      ['![](image.png)', '', '[Demo](uncaptioned.webm)'].join('\n'),
    );
    await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
      .png()
      .toFile(join(root, ITEM_DIR, 'image.png'));

    const { diagnostics } = await compile(root);
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['misplaced-markdown', 'missing-alt', 'missing-captions'],
    );
    assert.ok(diagnostics.every(({ severity }) => severity === 'warning'));
  });

  void it('does not report unregistered owners when the registry fails to load', async (test) => {
    const root = await workspace(test);
    await put(root, 'roadmap.yaml', 'title: broken\n');

    const { diagnostics } = await compile(root);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics.every(({ file }) => file === 'roadmap.yaml'));
  });
});

void describe('compile with MDX', () => {
  void it('uses MDX for every document kind and detects two feature-set definitions', async (t) => {
    const root = await fixture(t);
    for (const name of ['feature-sets/billing/README', 'releases/summer']) {
      await rename(join(root, name + '.md'), join(root, name + '.mdx'));
    }

    let result = await compile(root);
    assert.deepEqual(result.diagnostics, []);
    const set = join(root, 'feature-sets/billing/README');
    await writeFile(
      set + '.md',
      (await readFile(set + '.mdx', 'utf8')).replace('id: set-billing', 'id: set-another'),
    );
    result = await compile(root);
    assert.ok(result.diagnostics.some((row) => row.rule === 'duplicate-feature-set-readme'));
  });

  void it('reports invalid MDX, missing includes and invalid Mermaid at their authored files', async (t) => {
    const root = await fixture(t);
    await appendFile(join(root, template), '\n<Risk>{broken + }</Risk>\n');
    const markdown = join(root, 'feature-sets/onboarding/items/guided-setup.md');
    const original = await readFile(markdown, 'utf8');
    await appendFile(
      markdown,
      '\n```ts src="../missing.ts"\n```\n\n```mermaid\nunknownDiagram\n```\n',
    );
    const { diagnostics } = await compile(root);
    const mdx = diagnostics.find((record) => record.rule === 'mdx');
    assert.equal(mdx?.file, template);
    assert.ok(mdx.line > 20);
    const fences = diagnostics.filter((record) => record.rule === 'code-block');
    assert.equal(fences.length, 2);
    assert.ok(
      fences.every(
        (record) =>
          record.file.endsWith('/guided-setup.md') && record.line > original.split('\n').length,
      ),
    );
  });

  void it('executes MDX documents one at a time in discovery order', async (t) => {
    const root = await fixture(t);
    const counter = 'roadmapMdxOrder';
    Reflect.deleteProperty(globalThis, counter);
    t.after(() => Reflect.deleteProperty(globalThis, counter));
    await mkdir(join(root, 'components'));
    await writeFile(
      join(root, 'components/label.tsx'),
      [
        'export function Label() {',
        `  globalThis.${counter} = (globalThis.${counter} ?? 0) + 1;`,
        `  return <span>Label {globalThis.${counter}}</span>;`,
        '}',
      ].join('\n'),
    );
    // The first document in discovery order is much slower to compile than the second.
    const first = join(root, 'feature-sets/billing/README');
    await rename(first + '.md', first + '.mdx');
    const filler = Array.from({ length: 4000 }, (_, index) => `Paragraph **${index}** of filler.`);
    await appendFile(
      first + '.mdx',
      ["\nimport { Label } from '../../components/label.tsx'\n", ...filler, '\n<Label />\n'].join(
        '\n\n',
      ),
    );
    await appendFile(
      join(root, template),
      "\nimport { Label } from '../../../components/label.tsx'\n\n<Label />\n",
    );
    const model = await compile(root, base);
    assert.deepEqual(model.diagnostics, []);
    const html = (id: string) => model.entities.find((record) => record.id === id)?.html ?? '';
    assert.match(html('set-billing'), /Label 1/);
    assert.match(html('item-starter-templates'), /Label 2/);
  });
});

/**
 * Copies the Atlas workspace to a temporary directory removed after the test.
 */
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-mdx-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(example, root, { recursive: true });
  return root;
}

async function workspace(test: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-compiler-'));
  test.after(() => rm(root, { recursive: true, force: true }));

  await put(root, 'roadmap.yaml', stringify(WORKSPACE));
  await frontMatter(root, SET_FILE, PARENT);
  await mkdir(join(root, ITEM_DIR));
  return root;
}

type FrontMatter = Record<string, Schema.Json>;

async function putItem(root: string, name: string, data: FrontMatter, body = ''): Promise<void> {
  await frontMatter(root, `${ITEM_DIR}/${name}.md`, { ...ITEM, ...data }, body);
}

async function frontMatter(
  root: string,
  file: string,
  data: FrontMatter,
  body = '',
): Promise<void> {
  await put(root, file, `---\n${stringify(data)}---\n${body}\n`);
}

async function put(root: string, file: string, content: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
