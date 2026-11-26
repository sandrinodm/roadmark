import { Effect, Predicate, Schema } from 'effect';
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Invocation } from './arguments.ts';

import { parseInvocation } from './arguments.ts';

/**
 * Workspace root used when a command line passes no `--root`.
 */
const ROOT = path.resolve('/workspace/roadmap');

/**
 * Reads `roadmark schema` output as a JSON object keyed by top-level property.
 */
const decodeObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/**
 * Parses a command line that must be accepted.
 */
function accept(...args: Array<string>): Promise<Invocation> {
  return Effect.runPromise(parseInvocation(args, ROOT));
}

/**
 * Parses a command line that must be rejected and returns the usage message.
 */
async function reject(...args: Array<string>): Promise<string> {
  const error = await Effect.runPromise(Effect.flip(parseInvocation(args, ROOT)));
  assert.ok(Predicate.isTagged(error, 'CliUsageError'));
  return error.message;
}

void describe('parseInvocation: global flags', () => {
  void it('prints help for no arguments, help, --help and -h, with --json passed through', async () => {
    assert.deepEqual(await accept(), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('help'), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('help', '--json'), { _tag: 'Help', json: true });
    assert.deepEqual(await accept('help', 'lint'), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('--help'), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('-h'), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('build', '--help'), { _tag: 'Help', json: false });
  });

  void it('rejects flags and operands the help command does not declare', async () => {
    assert.equal(await reject('help', '--out', 'x'), '--out is unavailable for roadmark help.');
    assert.equal(
      await reject('help', '--strict', '--port', '9', 'extra'),
      '--strict is unavailable for roadmark help.',
    );
    assert.equal(await reject('help', 'extra'), 'Unknown command "extra". See roadmark --help.');
    assert.equal(
      await reject('help', 'lint', 'build'),
      'Too many arguments for roadmark help. See roadmark --help.',
    );
    assert.deepEqual(await accept('help', '--json', '--root', 'x'), { _tag: 'Help', json: true });
    // The global flag still wins over any command and its flags.
    assert.deepEqual(await accept('build', '--out', 'x', '--help'), { _tag: 'Help', json: false });
    assert.deepEqual(await accept('help', '--out', 'x', '-v'), { _tag: 'Version' });
  });

  void it('prints the version for --version and -v, ahead of help and any command', async () => {
    assert.deepEqual(await accept('--version'), { _tag: 'Version' });
    assert.deepEqual(await accept('-v'), { _tag: 'Version' });
    assert.deepEqual(await accept('--help', '--version'), { _tag: 'Version' });
    assert.deepEqual(await accept('nonsense', '-v'), { _tag: 'Version' });
  });

  void it('asks for a command when only flags are given', async () => {
    assert.equal(await reject('--root', 'site'), 'Choose a command. See roadmark --help.');
    assert.equal(await reject('--strict'), 'Choose a command. See roadmark --help.');
  });

  void it('rejects unknown commands, unknown flags and missing flag values', async () => {
    assert.equal(await reject('deploy'), 'Unknown command "deploy". See roadmark --help.');
    assert.match(await reject('lint', '--nope'), /Unknown option '--nope'/);
    assert.match(await reject('build', '--out'), /Option '--out <value>' argument missing/);
  });

  void it('resolves --root anywhere on the line, last occurrence winning', async () => {
    const lint = await accept('--root', 'one', 'lint', '--root', 'two');
    assert.deepEqual(lint, { _tag: 'Lint', root: path.resolve('two'), strict: false, json: false });
  });
});

