import type { Diagnostic } from '@roadmark/compiler/model';

import { schemaFor, SLUG_PATTERN } from '@roadmark/compiler/schemas';
import { discover, readSource } from '@roadmark/compiler/source';
import { readWorkspace } from '@roadmark/compiler/workspace';
import { Effect, Schema } from 'effect';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import lockfile from 'proper-lockfile';
import { stringify } from 'yaml';

import type { TemplateName } from './templates.ts';

import { diagnosticText } from './diagnostics.ts';
import { AGENTS_GUIDE } from './manual.ts';
import { errorText, hasCode, runPromise } from './run.ts';
import { DEFAULT_TEMPLATE, TEMPLATES } from './templates.ts';

/**
 * Agent instructions written beside every new workspace.
 */
const AGENTS_FILE = 'AGENTS.md';

/**
 * Prompt written to the description of a newly scaffolded document.
 */
const PLACEHOLDER_DESCRIPTION = 'Describe the problem and why it matters.';

/**
 * Prompt written where the author should explain the expected result.
 */
const PLACEHOLDER_OUTCOME = 'Describe the outcome and how you will measure it.';

/**
 * Author-supplied fields needed to select and populate a new document template.
 */
export type Draft = {
  format?: 'md' | 'mdx';
  slug: string;
  title: string;
} & ({ kind: 'set' | 'release' } | { kind: 'item'; set: string; release?: string });

/**
 * Workspace identities and schedules used to validate scaffold references.
 */
type Catalog = Effect.Success<ReturnType<typeof readCatalog>>;

/**
 * Relative destination and frontmatter to write under an exclusive create.
 */
type NewDocument = {
  /**
   * Path relative to the workspace, suitable for diagnostics and links.
   */
  file: string;

  /**
   * Frontmatter values serialized into the new Markdown file.
   */
  fields: Record<string, string>;
};

/**
 * A workspace or document that could not be scaffolded, with the reason shown to the author.
 */
export class ScaffoldError extends Schema.TaggedError<
  ScaffoldError,
  {
    /**
     * Distinguishes scaffold errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('ScaffoldError', {
  /**
   * Explains why nothing was written.
   */
  message: Schema.String,
}) {}

/**
 * Copies a packaged starter into a destination, rejecting collisions before copying any files.
 *
 * @param target The directory to initialize.
 * @param template The starter to copy.
 * @returns An effect that copies every starter file or none.
 */
export const scaffoldWorkspace = Effect.fn('scaffoldWorkspace')(function* (
  target: string,
  template: TemplateName = DEFAULT_TEMPLATE,
) {
  const root = yield* attempt(() => canonicalDestination(target));
  const starter = yield* starterDirectory(template);
  const files = yield* starterFiles(starter);
  const destinations: Array<{ source: string | undefined; destination: string }> = [
    ...files.map((source) => ({ source, destination: join(root, relative(starter, source)) })),
    { source: undefined, destination: join(root, AGENTS_FILE) },
  ];
  yield* Effect.forEach(
    destinations,
    ({ destination }) =>
      attempt(async () => {
        await checkDirectory(dirname(destination));
        await checkAbsent(destination);
      }),
    { discard: true },
  );

  const directories: Array<string> = [];
  const copied: Array<string> = [];
  // Each copy finishes and is recorded (inside one uninterruptible step) before an interruption is
  // observed, so the rollback never runs while a file it does not know about is being created.
  yield* Effect.forEach(
    destinations,
    ({ source, destination }) =>
      attempt(async () => {
        await ensureDirectory(dirname(destination), directories);
        await (source === undefined
          ? writeExclusive(destination, AGENTS_GUIDE)
          : copyFile(source, destination, constants.COPYFILE_EXCL));
        copied.push(destination);
      }),
    { discard: true },
  ).pipe(
    Effect.onError(() =>
      Effect.forEach(copied, (path) => attempt(() => unlink(path)).pipe(Effect.ignore), {
        discard: true,
      }).pipe(Effect.andThen(removeDirectories(directories))),
    ),
  );
});

