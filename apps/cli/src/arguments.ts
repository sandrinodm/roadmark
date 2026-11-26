import type { Kind } from '@roadmark/compiler/model';

import { schemas } from '@roadmark/compiler/schemas';
import { Effect, Schema } from 'effect';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Draft } from './scaffold.ts';
import type { TemplateName } from './templates.ts';

import { CliUsageError } from './errors.ts';
import { COMMANDS, GLOBAL_OPTION_SPECS } from './manual.ts';
import { normalizeBase } from './request.ts';
import { errorText } from './run.ts';
import { DEFAULT_TEMPLATE, TEMPLATES } from './templates.ts';

/**
 * Port used by preview and dev when the caller does not pass `--port`.
 */
const DEFAULT_PORT = '4173';

/**
 * Largest TCP port accepted by either local server.
 */
const MAX_PORT = 65_535;

/**
 * Default build and preview directory, relative to the process working directory.
 */
const DEFAULT_OUTPUT = 'dist';

/**
 * Accepts decimal port strings without sign, exponent, or whitespace.
 */
const PORT_NUMBER = /^\d+$/;

/**
 * Markdown documents that authors can create with `roadmark new`.
 */
const DOCUMENT_KINDS: ReadonlySet<string> = new Set(['set', 'item', 'release']);

/**
 * Arguments allowed before or after any command, as documented in the manual.
 */
const GLOBAL_OPTIONS: ReadonlySet<string> = new Set(
  GLOBAL_OPTION_SPECS.map((option) => option.name),
);

/**
 * Additional flags accepted by each command.
 */
const COMMAND_OPTIONS: ReadonlyMap<string, ReadonlyArray<string>> = new Map(
  COMMANDS.map((command) => [command.name, command.options.map((option) => option.name)]),
);

/**
 * Serializes a JSON Schema document with the indentation used by `roadmark schema`.
 */
const encodeSchemaDocument = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown, { space: 2 }),
);

/**
 * A validated command line, ready to execute.
 */
export type Invocation =
  | { readonly _tag: 'Version' }
  | { readonly _tag: 'Help'; readonly json: boolean }
  | { readonly _tag: 'Guide' }
  | { readonly _tag: 'Init'; readonly target: string; readonly template: TemplateName }
  | { readonly _tag: 'New'; readonly root: string; readonly draft: Draft }
  | { readonly _tag: 'Schema'; readonly document: string }
  | {
      readonly _tag: 'Lint';
      readonly root: string;
      readonly strict: boolean;
      readonly json: boolean;
    }
  | {
      readonly _tag: 'Build';
      readonly root: string;
      readonly output: string;
      readonly base: string;
      readonly strict: boolean;
    }
  | {
      readonly _tag: 'Dev';
      readonly root: string;
      readonly base: string;
      readonly port: number;
      readonly strict: boolean;
    }
  | { readonly _tag: 'Preview'; readonly directory: string; readonly port: number };

/**
 * Recognized command-line flags, with absent values left undefined.
 */
type Options = ReturnType<typeof tokenize>['values'];

/**
 * An argument with its kind and, for flags, the option name used to check command compatibility.
 */
type Token = ReturnType<typeof tokenize>['tokens'][number];

/**
 * A tokenized command line with its workspace root resolved.
 */
type Parsed = {
  /**
   * Command name, the first positional argument.
   */
  command: string;

  /**
   * Positional arguments after the command.
   */
  operands: ReadonlyArray<string>;

  /**
   * Flag values; for a repeated flag the last occurrence wins.
   */
  values: Options;

  /**
   * Absolute workspace root from `--root` or the default.
   */
  root: string;
};

/**
 * Tokenizes and validates one command line. `node:util` `parseArgs` keeps the established contract:
 * its error messages, last-wins repeated flags and `--` handling.
 *
 * @param args The command-line arguments after the executable name.
 * @param defaultRoot The workspace used when `--root` is absent.
 * @returns The validated invocation, or a usage error explaining the correction.
 */