void describe('parseInvocation: commands', () => {
  void it('rejects a flag recognized for another command', async () => {
    assert.equal(await reject('lint', '--out', 'site'), '--out is unavailable for roadmark lint.');
    assert.equal(
      await reject('preview', '--strict'),
      '--strict is unavailable for roadmark preview.',
    );
    assert.equal(await reject('guide', '--json'), '--json is unavailable for roadmark guide.');
    assert.equal(
      await reject('schema', '--port', '1'),
      '--port is unavailable for roadmark schema.',
    );
    assert.equal(await reject('init', '--base', '/'), '--base is unavailable for roadmark init.');
    assert.equal(await reject('new', '--dir', 'x'), '--dir is unavailable for roadmark new.');
    assert.equal(await reject('dev', '--out', 'x'), '--out is unavailable for roadmark dev.');
    assert.equal(await reject('build', '--port', '1'), '--port is unavailable for roadmark build.');
  });

  void it('rejects extra operands for every command that takes a fixed number', async () => {
    for (const [command, ...extra] of [
      ['init', 'a', 'b'],
      ['guide', 'a'],
      ['schema', 'item', 'set'],
      ['lint', 'a'],
      ['build', 'a'],
      ['dev', 'a'],
      ['preview', 'a'],
    ] as const) {
      assert.equal(
        await reject(command, ...extra),
        `Too many arguments for roadmark ${command}. See roadmark --help.`,
      );
    }
  });

  void it('init: targets the root or a resolved directory with a known template', async () => {
    assert.deepEqual(await accept('init'), { _tag: 'Init', target: ROOT, template: 'blank' });
    assert.deepEqual(await accept('init', 'here', '--template', 'ai-sandbox'), {
      _tag: 'Init',
      target: path.resolve('here'),
      template: 'ai-sandbox',
    });
    assert.equal(
      await reject('init', '--template', 'kanban'),
      'Unknown template "kanban". Choose blank or ai-sandbox.',
    );
  });

  void it('guide takes nothing', async () => {
    assert.deepEqual(await accept('guide'), { _tag: 'Guide' });
  });

  void it('lint: reads --strict and --json', async () => {
    assert.deepEqual(await accept('lint', '--strict', '--json'), {
      _tag: 'Lint',
      root: ROOT,
      strict: true,
      json: true,
    });
  });

  void it('build: defaults to ./dist at the site root and normalizes --base', async () => {
    assert.deepEqual(await accept('build'), {
      _tag: 'Build',
      root: ROOT,
      output: path.resolve('dist'),
      base: '/',
      strict: false,
    });
    assert.deepEqual(await accept('build', '--out', 'site', '--base', '/roadmap', '--strict'), {
      _tag: 'Build',
      root: ROOT,
      output: path.resolve('site'),
      base: '/roadmap/',
      strict: true,
    });
    const message = 'Use an absolute URL path for --base, such as / or /roadmap/.';
    assert.equal(await reject('build', '--base', 'roadmap'), message);
    assert.equal(await reject('build', '--base', '/a/../b'), message);
    assert.equal(await reject('build', '--base', ''), message);
  });

  void it('dev: defaults to port 4173 and validates --port and --base', async () => {
    assert.deepEqual(await accept('dev'), {
      _tag: 'Dev',
      root: ROOT,
      base: '/',
      port: 4173,
      strict: false,
    });
    assert.deepEqual(await accept('dev', '--port', '0', '--base', '/docs/', '--strict'), {
      _tag: 'Dev',
      root: ROOT,
      base: '/docs/',
      port: 0,
      strict: true,
    });
    assert.equal(
      await reject('dev', '--base', 'https://example.com/'),
      'Use an absolute URL path for --base, such as / or /roadmap/.',
    );
  });

  void it('preview: defaults to ./dist and accepts ports from 0 to 65535 only', async () => {
    assert.deepEqual(await accept('preview'), {
      _tag: 'Preview',
      directory: path.resolve('dist'),
      port: 4173,
    });
    assert.deepEqual(await accept('preview', '--dir', 'out', '--port', '65535'), {
      _tag: 'Preview',
      directory: path.resolve('out'),
      port: 65_535,
    });
    for (const port of ['65536', '-1', '1e3', ' 80', '80.5', '', '0x50']) {
      assert.equal(
        await reject('preview', `--port=${port}`),
        'Use an integer port between 0 and 65535.',
        port,
      );
    }
  });

  void it('schema: prints one named schema or the whole catalog, rejecting unknown names', async () => {
    const one = await accept('schema', 'item');
    assert.ok(one._tag === 'Schema');
    assert.match(one.document, /^\{\n {2}"/);
    assert.ok('properties' in decodeObject(one.document));

    const all = await accept('schema');
    assert.ok(all._tag === 'Schema');
    const catalog = decodeObject(all.document);
    for (const kind of ['workspace', 'set', 'item', 'release', 'teams', 'people', 'brand']) {
      assert.ok(Object.hasOwn(catalog, kind), kind);
    }

    assert.equal(
      await reject('schema', 'milestone'),
      'Unknown schema "milestone". See roadmark --help.',
    );
    assert.equal(
      await reject('schema', 'toString'),
      'Unknown schema "toString". See roadmark --help.',
    );
  });
});

void describe('parseInvocation: new', () => {
  void it('derives a title from the slug and keeps the workspace root', async () => {
    assert.deepEqual(await accept('new', 'set', 'guided-setup-flow'), {
      _tag: 'New',
      root: ROOT,
      draft: { kind: 'set', slug: 'guided-setup-flow', title: 'Guided Setup Flow' },
    });
    assert.deepEqual(await accept('new', 'release', 'v2', '--title', 'Version two'), {
      _tag: 'New',
      root: ROOT,
      draft: { kind: 'release', slug: 'v2', title: 'Version two' },
    });
  });

  void it('requires --set for an item and takes an optional release and format', async () => {
    assert.equal(
      await reject('new', 'item', 'one'),
      'Provide --set <id-or-folder> for a new item.',
    );
    assert.equal(
      await reject('new', 'item', 'one', '--set', ''),
      'Provide --set <id-or-folder> for a new item.',
    );
    assert.deepEqual(await accept('new', 'item', 'one', '--set', 'onboarding'), {
      _tag: 'New',
      root: ROOT,
      draft: { kind: 'item', slug: 'one', title: 'One', set: 'onboarding' },
    });
    assert.deepEqual(
      await accept('new', 'item', 'one', '--set', 'a', '--release', 'r', '--format', 'mdx'),
      {
        _tag: 'New',
        root: ROOT,
        draft: { kind: 'item', slug: 'one', title: 'One', set: 'a', release: 'r', format: 'mdx' },
      },
    );
  });

  void it('rejects parent flags on sets and releases', async () => {
    assert.equal(
      await reject('new', 'set', 's', '--set', 'x'),
      '--set applies to roadmark new item.',
    );
    assert.equal(
      await reject('new', 'release', 'r', '--release', 'x'),
      '--release applies to roadmark new item.',
    );
  });

  void it('rejects unknown kinds, missing or extra operands and unknown formats', async () => {
    const shape = 'Use roadmark new <set|item|release> <slug>. See roadmark --help.';
    assert.equal(await reject('new'), shape);
    assert.equal(await reject('new', 'set'), shape);
    assert.equal(await reject('new', 'milestone', 'beta'), shape);
    assert.equal(await reject('new', 'set', 'a', 'b'), shape);
    assert.equal(
      await reject('new', 'set', 'a', '--format', 'html'),
      'Use --format md or --format mdx.',
    );
  });
});