/**
 * Finds the packaged directory of a starter template.
 */
function starterDirectory(template: TemplateName): Effect.Effect<string, ScaffoldError> {
  const directory = TEMPLATES.find((candidate) => candidate.name === template)?.directory;
  return directory === undefined
    ? failWith(`Unknown template "${template}".`)
    : Effect.succeed(directory);
}

/**
 * Promise facade over {@link scaffoldWorkspace}.
 *
 * @param target The directory to initialize.
 * @returns A promise that settles once the starter is copied.
 */
export function initWorkspace(
  target: string,
  template: TemplateName = DEFAULT_TEMPLATE,
): Promise<void> {
  return runPromise(scaffoldWorkspace(target, template));
}

/**
 * Writes one new Markdown file under the workspace lock, rejecting collisions.
 *
 * @param root The workspace directory.
 * @param draft The document kind, slug, title and parent references.
 * @returns The new file's workspace-relative path.
 */
export const scaffoldDocument = Effect.fn('scaffoldDocument')(function* (
  root: string,
  draft: Draft,
) {
  if (!SLUG_PATTERN.test(draft.slug)) {
    return yield* failWith('Use a lowercase slug made of letters, digits and single hyphens.');
  }

  if (!draft.title.trim()) {
    return yield* failWith('Provide a nonblank title.');
  }

  const canonicalRoot = yield* attempt(() => realpath(root));
  return yield* Effect.scoped(
    workspaceLock(canonicalRoot).pipe(Effect.andThen(createDocument(canonicalRoot, draft))),
  );
});

/**
 * Promise facade over {@link scaffoldDocument}.
 *
 * @param root The workspace directory.
 * @param draft The document kind, slug, title and parent references.
 * @returns The new file's workspace-relative path.
 */
export function newDocument(root: string, draft: Draft): Promise<string> {
  return runPromise(scaffoldDocument(root, draft));
}

/**
 * Serializes concurrent scaffolds in one workspace for the rest of the scope.
 */
function workspaceLock(canonicalRoot: string) {
  return Effect.acquireRelease(
    attempt(() =>
      lockfile.lock(canonicalRoot, {
        lockfilePath: join(canonicalRoot, '.roadmap-new-lock'),
        retries: { retries: 8, minTimeout: 15, maxTimeout: 200 },
      }),
    ),
    (release) => Effect.promise(() => release()),
  );
}

/**
 * Resolves the template against the current workspace and writes it without overwriting.
 */
const createDocument = Effect.fnUntraced(function* (canonicalRoot: string, draft: Draft) {
  const catalog = yield* readCatalog(canonicalRoot);
  if (catalog.documents.some((document) => document.id === draft.slug)) {
    return yield* failWith(`ID "${draft.slug}" already exists in the workspace.`);
  }

  const { file, fields } = yield* makeDocument(draft, catalog);
  // A feature set has one README, so `--format mdx` must not add one beside `README.md`.
  const readmes = draft.kind === 'set' ? ['README.md', 'README.mdx'] : [];
  for (const readme of readmes.map((name) => `${dirname(file)}/${name}`)) {
    if (yield* attempt(() => pathStatus(join(canonicalRoot, readme)))) {
      return yield* failWith(`${readme} already exists; choose another feature set slug.`);
    }
  }

  const target = join(canonicalRoot, file);
  const frontMatter = stringify({
    id: draft.slug,
    title: draft.title,
    description: PLACEHOLDER_DESCRIPTION,
    ...fields,
  });
  const content = ['---', frontMatter.trimEnd(), '---', ''].join('\n');

  const directories: Array<string> = [];
  yield* attempt(async () => {
    await ensureDirectory(dirname(target), directories);
    await writeExclusive(target, content);
  }).pipe(Effect.onError(() => removeDirectories(directories)));
  return file;
});