export const parseInvocation = Effect.fn('parseInvocation')(function* (
  args: ReadonlyArray<string>,
  defaultRoot: string,
): Effect.fn.Return<Invocation, CliUsageError> {
  const {
    values,
    positionals: [command, ...operands],
    tokens,
  } = yield* Effect.try({
    try: () => tokenize(args),
    catch: (cause) => new CliUsageError({ message: errorText(cause) }),
  });
  if (values.version) {
    return { _tag: 'Version' };
  }

  // `--help` anywhere wins over the command, so `roadmark build --help` prints usage.
  if (values.help || args.length === 0) {
    return { _tag: 'Help', json: values.json ?? false };
  }

  if (command === 'help') {
    yield* checkOptions(command, tokens);
    yield* checkOperandCount(command, operands, 1);
    // `roadmark help lint` is the common way to ask about one command; it prints the usage.
    const [topic] = operands;
    if (topic !== undefined && !COMMAND_OPTIONS.has(topic)) {
      return yield* unknownCommand(topic);
    }

    return { _tag: 'Help', json: values.json ?? false };
  }

  if (command === undefined) {
    return yield* usage('Choose a command. See roadmark --help.');
  }

  yield* checkOptions(command, tokens);
  const root = values.root === undefined ? defaultRoot : resolve(values.root);
  return yield* selectCommand({ command, operands, values, root });
});

/**
 * Accepts a packaged template name, listing the choices when the name is unknown.
 */
function templateFor(name: string | undefined): Effect.Effect<TemplateName, CliUsageError> {
  if (name === undefined) {
    return Effect.succeed(DEFAULT_TEMPLATE);
  }

  const template = TEMPLATES.find((candidate) => candidate.name === name);
  return template
    ? Effect.succeed(template.name)
    : usage(
        `Unknown template "${name}". Choose ${TEMPLATES.map((candidate) => candidate.name).join(' or ')}.`,
      );
}

/**
 * Tokenizes known flags and operands. Node rejects unknown flags and missing option values.
 */
function tokenize(args: ReadonlyArray<string>) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    tokens: true,
    options: {
      root: { type: 'string' },
      help: { type: 'boolean', short: shortAlias('help') },
      version: { type: 'boolean', short: shortAlias('version') },
      out: { type: 'string' },
      dir: { type: 'string' },
      base: { type: 'string' },
      port: { type: 'string' },
      strict: { type: 'boolean' },
      json: { type: 'boolean' },
      set: { type: 'string' },
      release: { type: 'string' },
      title: { type: 'string' },
      format: { type: 'string' },
      template: { type: 'string' },
    } as const,
  });
}

/**
 * The one-letter alias the manual documents for a global flag.
 */
function shortAlias(name: string): string {
  const short = GLOBAL_OPTION_SPECS.find((option) => option.name === name)?.short;
  if (short === undefined) {
    throw new Error(`The manual documents no short alias for --${name}.`);
  }

  return short;
}

/**
 * Rejects unknown commands and flags that are recognized but unavailable for the command.
 */
function checkOptions(
  command: string,
  tokens: ReadonlyArray<Token>,
): Effect.Effect<void, CliUsageError> {
  const allowedOptions = COMMAND_OPTIONS.get(command);
  if (!allowedOptions) {
    return unknownCommand(command);
  }

  for (const token of tokens) {
    if (
      token.kind === 'option' &&
      !GLOBAL_OPTIONS.has(token.name) &&
      !allowedOptions.includes(token.name)
    ) {
      return usage(`--${token.name} is unavailable for roadmark ${command}.`);
    }
  }

  return Effect.void;
}

/**
 * Validates operands and option values for the selected command.
 */
const selectCommand = Effect.fnUntraced(function* (parsed: Parsed) {
  const { command, operands, values, root } = parsed;
  const strict = values.strict ?? false;
  switch (command) {
    case 'init': {
      yield* checkOperandCount(command, operands, 1);
      const target = operands[0] === undefined ? root : resolve(operands[0]);
      const template = yield* templateFor(values.template);
      return { _tag: 'Init', target, template } satisfies Invocation;
    }
    case 'guide':
      yield* checkOperandCount(command, operands, 0);
      return { _tag: 'Guide' } satisfies Invocation;
    case 'new':
      return { _tag: 'New', root, draft: yield* draftFor(operands, values) } satisfies Invocation;
    case 'schema':
      yield* checkOperandCount(command, operands, 1);
      return { _tag: 'Schema', document: yield* schemaDocument(operands[0]) } satisfies Invocation;
    case 'lint':
      yield* checkOperandCount(command, operands, 0);
      return { _tag: 'Lint', root, strict, json: values.json ?? false } satisfies Invocation;
    case 'build': {
      yield* checkOperandCount(command, operands, 0);
      const output = resolve(values.out ?? DEFAULT_OUTPUT);
      const base = yield* baseOption(values.base);
      return { _tag: 'Build', root, output, base, strict } satisfies Invocation;
    }
    case 'dev': {
      yield* checkOperandCount(command, operands, 0);
      const base = yield* baseOption(values.base);
      return {
        _tag: 'Dev',
        root,
        base,
        port: yield* portNumber(values.port),
        strict,
      } satisfies Invocation;
    }
    case 'preview': {
      yield* checkOperandCount(command, operands, 0);
      const directory = resolve(values.dir ?? DEFAULT_OUTPUT);
      return {
        _tag: 'Preview',
        directory,
        port: yield* portNumber(values.port),
      } satisfies Invocation;
    }
    default:
      return yield* unknownCommand(command);
  }
});

