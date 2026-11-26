import type { Code } from 'mdast';
import type { TestContext } from 'node:test';

import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Diagnostic, Entity } from './model.ts';
import type { Position } from './source.ts';

import { CodeBlocks, drawingSize } from './code-blocks.ts';
import { compile } from './compile.ts';

/**
 * The shared Atlas workspace, copied before each test that edits it.
 */
const example = ATLAS_DIRECTORY;

/**
 * Deployment base used for item routes.
 */
const base = '/products/atlas/';

/**
 * Where each fence is found: a line inside an item brief.
 */
const AT: Position = { file: 'items/brief.md', line: 9, column: 1 };

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
 * Creates a workspace with a source file next to the brief, removed after the test.
 */
async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'roadmap-code-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'items'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/setup.py'), 'print("<setup>")\n');
  return root;
}

/**
 * Builds a fenced code node.
 */
function fence(value: string, lang: string | null = null, meta: string | null = null): Code {
  return { type: 'code', lang, meta, value };
}

/**
 * Renders one fence and returns its markup with the diagnostics it produced.
 */
async function render(blocks: CodeBlocks, node: Code, at = AT) {
  const diagnostics: Array<Diagnostic> = [];
  const html = await blocks.render(node, at, base, diagnostics);
  return { html, diagnostics };
}

