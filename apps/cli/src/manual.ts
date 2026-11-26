import { DEFAULT_TEMPLATE, TEMPLATES } from './templates.ts';

/**
 * One flag a command accepts.
 */
export type OptionSpec = {
  /**
   * Flag name without the leading dashes.
   */
  readonly name: string;

  /**
   * One-letter alias, such as `h` for `-h`, or undefined when the flag has none.
   */
  readonly short?: string;

  /**
   * Placeholder for the flag's value, or undefined for a boolean switch.
   */
  readonly value?: string;

  /**
   * What the flag changes.
   */
  readonly description: string;
};

/**
 * One command, as listed by `--help` and `help --json`.
 */
export type CommandSpec = {
  /**
   * Command name, the first positional argument.
   */
  readonly name: string;

  /**
   * Usage lines after `roadmark`, one per form.
   */
  readonly usage: ReadonlyArray<string>;

  /**
   * One-sentence description.
   */
  readonly summary: string;

  /**
   * Flags accepted besides the global ones.
   */
  readonly options: ReadonlyArray<OptionSpec>;
};

/**
 * Flags every command accepts.
 */
export const GLOBAL_OPTION_SPECS: ReadonlyArray<OptionSpec> = [
  { name: 'root', value: 'dir', description: 'Workspace directory. Defaults to the current one.' },
  {
    name: 'help',
    short: 'h',
    description: 'Print usage. Add --json for the machine-readable manual.',
  },
  { name: 'version', short: 'v', description: 'Print the installed version.' },
];

/**
 * The --strict flag shared by lint and build, which exit when warnings are reported.
 */
function strictOption(): OptionSpec {
  return {
    name: 'strict',
    description: 'Treat warnings as errors and exit 1 when any are reported.',
  };
}

/**
 * The --strict flag of dev, which keeps serving instead of exiting.
 */
function devStrictOption(): OptionSpec {
  return {
    name: 'strict',
    description:
      'Treat warnings as errors: a rebuild with warnings is not published, the last good build keeps being served and dev keeps watching.',
  };
}

/**
 * The --port flag shared by dev and preview.
 */
function portOption(): OptionSpec {
  return {
    name: 'port',
    value: 'port',
    description: 'Port on 127.0.0.1. Defaults to 4173; 0 picks a free port.',
  };
}

/**
 * The --base flag shared by dev and build.
 */
function baseOption(): OptionSpec {
  return {
    name: 'base',
    value: 'path',
    description: 'URL path the site is served under, such as /product/roadmap/. Defaults to /.',
  };
}

/**
 * Every command, in the order help lists them. The parser derives its accepted flags from this
 * list.
 */
export const COMMANDS: ReadonlyArray<CommandSpec> = [
  {
    name: 'init',
    usage: ['init [dir] [--template <name>]'],
    summary: `Create a workspace from a starter template (default ${DEFAULT_TEMPLATE}). Never overwrites files.`,
    options: [
      {
        name: 'template',
        value: 'name',
        description: `Starter to copy: ${TEMPLATES.map((template) => template.name).join(', ')}.`,
      },
    ],
  },
  {
    name: 'new',
    usage: [
      'new set <slug> [--title <text>] [--format md|mdx]',
      'new item <slug> --set <id-or-folder> [--release <id>] [--title <text>] [--format md|mdx]',
      'new release <slug> [--title <text>] [--format md|mdx]',
    ],
    summary: 'Create one feature set, item or release file with valid frontmatter.',
    options: [
      { name: 'set', value: 'id-or-folder', description: 'Feature set the new item belongs to.' },
      { name: 'release', value: 'id', description: 'Release to assign the new item to.' },
      {
        name: 'title',
        value: 'text',
        description: 'Title. Defaults to one derived from the slug.',
      },
      { name: 'format', value: 'md|mdx', description: 'File format. Defaults to md.' },
    ],
  },
  {
    name: 'lint',
    usage: ['lint [--strict] [--json]'],
    summary: 'Check every file and reference in the workspace and report problems with locations.',
    options: [
      strictOption(),
      { name: 'json', description: 'Print diagnostics as a JSON array instead of text.' },
    ],
  },
  {
    name: 'dev',
    usage: ['dev [--base <path>] [--port <port>] [--strict]'],
    summary: 'Serve the site locally and rebuild it whenever a workspace file changes.',
    options: [baseOption(), portOption(), devStrictOption()],
  },
  {
    name: 'build',
    usage: ['build [--out <dir>] [--base <path>] [--strict]'],
    summary: 'Compile the workspace into a static site for any static host.',
    options: [
      { name: 'out', value: 'dir', description: 'Output directory. Defaults to ./dist.' },
      baseOption(),
      strictOption(),
    ],
  },
  {
    name: 'preview',
    usage: ['preview [--dir <dir>] [--port <port>]'],
    summary: 'Serve a built site at its configured base path.',
    options: [
      { name: 'dir', value: 'dir', description: 'Built site. Defaults to ./dist.' },
      portOption(),
    ],
  },
  {
    name: 'schema',
    usage: ['schema [workspace|set|item|release|teams|people|brand]'],
    summary: 'Print the JSON Schema for one file kind, or every kind when none is given.',
    options: [],
  },
  {
    name: 'guide',
    usage: ['guide'],
    summary: 'Print the authoring guide: layout, frontmatter, IDs, dependencies, content and lint.',
    options: [],
  },
  {
    name: 'help',
    usage: ['help [command] [--json]'],
    summary: 'Print usage, or with --json the full manual including the guide.',
    options: [{ name: 'json', description: 'Print the manual as JSON.' }],
  },
];