/**
 * Resolves existing path ancestors when a destination does not exist yet.
 */
async function canonicalDestination(path: string): Promise<string> {
  const status = await pathStatus(path);
  if (status) {
    if (!status.isDirectory() && !status.isSymbolicLink()) {
      throw new Error(`Expected a directory at ${path}.`);
    }

    return realpath(path);
  }

  return join(await canonicalDestination(dirname(path)), basename(path));
}

/**
 * Creates a new file and removes incomplete output if writing fails.
 */
async function writeExclusive(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

/**
 * Enumerates the packaged files to copy into an initialized workspace, in sorted order.
 */
function starterFiles(directory: string): Effect.Effect<Array<string>, ScaffoldError> {
  return attempt(() => readdir(directory, { withFileTypes: true })).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return starterFiles(path);
        }

        return entry.isFile()
          ? Effect.succeed([path])
          : failWith(`Starter content must be a regular file or directory: ${path}`);
      }),
    ),
    Effect.map((nested) => nested.flat().toSorted()),
  );
}

/**
 * Checks that a scaffold parent can be used as a directory.
 */
async function checkDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (path !== parent) {
    await checkDirectory(parent);
  }

  const status = await pathStatus(path);
  if (status && !status.isDirectory()) {
    throw new Error(`Expected a directory at ${path}.`);
  }
}

/**
 * Rejects an existing destination before the scaffold writes any files.
 */
async function checkAbsent(path: string): Promise<void> {
  if (await pathStatus(path)) {
    throw new Error(`Cannot initialize because ${path} already exists.`);
  }
}

/**
 * Creates missing parents and records them for rollback.
 */
async function ensureDirectory(path: string, created: Array<string>): Promise<void> {
  const parent = dirname(path);
  if (path !== parent) {
    await ensureDirectory(parent, created);
  }

  const status = await pathStatus(path);
  if (status?.isDirectory()) {
    return;
  }

  if (status) {
    throw new Error(`Expected a directory at ${path}.`);
  }

  await mkdir(path);
  created.push(path);
}

/**
 * Reads entry metadata, preserving errors other than a missing entry.
 */
