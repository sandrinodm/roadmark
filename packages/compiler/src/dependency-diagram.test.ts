import type { TestContext } from 'node:test';

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Entity } from './model.ts';

import { compile } from './compile.ts';
import { dependencyDiagram } from './dependency-diagram.ts';

/**
 * The shared Atlas workspace, copied before each test that edits it.
 */
const example = ATLAS_DIRECTORY;

/**
 * An Atlas MDX item that embeds the diagram component.
 */
const template = 'feature-sets/onboarding/items/starter-templates.mdx';

/**
 * Deployment base used for item routes.
 */
const base = '/products/atlas/';

/**
 * Copies the Atlas workspace to a temporary directory removed after the test.
 */
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'roadmap-mdx-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(example, root, { recursive: true });
  return root;
}

/**
 * Builds a compiled entity with only the fields the diagram reads.
 */
function entity(fields: Partial<Entity> & Pick<Entity, 'id'>): Entity {
  return {
    kind: 'item',
    title: fields.id,
    description: '',
    source: `items/${fields.id}.md`,
    html: '',
    text: '',
    contributing_teams: [],
    depends_on: [],
    jira: [],
    ...fields,
  };
}

/**
 * Returns the list markup of one labelled diagram column.
 */
function column(html: string, label: string): string {
  return html.split(`<strong>${label}</strong>`)[1]?.split('</div>')[0] ?? '';
}

void describe('dependencyDiagram', () => {
  void it('derives upstream and downstream diagram links from item relationships', async (t) => {
    const root = await fixture(t);
    await appendFile(path.join(root, template), '\n<DependencyDiagram />\n');
    const prerequisite = path.join(root, 'feature-sets/platform/items/setup-events.md');
    await appendFile(prerequisite, '\n```roadmap-dependencies\n```\n');
    const model = await compile(root, base);
    assert.deepEqual(model.diagnostics, []);
    const upstream = model.entities
      .find((item) => item.id === 'item-guided-setup')
      ?.html.split('class="dependency-diagram"')[1];
    const downstream = model.entities
      .find((item) => item.id === 'item-setup-events')
      ?.html.split('class="dependency-diagram"')[1];
    assert.ok(upstream?.includes(base + 'items/item-setup-events/'));
    assert.ok(downstream?.includes(base + 'items/item-guided-setup/'));
    assert.match(
      model.entities.find((item) => item.id === 'item-starter-templates')?.html ?? '',
      /No prerequisites/,
    );
  });

  void it('lists prerequisites with their reasons, the item itself and its dependents', () => {
    const entities = [
      entity({ id: 'events', title: 'Event pipeline' }),
      entity({
        id: 'setup',
        title: 'Guided setup',
        depends_on: [{ item: 'events', reason: 'Needs <signals> & logs' }, { item: 'missing' }],
      }),
      entity({ id: 'templates', title: 'Templates', depends_on: [{ item: 'setup' }] }),
      entity({
        id: 'reports',
        title: 'Reports',
        depends_on: [{ item: 'setup', reason: 'Counts' }],
      }),
    ];
    const html = dependencyDiagram(entities, 'items/setup.md', '/base/');
    assert.match(html, /^<figure class="dependency-diagram"><figcaption>Item dependencies/);
    assert.equal(
      column(html, 'Prerequisites'),
      '<ul><li><a href="/base/items/events/">Event pipeline</a><p>Needs &lt;signals&gt; &amp; logs</p></li></ul>',
    );
    assert.equal(
      column(html, 'This item'),
      '<ul><li><a href="/base/items/setup/">Guided setup</a></li></ul>',
    );
    assert.equal(
      column(html, 'Enables'),
      '<ul><li><a href="/base/items/templates/">Templates</a></li><li><a href="/base/items/reports/">Reports</a><p>Counts</p></li></ul>',
    );
  });

  void it('names the empty states and escapes titles, IDs and the base', () => {
    const html = dependencyDiagram(
      [entity({ id: 'a&b', title: 'Fish & <chips>' })],
      'items/a&b.md',
      '/x"y/',
    );
    assert.equal(column(html, 'Prerequisites'), '<p>No prerequisites</p>');
    assert.equal(column(html, 'Enables'), '<p>No dependent items</p>');
    assert.equal(
      column(html, 'This item'),
      '<ul><li><a href="/x&quot;y/items/a%26b/">Fish &amp; &lt;chips&gt;</a></li></ul>',
    );
  });

  void it('belongs only in a roadmap item', () => {
    const entities = [entity({ id: 'set', kind: 'set', source: 'sets/set.md' })];
    assert.throws(
      () => dependencyDiagram(entities, 'sets/set.md', '/'),
      /belongs in a roadmap item/,
    );
    assert.throws(
      () => dependencyDiagram(entities, 'unknown.md', '/'),
      /belongs in a roadmap item/,
    );
  });
});
