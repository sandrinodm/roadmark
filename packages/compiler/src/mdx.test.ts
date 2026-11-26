import type { Root, RootContent } from 'mdast';
import type { TestContext } from 'node:test';

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import { Predicate } from 'effect';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { compile } from './compile.ts';
import { bundleMdx, runMdx } from './mdx.ts';

/**
 * The shared Atlas workspace, copied before each test that edits it.
 */
const example = ATLAS_DIRECTORY;

/**
 * An Atlas MDX item extended by the pipeline cases.
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
 * Creates an empty directory for a standalone MDX document, removed after the test.
 */
async function directory(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'roadmap-mdx-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Bundles and runs one MDX document stored at `brief.mdx` in the given directory.
 */
async function run(root: string, body: string): Promise<Root> {
  const filename = path.join(root, 'brief.mdx');
  return runMdx(await bundleMdx(body, filename), filename);
}

/**
 * Lists every node of a tree in document order.
 */
function nodes(node: Root | RootContent): Array<Root | RootContent> {
  return [node, ...('children' in node ? node.children.flatMap(nodes) : [])];
}

/**
 * Concatenates the text of a tree.
 */
function text(tree: Root): string {
  return nodes(tree)
    .map((node) => (node.type === 'text' ? node.value : ''))
    .join('');
}

/**
 * The language and options of a fence, or the URL of a link or image.
 */
function destination(node: Root | RootContent): Array<string | null | undefined> {
  if (node.type === 'code') {
    return [node.lang, node.meta];
  }

  return 'url' in node ? [node.url] : [];
}

void describe('MDX pipeline', () => {
  void it('compiles MDX components, expressions and partials afresh and indexes the rendered text', async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, 'components'));
    const component = path.join(root, 'components/cohort.tsx');
    await writeFile(
      component,
      'export function Cohort({n}: {n: number}) { return <strong>First {n} pilots</strong> }',
    );
    await writeFile(
      path.join(root, 'components/evidence.mdx'),
      '<Risk>Reread the evidence after launch.</Risk>',
    );
    await appendFile(
      path.join(root, template),
      [
        '',
        "import { Cohort } from '../../../components/cohort.tsx'",
        "import Evidence from '../../../components/evidence.mdx'",
        '',
        '## Results for {interviewCount} teams',
        '',
        '<Cohort n={interviewCount} />',
        '',
        '<Evidence />',
        '',
        'Check the data.[^cohort]',
        '',
        '[^cohort]: Beta workspace counts.',
        '',
      ].join('\n'),
    );
    await appendFile(
      path.join(root, 'feature-sets/onboarding/items/guided-setup.md'),
      '\n[Review interview results](./starter-templates.mdx#results-for-6-teams)\n',
    );
    const model = await compile(root, base);
    assert.deepEqual(model.diagnostics, []);
    const item = model.entities.find((record) => record.id === 'item-starter-templates');
    assert.ok(item);
    assert.match(item.html, /id="results-for-6-teams"/);
    assert.match(item.html, /First 6 pilots/);
    assert.match(item.html, /class="shiki/);
    assert.match(item.html, /verify-events/);
    assert.match(item.text, /Reread the evidence/);
    assert.match(item.text, /First 6 pilots/);
    assert.ok(
      model.entities
        .find((record) => record.id === 'item-guided-setup')
        ?.html.includes(base + 'items/item-starter-templates/#results-for-6-teams'),
    );
    const diagram = [...(model.diagrams?.values() ?? [])][0];
    assert.match(diagram ?? '', /<svg[\s>]/);
    // Diagram files are named after their published bytes, so a restyled drawing gets a new URL.
    for (const [name, svg] of model.diagrams ?? []) {
      const digest = createHash('sha256').update(svg).digest('hex').slice(0, 24);
      assert.equal(name, 'diagrams/' + digest + '.svg');
    }

    // The image carries the drawing's natural size, so the page does not stretch it to the column.
    assert.match(item.html, /<img src="[^"]+\.svg" alt="[^"]*" width="\d+" height="\d+"/);

    await writeFile(component, 'export function Cohort() { return <b>Second cohort</b> }');
    const rebuilt = await compile(root, base);
    assert.ok(
      rebuilt.entities.find((record) => record.id === item.id)?.html.includes('Second cohort'),
    );
  });

  void it('locates an invalid MDX source include at the component invocation', async (t) => {
    const root = await fixture(t);
    const filename = path.join(root, template);
    const original = await readFile(filename, 'utf8');
    await writeFile(filename, original + '\n<Code src="../missing.ts" />\n');
    const model = await compile(root);
    const problem = model.diagnostics.find((row) => row.rule === 'code-block');
    assert.equal(problem?.file, template);
    assert.equal(problem.line, original.split('\n').length + 1);
  });
});