/**
 * The usage printed for an empty invocation, `help`, or `--help`.
 */
export const HELP = [
  'Usage: roadmark [--root <dir>] <command> [options]',
  '',
  ...COMMANDS.flatMap((command) => [
    ...command.usage.map((line) => `  ${line}`),
    `      ${command.summary}`,
  ]),
  '',
  `Templates: ${TEMPLATES.map((template) => template.name).join(', ')}. The workspace defaults to the current directory.`,
  'Exit status: 0 ok, 1 problems found, 2 usage or I/O error.',
  'Agents: run `roadmark help --json` for every command and flag plus the authoring guide.',
].join('\n');

/**
 * Exit statuses shared by every command, as listed in the JSON manual.
 */
const EXIT_CODES: ReadonlyArray<{ readonly code: number; readonly meaning: string }> = [
  { code: 0, meaning: 'Success.' },
  { code: 1, meaning: 'The workspace has errors, or warnings under --strict.' },
  { code: 2, meaning: 'Invalid usage, or a file or network operation failed.' },
];

/**
 * The authoring guide printed by `roadmark guide` and included in `help --json`.
 */
export const GUIDE = `# Roadmark authoring guide

Roadmark compiles a folder of Markdown and YAML files into a static roadmap site. Everything is plain
text in Git. Edit files, run \`roadmark lint\`, fix what it reports, repeat.

## Workflow

1. \`roadmark init my-roadmap --template blank\` (or \`ai-sandbox\` for a large worked example).
2. Edit \`roadmap.yaml\`, \`people.yaml\` and \`teams.yaml\`.
3. Add work with \`roadmark new set|item|release <slug>\` or by writing files directly.
4. \`roadmark lint --strict --json\` until it prints \`[]\`.
5. \`roadmark dev\` to look at the site, \`roadmark build --out dist\` to publish it.

## Layout

\`\`\`text
roadmap.yaml                         workspace: schema_version: 1, title, optional jira_base_url
people.yaml                          person ID -> name, role, avatar, teams
teams.yaml                           team ID -> name, description
releases/<file>.md                   one release per file
feature-sets/<folder>/README.md      the feature set (one README.md or README.mdx per folder)
feature-sets/<folder>/items/<file>.md  one item per file; the folder decides its feature set
feature-sets/<folder>/media/         images, GIFs, videos, captions (any folder name works)
\`\`\`

Any file can be \`.mdx\` instead of \`.md\`. Other Markdown under \`feature-sets/\` or
\`releases/\` is skipped with a \`misplaced-markdown\` warning, which fails \`lint --strict\`.

## IDs and references

Every set, item and release has an \`id\`: lowercase letters, digits and single hyphens. IDs are
stable: they make the page URLs, and renaming or moving a file keeps the URL as long as the \`id\`
stays. Convention: \`set-\`, \`item-\` and \`rel-\` prefixes. Frontmatter refers to other records
only by ID:

- \`release: rel-ga\` on an item assigns it to a release (zero or one release per item).
- \`pm: alex\`, \`contributors: [sam]\` refer to keys in \`people.yaml\`.
- \`engineering_team: runtime\`, \`contributing_teams: [web]\` refer to keys in \`teams.yaml\`.
- An item inherits \`pm\` and \`engineering_team\` from its feature set unless it sets its own.

## Frontmatter

Run \`roadmark schema <kind>\` for the exact JSON Schema. Required fields:

- Feature set: \`id\`, \`title\`, \`description\`, \`outcome\`, \`pm\`, \`engineering_team\`.
- Item: \`id\`, \`title\`, \`description\`, \`outcome\`, \`status\`.
- Release: \`id\`, \`title\`, \`description\`, \`outcome\`, \`status\`, \`target\`.

Item status: \`proposed\`, \`planned\`, \`in-progress\`, \`done\`, \`cancelled\`.
Release status: \`planned\`, \`in-progress\`, \`shipped\`, \`cancelled\`. A shipped release needs
\`shipped_on\` (the actual day).

Dates are quoted strings. \`start\` and \`shipped_on\` are days (\`"2027-03-01"\`). \`target\` can be
a day, a month (\`"2027-03"\`) or a quarter (\`"2027-Q1"\`); the site groups releases by that
precision. Optional item fields: \`release\`, \`start\`, \`target\`, \`contributors\`,
\`contributing_teams\`, \`depends_on\`, \`jira\` (issue keys such as \`[RT-81]\`) and \`links\`
(a list of \`{ label, url }\`, also allowed on feature sets).

\`\`\`yaml
---
id: item-fork
title: Fork a running sandbox
description: Copy a live sandbox, memory and disk included, in under a second.
outcome: Agents can branch an experiment without replaying its setup.
status: in-progress
release: rel-ga
start: "2026-11-02"
target: "2027-01-29"
contributors: [lukas]
jira: [RT-90]
depends_on:
  - item: item-snapshots
    reason: Forking restores from the same memory snapshot format.
links:
  - label: Design doc
    url: https://docs.example/fork
---
\`\`\`

## Dependencies

\`depends_on\` lists prerequisite items by ID, each with an optional \`reason\` that tells readers
what finishing it unlocks. Only items have dependencies, and they may cross feature sets and
releases. Lint reports:

- \`unknown-reference\` (error): the ID does not exist.
- \`dependency-cycle\` (error): items depend on each other in a loop.
- \`incomplete-dependency\` (warning): a \`done\` item depends on unfinished work.
- \`dependency-schedule-conflict\` (warning): a prerequisite is targeted after the dependent item.

The site shows prerequisites and dependents on each item page and on the timeline. An empty
\`roadmap-dependencies\` code fence (or \`<DependencyDiagram />\` in MDX) draws the item's graph.

## Body content

The body is GitHub-flavoured Markdown: headings, lists, task lists, tables, links and images.

- Link to another brief with a relative path (\`[setup](../../onboarding/items/setup.md#risks)\`);
  the build rewrites it to the published page and checks the heading exists.
- Images use normal syntax with alt text. Store media next to the feature set. A local \`.mp4\` or
  \`.webm\` link alone in a paragraph becomes a video player; \`clip.en.vtt\` beside it adds captions.
- Code fences are highlighted. \`title="file.ts"\` adds a caption. An empty fence with
  \`src="../snippets/example.json"\` includes a workspace file.
- A \`mermaid\` fence becomes an SVG diagram at build time. Add \`title="..."\` for its caption.
- MDX adds expressions, imports of local components and the built-ins \`<Decision>\`, \`<Risk>\`,
  \`<Outcome>\` (callouts with an optional \`title\`), \`<Code src lang title />\`,
  \`<Mermaid src title />\` and \`<DependencyDiagram />\`. MDX runs as code during the build, so only
  accept it from trusted authors.

## Lint output

\`roadmark lint --json\` prints an array. Each entry has \`severity\` (\`error\` or \`warning\`),
\`rule\`, \`message\`, \`fix\` (what to change), and \`file\`, \`line\`, \`column\` when the problem
has a location. Exit status is 0 when clean, 1 when there are errors (or warnings with
\`--strict\`), and 2 for usage or I/O failures.
`;