/**
 * Builds the scaffold request: kind and slug, default title, parent flags and format.
 */
const draftFor = Effect.fnUntraced(function* (operands: ReadonlyArray<string>, values: Options) {
  const [kind, slug] = operands;
  if (operands.length !== 2 || !isKind(kind) || slug === undefined) {
    return yield* usage('Use roadmark new <set|item|release> <slug>. See roadmark --help.');
  }

  const { format } = values;
  const title = values.title ?? slug.split('-').map(capitalize).join(' ');
  const draft = yield* parentsFor(kind, slug, title, values);
  if (format === undefined) {
    return draft;
  }

  if (format !== 'md' && format !== 'mdx') {
    return yield* usage('Use --format md or --format mdx.');
  }

  return { ...draft, format } satisfies Draft;
});

/**
 * Checks that parent set and release flags match the document kind.
 */
function parentsFor(
  kind: Kind,
  slug: string,
  title: string,
  parents: Pick<Options, 'set' | 'release'>,
): Effect.Effect<Draft, CliUsageError> {
  const { set, release } = parents;
  if (set !== undefined && kind !== 'item') {
    return usage('--set applies to roadmark new item.');
  }

  if (release !== undefined && kind !== 'item') {
    return usage('--release applies to roadmark new item.');
  }

  let draft: Effect.Effect<Draft, CliUsageError>;
  switch (kind) {
    case 'item':
      if (!set) {
        draft = usage('Provide --set <id-or-folder> for a new item.');
      } else {
        draft = Effect.succeed(
          release === undefined ? { kind, slug, title, set } : { kind, slug, title, set, release },
        );
      }

      break;
    case 'set':
    case 'release':
      draft = Effect.succeed({ kind, slug, title });
      break;
  }

  return draft;
}

/**
 * Rejects extra positional arguments before a command can write output or files.
 */
function checkOperandCount(
  command: string,
  operands: ReadonlyArray<string>,
  max: number,
): Effect.Effect<void, CliUsageError> {
  return operands.length > max
    ? usage(`Too many arguments for roadmark ${command}. See roadmark --help.`)
    : Effect.void;
}

/**
 * Serializes one named schema or the full catalog, rejecting unknown schema names.
 */
function schemaDocument(kind: string | undefined): Effect.Effect<string, CliUsageError> {
  const collection = schemas();
  if (kind !== undefined && !Object.hasOwn(collection, kind)) {
    return usage(`Unknown schema "${kind}". See roadmark --help.`);
  }

  const schema = kind === undefined ? collection : collection[kind];
  return encodeSchemaDocument(schema).pipe(
    Effect.mapError((error) => new CliUsageError({ message: error.message })),
  );
}

/**
 * Normalizes `--base`, defaulting to the site root.
 */
function baseOption(input = '/'): Effect.Effect<string, CliUsageError> {
  return Effect.try({
    try: () => normalizeBase(input),
    catch: (cause) => new CliUsageError({ message: errorText(cause) }),
  });
}

/**
 * Parses a TCP port from decimal, accepting zero to request an available port.
 */
function portNumber(input = DEFAULT_PORT): Effect.Effect<number, CliUsageError> {
  const number = Number(input);
  return !PORT_NUMBER.test(input) || number > MAX_PORT
    ? usage(`Use an integer port between 0 and ${MAX_PORT}.`)
    : Effect.succeed(number);
}

/**
 * Narrows a supplied document name to one of the supported authoring kinds.
 */
function isKind(value: string | undefined): value is Kind {
  return value !== undefined && DOCUMENT_KINDS.has(value);
}

/**
 * Uppercases the leading character of a slug component for the suggested document title.
 */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Rejects an unrecognized command name.
 */
function unknownCommand(command: string): Effect.Effect<never, CliUsageError> {
  return usage(`Unknown command "${command}". See roadmark --help.`);
}

/**
 * Fails with a usage error explaining how to correct the command line.
 */
function usage(message: string): Effect.Effect<never, CliUsageError> {
  return Effect.fail(new CliUsageError({ message }));
}