async function pathStatus(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Removes newly created, empty scaffold directories during rollback. `rmdir` never deletes content
 * that appeared meanwhile.
 */
function removeDirectories(directories: Array<string>): Effect.Effect<void> {
  return Effect.forEach(
    directories.toReversed(),
    (directory) => attempt(() => rmdir(directory)).pipe(Effect.ignore),
    { discard: true },
  );
}

/**
 * Compiles workspace metadata used to look up parent IDs and default owners.
 */
function readCatalog(root: string) {
  return Effect.gen(function* () {
    const diagnostics: Array<Diagnostic> = [];
    const source = yield* readWorkspace(root, diagnostics).pipe(
      Effect.mapError((error) => new ScaffoldError({ message: error.message })),
    );
    if (source === undefined) {
      return yield* failWith(diagnostics.map(diagnosticText).join('\n'));
    }

    const files = yield* discover(root, []);
    const parsed = yield* Effect.forEach(files, (file) =>
      readSource(root, file.file, schemaFor(file.kind), {
        diagnostics: [],
        frontMatter: true,
      }).pipe(Effect.map((document) => (document ? { ...file, ...document.data } : undefined))),
    );
    const documents = parsed.filter((document) => document !== undefined);
    return { ...source, documents };
  });
}

/**
 * Chooses a destination and supplies the required frontmatter for the document kind.
 */
function makeDocument(draft: Draft, catalog: Catalog): Effect.Effect<NewDocument, ScaffoldError> {
  const { slug, format = 'md' } = draft;
  let document: Effect.Effect<NewDocument, ScaffoldError>;
  switch (draft.kind) {
    case 'set':
      document = Effect.all({
        pm: firstRegistryId(catalog, 'people', 'person'),
        team: firstRegistryId(catalog, 'teams', 'team'),
      }).pipe(
        Effect.map(({ pm, team }) => ({
          file: `feature-sets/${slug}/README.${format}`,
          fields: { outcome: PLACEHOLDER_OUTCOME, pm, engineering_team: team },
        })),
      );
      break;
    case 'item': {
      const fields = { outcome: PLACEHOLDER_OUTCOME, status: 'proposed' };
      const { release } = draft;
      document = Effect.all({
        folder: featureSetFolder(draft.set, catalog),
        scheduled:
          release === undefined
            ? Effect.succeed(fields)
            : scheduledFields(release, catalog, fields),
      }).pipe(
        Effect.map(({ folder, scheduled }) => ({
          file: `feature-sets/${folder}/items/${slug}.${format}`,
          fields: scheduled,
        })),
      );
      break;
    }
    case 'release':
      document = Effect.succeed({
        file: `releases/${slug}.${format}`,
        fields: { outcome: PLACEHOLDER_OUTCOME, status: 'planned', target: today() },
      });
      break;
  }

  return document;
}

/**
 * Adds the canonical release ID to a new item's frontmatter.
 */
function scheduledFields(
  release: string,
  catalog: Catalog,
  fields: Record<string, string>,
): Effect.Effect<Record<string, string>, ScaffoldError> {
  return findRelease(release, catalog).pipe(
    Effect.map((found) => ({ ...fields, release: found.id })),
  );
}

/**
 * Selects a deterministic initial owner from a nonempty registry.
 */
function firstRegistryId(
  catalog: Catalog,
  registry: 'people' | 'teams',
  label: string,
): Effect.Effect<string, ScaffoldError> {
  const id = Object.keys(catalog.workspace[registry]).toSorted()[0];
  if (id === undefined) {
    const file = catalog.registryFiles[registry];
    return failWith(`Add a ${label} entry to the ${registry} registry in ${file} first.`);
  }

  return Effect.succeed(id);
}

/**
 * Finds the source folder for a feature set identified by its ID or folder name.
 */
function featureSetFolder(name: string, catalog: Catalog): Effect.Effect<string, ScaffoldError> {
  const sets = catalog.documents.filter((document) => document.kind === 'set');
  const byId = sets.find((document) => document.id === name);
  const byFolder = sets.find((document) => document.setDirectory === name);
  if (byId && byFolder && byId !== byFolder) {
    return failWith(`"${name}" matches both a feature set ID and a different feature set folder.`);
  }

  const folder = (byId ?? byFolder)?.setDirectory;
  if (folder === undefined) {
    return failWith(`Cannot find a feature set with ID or folder "${name}".`);
  }

  return Effect.succeed(folder);
}

/**
 * Looks up the release a new item is scheduled in.
 */
function findRelease(
  id: string,
  catalog: Catalog,
): Effect.Effect<{ id: string; target: string }, ScaffoldError> {
  for (const document of catalog.documents) {
    const isRequestedRelease = document.kind === 'release' && document.id === id;
    if (isRequestedRelease && 'target' in document && document.target) {
      return Effect.succeed({ id, target: document.target });
    }
  }

  return failWith(`Cannot find a release with ID "${id}".`);
}

/**
 * Formats the current UTC calendar day for a new release target.
 */
function today(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

/**
 * Fails the scaffold with an author-facing message.
 */
function failWith(message: string): Effect.Effect<never, ScaffoldError> {
  return Effect.fail(new ScaffoldError({ message }));
}

/**
 * Runs one filesystem or workspace step, keeping the underlying error's message. The step is not
 * interruptible: an interrupted promise keeps running, so a rollback could otherwise finish before
 * a copy or write it has not yet recorded.
 */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, ScaffoldError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ScaffoldError({ message: errorText(cause) }),
  }).pipe(Effect.uninterruptible);
}