void describe('CodeBlocks', () => {
  void it('publishes sequence and Gantt diagrams from ordinary Markdown', async (t) => {
    const root = await fixture(t);
    await appendFile(
      path.join(root, 'releases/summer.md'),
      [
        '',
        '```mermaid title="Rollout handoff"',
        'sequenceDiagram',
        '  Growth->>Platform: Ready for pilot',
        '```',
        '',
        '```mermaid title="Rollout window"',
        'gantt',
        '  dateFormat YYYY-MM-DD',
        '  Pilot :p, 2027-07-01, 2d',
        '```',
        '',
      ].join('\n'),
    );
    const model = await compile(root, base);
    assert.deepEqual(model.diagnostics, []);
    assert.equal(model.diagrams?.size, 3);
    assert.match(
      model.entities.find((record) => record.id === 'rel-summer')?.html ?? '',
      /Rollout handoff/,
    );
  });

  void it('escapes plain text and unknown languages instead of highlighting them', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    for (const lang of [null, 'text', 'plaintext', 'no-such-language']) {
      const { html, diagnostics } = await render(blocks, fence('<b>&</b>', lang));
      assert.equal(html, '<pre><code>&lt;b&gt;&amp;&lt;/b&gt;\n</code></pre>', String(lang));
      assert.deepEqual(diagnostics, []);
    }
  });

  void it('highlights known languages and aliases', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    const ts = await render(blocks, fence('const a = 1;\n', 'ts'));
    assert.match(ts.html, /^<pre class="shiki github-light"/);
    assert.match(ts.html, /const/);
    assert.match((await render(blocks, fence('echo hi', 'sh'))).html, /class="shiki/);
  });

  void it('captions a listing with its quoted or bare title or file name', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    const caption = async (meta: string) => {
      const { html } = await render(blocks, fence('x', 'text', meta));
      return /<figcaption>(.*)<\/figcaption>/.exec(html)?.[1];
    };
    assert.equal(
      await caption(String.raw`title="A \"quoted\" <name>"`),
      'A &quot;quoted&quot; &lt;name&gt;',
    );
    assert.equal(await caption("title='single'"), 'single');
    assert.equal(await caption('file=setup.py'), 'setup.py');
    assert.equal(await caption('title=Bare file=other.py'), 'Bare');
    assert.equal(await caption('showLineNumbers {1,3}'), undefined);
  });

  void it('includes a source file relative to the brief, named and highlighted by its path', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    const { html, diagnostics } = await render(blocks, fence('', null, 'src="../src/setup.py"'));
    assert.deepEqual(diagnostics, []);
    assert.match(
      html,
      /^<figure class="code-listing"><figcaption>\.\.\/src\/setup\.py<\/figcaption><pre class="shiki/,
    );
    assert.match(html, /setup/);
    // Regression: the file's own trailing newline used to add a blank last line to plain listings.
    const titled = await render(blocks, fence('', 'text', 'src="../src/setup.py" title="Setup"'));
    assert.equal(
      titled.html,
      '<figure class="code-listing"><figcaption>Setup</figcaption><pre><code>print(&quot;&lt;setup&gt;&quot;)\n</code></pre></figure>',
    );
  });

  void it('reports broken includes and fence options at the fence', async (t) => {
    const root = await workspace(t);
    await symlink(path.join(root, 'src/setup.py'), path.join(root, 'src/linked.py'));
    const blocks = new CodeBlocks(root, []);
    const cases = [
      [fence('body', null, 'src="../src/setup.py"'), /empty fence body/],
      [fence('', null, 'src="/etc/hosts"'), /relative to the brief/],
      [fence('', null, 'src="../src/missing.py"'), /ENOENT/],
      [fence('', null, 'src="../src/linked.py"'), /without symbolic links/],
      [fence('', null, 'src="../../outside.py"'), /normalized workspace-relative path/],
      [fence('x', null, 'title="unterminated'), /Quote the complete filename/],
    ] as const;
    for (const [node, message] of cases) {
      const { html, diagnostics } = await render(blocks, node);
      assert.equal(html, '');
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0]?.rule, 'code-block');
      assert.match(diagnostics[0].message, message);
      assert.deepEqual([diagnostics[0].file, diagnostics[0].line], [AT.file, AT.line]);
    }
  });

  void it('refuses to include hidden files and folders', async (t) => {
    const root = await workspace(t);
    await writeFile(path.join(root, '.env'), 'SECRET=hunter2\n');
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git/config'), '[remote] token=hunter2\n');
    await mkdir(path.join(root, 'items/foo/.hidden'), { recursive: true });
    await writeFile(path.join(root, 'items/foo/.hidden/x.ts'), 'const secret = "hunter2";\n');
    const blocks = new CodeBlocks(root, []);
    for (const [src, lang] of [
      ['../.env', null],
      ['../.git/config', 'text'],
      ['foo/.hidden/x.ts', null],
      ['./../.env', 'mermaid'],
    ] as const) {
      const { html, diagnostics } = await render(blocks, fence('', lang, `src="${src}"`));
      assert.equal(html, '', src);
      assert.equal(diagnostics.length, 1, src);
      assert.equal(diagnostics[0]?.rule, 'code-block');
      assert.match(diagnostics[0].message, /hidden files and folders/);
      assert.match(diagnostics[0].fix, /folder without a leading dot/);
      assert.doesNotMatch(JSON.stringify(diagnostics), /hunter2/);
    }
  });

  void it('keeps an authored trailing blank line but drops an included file’s final newline', async (t) => {
    const root = await workspace(t);
    await writeFile(path.join(root, 'src/blank.txt'), 'a\n\n');
    const blocks = new CodeBlocks(root, []);
    const inline = await render(blocks, fence('a\n', 'text'));
    assert.equal(inline.html, '<pre><code>a\n\n</code></pre>');
    const included = await render(blocks, fence('', 'text', 'src="../src/blank.txt"'));
    assert.deepEqual([inline.diagnostics, included.diagnostics], [[], []]);
    assert.equal(
      included.html,
      '<figure class="code-listing"><figcaption>../src/blank.txt</figcaption><pre><code>a\n\n</code></pre></figure>',
    );
  });

  void it('renders the same fence bodies from Markdown and MDX', async (t) => {
    const root = await fixture(t);
    const fences = ['```text', 'plain', '```', '', '```text', 'blank after', '', '```', ''];
    await appendFile(path.join(root, 'releases/summer.md'), ['', ...fences].join('\n'));
    await appendFile(
      path.join(root, 'feature-sets/onboarding/items/starter-templates.mdx'),
      ['', ...fences].join('\n'),
    );
    const model = await compile(root, base);
    assert.deepEqual(model.diagnostics, []);
    for (const id of ['rel-summer', 'item-starter-templates']) {
      const html = model.entities.find((record) => record.id === id)?.html ?? '';
      assert.ok(html.includes('<pre><code>plain\n</code></pre>'), id);
      assert.ok(html.includes('<pre><code>blank after\n\n</code></pre>'), id);
    }
  });

  void it('renders Mermaid once per source into a file named after its drawing', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    const source = 'flowchart LR\n  A --> B';
    const first = await render(blocks, fence(source, 'mermaid', 'title="Flow & <order>"'));
    const again = await render(blocks, fence(source, 'mmd'));
    assert.deepEqual([...first.diagnostics, ...again.diagnostics], []);
    assert.equal(blocks.diagrams.size, 1);
    const [[name, svg] = ['', '']] = blocks.diagrams;
    assert.equal(
      name,
      `diagrams/${createHash('sha256').update(svg).digest('hex').slice(0, 24)}.svg`,
    );
    assert.match(svg, /<svg[\s>]/);
    const size = drawingSize(svg);
    assert.ok(size);
    assert.equal(
      first.html,
      `<figure class="roadmap-diagram"><a href="${base}${name}"><img src="${base}${name}" alt="Flow &amp; &lt;order&gt;" width="${size.width}" height="${size.height}" loading="lazy"></a><figcaption>Flow &amp; &lt;order&gt;</figcaption></figure>`,
    );
    assert.match(again.html, /alt="Mermaid diagram"/);
  });

  void it('reports invalid Mermaid syntax', async (t) => {
    const blocks = new CodeBlocks(await workspace(t), []);
    const { html, diagnostics } = await render(blocks, fence('unknownDiagram', 'mermaid'));
    assert.equal(html, '');
    assert.deepEqual(
      diagnostics.map(({ rule }) => rule),
      ['code-block'],
    );
    assert.equal(blocks.diagrams.size, 0);
  });

  void it('draws a dependency diagram for an item and refuses one elsewhere', async (t) => {
    const item: Entity = {
      kind: 'item',
      id: 'brief',
      title: 'Brief',
      description: '',
      source: AT.file,
      html: '',
      text: '',
      contributing_teams: [],
      depends_on: [],
      jira: [],
    };
    const blocks = new CodeBlocks(await workspace(t), [item]);
    const drawn = await render(blocks, fence('', 'roadmap-dependencies'));
    assert.deepEqual(drawn.diagnostics, []);
    assert.match(drawn.html, /class="dependency-diagram"/);
    assert.ok(drawn.html.includes(`href="${base}items/brief/"`));

    const elsewhere = await render(blocks, fence('', 'roadmap-dependencies'), {
      ...AT,
      file: 'releases/summer.md',
    });
    assert.equal(elsewhere.html, '');
    assert.match(elsewhere.diagnostics[0]?.message ?? '', /belongs in a roadmap item/);
  });
});

void describe('drawingSize', () => {
  void it('reads the rounded width and height of the root viewBox', () => {
    assert.deepEqual(drawingSize('<svg id="a" viewBox="0 0 120.4 80.6">'), {
      width: 120,
      height: 81,
    });
    assert.deepEqual(drawingSize('<svg viewBox="-8 -8.5, 300,  40"></svg>'), {
      width: 300,
      height: 40,
    });
  });

  void it('gives no size for a missing, empty or nested viewBox', () => {
    assert.equal(drawingSize('<svg width="10" height="10">'), undefined);
    assert.equal(drawingSize('<svg viewBox="0 0 0 10">'), undefined);
    assert.equal(drawingSize('<svg viewBox="0 0 abc 10">'), undefined);
    assert.equal(drawingSize('<div viewBox="0 0 10 10">'), undefined);
  });
});