/**
 * Instructions `init` writes to AGENTS.md in a new workspace.
 */
export const AGENTS_GUIDE = `# Roadmap workspace

This folder is a Roadmark workspace: a product roadmap written as Markdown and YAML that compiles
to a static site.

- Learn the format: \`npx roadmark guide\` (or \`npx roadmark help --json\` for every command, flag
  and the guide in one JSON document).
- Exact frontmatter fields: \`npx roadmark schema item\` (also \`set\`, \`release\`, \`people\`,
  \`teams\`, \`workspace\`, \`brand\`).
- After every change run \`npx roadmark lint --strict --json\` and fix each entry until it prints
  \`[]\`.
- Preview with \`npx roadmark dev\`. Publish with \`npx roadmark build --out dist\`.
`;

/**
 * Everything an agent needs to drive the CLI, in one JSON document.
 */
export type Manual = {
  /**
   * Command name to invoke.
   */
  readonly name: string;

  /**
   * Installed package version.
   */
  readonly version: string;

  /**
   * Top-level usage line.
   */
  readonly usage: string;

  /**
   * Flags every command accepts.
   */
  readonly globalOptions: ReadonlyArray<OptionSpec>;

  /**
   * Every command with its usage, summary and flags.
   */
  readonly commands: ReadonlyArray<CommandSpec>;

  /**
   * Starter workspaces for `init --template`.
   */
  readonly templates: ReadonlyArray<{ name: string; summary: string; default: boolean }>;

  /**
   * File kinds accepted by `roadmark schema`.
   */
  readonly schemas: ReadonlyArray<string>;

  /**
   * Exit statuses and their meaning.
   */
  readonly exitCodes: ReadonlyArray<{ readonly code: number; readonly meaning: string }>;

  /**
   * The Markdown authoring guide, also printed by `roadmark guide`.
   */
  readonly guide: string;
};

/**
 * The machine-readable manual printed by `roadmark help --json`.
 *
 * @param version The installed package version.
 * @returns A JSON-serializable description of every command, template and the authoring guide.
 */
export function manual(version: string): Manual {
  return {
    name: 'roadmark',
    version,
    usage: 'roadmark [--root <dir>] <command> [options]',
    globalOptions: GLOBAL_OPTION_SPECS,
    commands: COMMANDS,
    templates: TEMPLATES.map(({ name, summary }) => ({
      name,
      summary,
      default: name === DEFAULT_TEMPLATE,
    })),
    schemas: ['workspace', 'set', 'item', 'release', 'teams', 'people', 'brand'],
    exitCodes: EXIT_CODES,
    guide: GUIDE,
  };
}
