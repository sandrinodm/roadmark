import type { TestContext } from 'node:test';

import { compile } from '@roadmark/compiler/compile';
import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

import type { Invocation } from './arguments.ts';
import type { OptionSpec } from './manual.ts';

import { parseInvocation } from './arguments.ts';
import { COMMANDS, GLOBAL_OPTION_SPECS, GUIDE, HELP, manual } from './manual.ts';
import { TEMPLATES } from './templates.ts';

/**
 * Copies a packaged template into a temporary workspace removed after the test.
 */
async function workspace(t: TestContext, name: string): Promise<string> {
  const template = TEMPLATES.find((candidate) => candidate.name === name);
  assert.ok(template);
  const root = await mkdtemp(path.join(tmpdir(), 'roadmark-manual-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(template.directory, root, { recursive: true });
  return root;
}

/**
 * A valid command line for one documented command and the invocation it selects.
 */
type Example = {
  /**
   * Operands after the command name, plus any flag the command requires.
   */
  readonly operands: ReadonlyArray<string>;

  /**
   * Invocation the parser must select.
   */
  readonly tag: Invocation['_tag'];
};

/**
 * One example per documented command. A command added to the manual without an entry here fails the
 * test below.
 */
const EXAMPLES = new Map<string, Example>([
  ['init', { operands: ['site'], tag: 'Init' }],
  ['new', { operands: ['item', 'sample', '--set', 'getting-started'], tag: 'New' }],
  ['lint', { operands: [], tag: 'Lint' }],
  ['dev', { operands: [], tag: 'Dev' }],
  ['build', { operands: [], tag: 'Build' }],
  ['preview', { operands: [], tag: 'Preview' }],
  ['schema', { operands: ['item'], tag: 'Schema' }],
  ['guide', { operands: [], tag: 'Guide' }],
  ['help', { operands: [], tag: 'Help' }],
]);

/**
 * A valid value for each documented flag that takes one.
 */
const VALUES = new Map<string, string>([
  ['root', 'workspace'],
  ['template', 'ai-sandbox'],
  ['set', 'getting-started'],
  ['release', 'rel-first'],
  ['title', 'Sample title'],
  ['format', 'mdx'],
  ['out', 'out'],
  ['base', '/docs/'],
  ['port', '0'],
  ['dir', 'site'],
]);

/**
 * Parses a command line, resolving with its invocation or its usage message.
 */
function parse(args: ReadonlyArray<string>): Promise<Invocation | string> {
  return Effect.runPromise(
    parseInvocation(args, tmpdir()).pipe(
      Effect.match({ onFailure: (error) => error.message, onSuccess: (invocation) => invocation }),
    ),
  );
}

/**
 * Parses a command line, resolving with the selected invocation's tag or the usage message.
 */
async function outcome(args: ReadonlyArray<string>): Promise<string> {
  const parsed = await parse(args);
  return typeof parsed === 'string' ? parsed : parsed._tag;
}

/**
 * The command-line form of one documented flag, with a valid value when it takes one.
 */
function flag(option: OptionSpec): Array<string> {
  if (option.value === undefined) {
    return ['--' + option.name];
  }

  const value = VALUES.get(option.name);
  assert.ok(value !== undefined, `Add an example value for --${option.name}`);
  return ['--' + option.name, value];
}

/**
 * The documented description of a command's --strict flag.
 */
function strictDescription(name: string): string {
  const command = COMMANDS.find((candidate) => candidate.name === name);
  const option = command?.options.find((candidate) => candidate.name === 'strict');
  assert.ok(option, `${name} documents --strict`);
  return option.description;
}

void it('documents exactly the commands and flags the parser accepts', async () => {
  const document = manual('0.0.0');
  assert.deepEqual(document.commands, COMMANDS);
  assert.deepEqual(
    document.commands.map((command) => command.name).toSorted(),
    [...EXAMPLES.keys()].toSorted(),
  );
  const allFlags = new Set(document.commands.flatMap((command) => command.options));
  const globalFlags = document.globalOptions.filter((option) => option.short === undefined);
  for (const command of document.commands) {
    assert.match(HELP, new RegExp(`^  ${command.name}\\b`, 'm'), command.name);
    const example = EXAMPLES.get(command.name);
    assert.ok(example, command.name);
    const line = [command.name, ...example.operands];
    assert.equal(await outcome(line), example.tag, line.join(' '));
    // Every declared flag, and every global one that does not replace the command, is accepted.
    for (const option of [...command.options, ...globalFlags]) {
      const args = [...line, ...flag(option)];
      assert.equal(await outcome(args), example.tag, args.join(' '));
    }

    const declared = new Set(command.options.map((option) => option.name));
    for (const option of allFlags) {
      if (!declared.has(option.name)) {
        const args = [...line, ...flag(option)];
        const message = `--${option.name} is unavailable for roadmark ${command.name}.`;
        assert.equal(await outcome(args), message, args.join(' '));
      }
    }

    assert.match(await outcome([...line, '--bogus']), /Unknown option '--bogus'/);
  }

  assert.equal(await outcome(['bogus']), 'Unknown command "bogus". See roadmark --help.');
});

void it('documents the global flags and their short aliases', async () => {
  const document = manual('0.0.0');
  assert.deepEqual(document.globalOptions, GLOBAL_OPTION_SPECS);
  const aliases = document.globalOptions.flatMap((option) =>
    option.short === undefined ? [] : [[option.name, option.short]],
  );
  assert.deepEqual(aliases, [
    ['help', 'h'],
    ['version', 'v'],
  ]);
  assert.deepEqual(await parse(['lint', '--help']), { _tag: 'Help', json: false });
  assert.deepEqual(await parse(['lint', '-h']), { _tag: 'Help', json: false });
  assert.deepEqual(await parse(['lint', '--version']), { _tag: 'Version' });
  assert.deepEqual(await parse(['lint', '-v']), { _tag: 'Version' });
  assert.match(await outcome(['lint', '-x']), /Unknown option '-x'/);
});

void it('lists the packaged templates and the guide', async () => {
  const unknown = await Effect.runPromise(
    parseInvocation(['init', '--template', 'nope'], tmpdir()).pipe(Effect.flip),
  );
  assert.match(unknown.message, /blank or ai-sandbox/);
  const document = manual('0.0.0');
  assert.deepEqual(
    document.templates.map((template) => template.name),
    TEMPLATES.map((template) => template.name),
  );
  assert.equal(document.guide, GUIDE);
});

void it('describes --strict as each command applies it', () => {
  assert.match(strictDescription('lint'), /exit 1/);
  assert.match(strictDescription('build'), /exit 1/);
  // dev never exits on warnings: it withholds the revision and keeps serving the last good build.
  assert.doesNotMatch(strictDescription('dev'), /exit/);
  assert.match(strictDescription('dev'), /not published/);
  assert.match(strictDescription('dev'), /keeps watching/);
});

void it('describes how misplaced Markdown is reported', async (t) => {
  assert.doesNotMatch(GUIDE, /outside this layout are ignored/);
  assert.match(GUIDE, /misplaced-markdown/);
  const root = await workspace(t, 'blank');
  await writeFile(path.join(root, 'feature-sets', 'notes.md'), '# Notes');
  const model = await compile(root, '/');
  assert.deepEqual(
    model.diagnostics.map((diagnostic) => [diagnostic.rule, diagnostic.severity]),
    [['misplaced-markdown', 'warning']],
  );
});

void it('documents frontmatter the compiler accepts without a diagnostic', async (t) => {
  const root = await workspace(t, 'ai-sandbox');
  const example = /```yaml\n(---\n[\s\S]*?\n---)\n```/.exec(GUIDE)?.[1];
  assert.ok(example, 'the guide has a complete frontmatter example');
  // The example describes the ai-sandbox fork item, so it replaces that file's frontmatter.
  const file = 'feature-sets/runtime/items/fork.mdx';
  const original = await readFile(path.join(root, file), 'utf8');
  const body = original.slice(original.indexOf('\n---', 4) + 4);
  await writeFile(path.join(root, file), example + body);
  const model = await compile(root, '/');
  assert.deepEqual(
    model.diagnostics.filter((diagnostic) => diagnostic.file === file),
    [],
  );
});

void it('ships templates that pass strict lint', async (t) => {
  for (const { name } of TEMPLATES) {
    const root = await workspace(t, name);
    const model = await compile(root, '/');
    assert.deepEqual(model.diagnostics, [], name);
  }
});