void describe('bundleMdx and runMdx', () => {
  void it('evaluates exports and expressions into a Markdown tree', async (t) => {
    const tree = await run(
      await directory(t),
      'export const count = 3\n\n## Count {count * 2}\n\nPlain **bold** text.',
    );
    const heading = tree.children.find((node) => node.type === 'heading');
    assert.equal(heading?.type === 'heading' && heading.depth, 2);
    assert.match(text(tree), /Count 6/);
    assert.match(text(tree), /Plain bold text\./);
  });

  void it('provides the roadmap callouts, titled or named after their kind', async (t) => {
    const tree = await run(
      await directory(t),
      '<Decision>Ship it.</Decision>\n\n<Risk title="Watch out">Data loss.</Risk>\n\n<Outcome>Done.</Outcome>',
    );
    const callouts = tree.children.filter((node) => node.type === 'roadmapElement');
    assert.deepEqual(
      callouts.map((node) => node.open),
      Array(3).fill('<aside class="roadmap-callout">'),
    );
    assert.match(text(tree), /DecisionShip it\./);
    assert.match(text(tree), /Watch outData loss\./);
    assert.match(text(tree), /OutcomeDone\./);
  });

  void it('records the source position of fences, links, images and code components', async (t) => {
    const tree = await run(
      await directory(t),
      [
        '# Brief',
        '',
        '```ts title="a.ts"',
        'const a = 1;',
        '```',
        '',
        'See [the plan](plan.md) and ![chart](chart.png).',
        '',
        '<Code src="../src/a.ts" title="Source" />',
        '',
        '<DependencyDiagram />',
        '',
        '<Mermaid>{`flowchart LR\nA --> B`}</Mermaid>',
      ].join('\n'),
    );
    const located = nodes(tree).flatMap((node) => {
      const start = node.position?.start;
      if (start === undefined) {
        return [];
      }

      return [[node.type, start.line, start.column, ...destination(node)]];
    });
    assert.deepEqual(located, [
      ['code', 3, 1, 'ts', 'title="a.ts"'],
      ['link', 7, 5, 'plan.md'],
      ['image', 7, 29, 'chart.png'],
      ['code', 9, 1, '', 'src="../src/a.ts" title="Source"'],
      ['code', 11, 1, 'roadmap-dependencies', ''],
      ['code', 13, 1, 'mermaid', ''],
    ]);
    const mermaid = nodes(tree).findLast((node) => node.type === 'code');
    assert.equal(mermaid?.type === 'code' && mermaid.value, 'flowchart LR\nA --> B');
  });

  void it('bundles local components and MDX partials from the document folder', async (t) => {
    const root = await directory(t);
    await writeFile(
      path.join(root, 'badge.tsx'),
      'export const Badge = ({ label }: { label: string }) => <mark>{label}</mark>;',
    );
    await writeFile(path.join(root, 'part.mdx'), 'Partial with <Risk>a callout</Risk>.');
    const tree = await run(
      root,
      "import { Badge } from './badge.tsx'\nimport Part from './part.mdx'\n\n<Badge label=\"New\" />\n\n<Part />",
    );
    assert.ok(nodes(tree).some((node) => node.type === 'roadmapElement' && node.open === '<mark>'));
    assert.match(text(tree), /New/);
    assert.match(text(tree), /Partial with Riska callout\./);
  });

  void it('rejects invalid MDX with the line and column of the problem', async (t) => {
    const filename = path.join(await directory(t), 'brief.mdx');
    await assert.rejects(bundleMdx('# Title\n\n<Risk>{broken + }</Risk>\n', filename), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(Predicate.hasProperty(error, 'line') && Predicate.hasProperty(error, 'column'));
      assert.equal(error.line, 3);
      assert.equal(typeof error.column, 'number');
      return true;
    });
  });

  void it('rejects a missing import', async (t) => {
    const filename = path.join(await directory(t), 'brief.mdx');
    await assert.rejects(
      bundleMdx("import X from './absent.tsx'\n\n<X />", filename),
      /absent\.tsx/,
    );
  });

  void it('requires the compiled module to export a component', () => {
    assert.throws(
      () => runMdx('module.exports = {};', path.join(tmpdir(), 'empty.mdx')),
      /export a component/,
    );
  });
});
