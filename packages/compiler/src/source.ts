import type { Schema } from 'effect';
import type { DirectoryEntry } from 'effect/FileSystem';

import { Effect, FileSystem } from 'effect';
import { lstat, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { ParseOptions } from './front-matter.ts';
import type { Diagnostic, Kind } from './model.ts';
import type { Source } from './positions.ts';

import { ContentError } from './errors.ts';
import { parseSource } from './front-matter.ts';
import { addDiagnostic, fileStart } from './positions.ts';
import { errorText, hasCode } from './run.ts';

export type { Position, Source } from './positions.ts';
export { addDiagnostic, fileStart } from './positions.ts';

/**
 * Identifies misplaced Markdown for authoring diagnostics.
 */
const MARKDOWN_EXTENSION = /\.mdx?$/i;

/**
 * Recognizes the required feature-set README location.
 */
const SET_FILE = /^feature-sets\/([^/]+)\/README\.mdx?$/;

/**
 * Extracts the feature-set folder from a valid item path.
 */
const ITEM_FILE = /^feature-sets\/([^/]+)\/items\/[^/]+\.mdx?$/;

/**
 * Matches release briefs directly inside the releases folder.
 */
const RELEASE_FILE = /^releases\/[^/]+\.mdx?$/;

/**
 * Rejects ambiguous or escaping source path components.
 */
const UNSAFE_PATH_PART = /^(?:\.{1,2})?$|\\/;

/**
 * Source roots searched for roadmap documents.
 */
const AUTHOR_DIRECTORIES = ['feature-sets', 'releases'];

/**
 * Folder of the milestone briefs the format used to support.
 */
const REMOVED_MILESTONES = 'milestones';

/**
 * The path convention for an entity document, before its metadata is parsed.
 */
export type EntityFile = {
  /**
   * Path relative to the workspace, suitable for diagnostics and links.
   */
  file: string;

  /**
   * Discriminator that selects the schema and downstream rendering behavior.
   */
  kind: Kind;

  /**
   * Name of the enclosing feature-set folder during source discovery.
   */
  setDirectory?: string;
};

/**
 * Where a directory walk records recognized files and problems, in traversal order.
 */
type Walk = {
  /**
   * Recognized entity files.
   */
  files: Array<EntityFile>;

  /**
   * Layout and path problems found while walking.
   */
  diagnostics: Array<Diagnostic>;
};

/**
 * Checks whether an optional workspace file should be passed to the source reader.
 *
 * @param root The workspace directory.
 * @param file The workspace-relative filename to inspect.
 * @returns False if the entry is missing, true if it exists or the source reader must diagnose it.
 */
export async function fileExists(root: string, file: string): Promise<boolean> {
  try {
    await lstat(join(root, file));
    return true;
  } catch (error) {
    return !hasCode(error, 'ENOENT');
  }
}

/**
 * Lists layout-recognized Markdown files and warns about misplaced Markdown in content folders.
 * Directories are walked in name order without following symbolic links.
 *
 * @param root The workspace directory.
 * @param diagnostics Receives layout and path problems.
 * @returns The recognized entity files in traversal order.
 */
export function discover(
  root: string,
  diagnostics: Array<Diagnostic>,
): Effect.Effect<Array<EntityFile>, never, FileSystem.FileSystem> {
  // Each run walks into its own list, so running the effect again never extends an earlier result.
  return Effect.suspend(() => {
    const walk: Walk = { files: [], diagnostics };
    return Effect.forEach(AUTHOR_DIRECTORIES, (folder) => discoverUnder(root, folder, walk), {
      discard: true,
    }).pipe(Effect.andThen(rejectMilestones(root, diagnostics)), Effect.as(walk.files));
  });
}

/**
 * Fails a workspace that still has a `milestones/` folder (even an empty one): milestones were
 * removed from the format, and silently skipping them would hide planned work.
 *
 * @param root The workspace directory.
 * @param diagnostics Receives the error.
 * @returns An effect that never fails.
 */
function rejectMilestones(
  root: string,
  diagnostics: Array<Diagnostic>,
): Effect.Effect<void, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.lstat(root + sep + REMOVED_MILESTONES);
    addDiagnostic(diagnostics, fileStart(REMOVED_MILESTONES), {
      severity: 'error',
      rule: 'removed-milestones',
      message:
        'Milestones are no longer part of the roadmap format; the milestones/ folder is not read.',
      fix: 'Delete the milestones/ folder, move any dates you still need into release or item targets, and remove milestone: from item frontmatter.',
    });
  }).pipe(Effect.ignore);
}

/**
 * Reads YAML configuration or Markdown frontmatter without following symbolic links.
 *
 * @param root Workspace directory.
 * @param file Slash-separated path relative to the workspace.
 * @param schema Runtime decoder for this file's YAML.
 * @param options Receives read, parse or schema errors; requires front matter when set.
 * @returns Decoded source and field locations, or undefined if the file cannot be decoded.
 */
export function readSource<S extends Schema.Decoder<unknown>>(
  root: string,
  file: string,
  schema: S,
  options: ParseOptions,
): Effect.Effect<Source<S['Type']> | undefined> {
  const text = Effect.tryPromise({
    try: async () => readFile(await safeFile(root, file), 'utf8'),
    catch: (cause) => new ContentError({ message: errorText(cause) }),
  });
  return text.pipe(
    Effect.map((contents) => parseSource(file, contents, schema, options)),
    Effect.orElseSucceed(() => {
      addDiagnostic(options.diagnostics, fileStart(file), {
        severity: 'error',
        rule: 'unreadable-source',
        message: `Could not read ${file} as a regular workspace file.`,
        fix: 'Create the file or replace its symbolic link with a regular file.',
      });
      return undefined;
    }),
  );
}

/**
 * Resolves a workspace-relative file while rejecting symbolic links and non-regular entries.
 *
 * @param root Workspace directory.
 * @param relativeFile Slash-separated path relative to the workspace.
 * @returns The absolute path of the regular file.
 */
export async function safeFile(root: string, relativeFile: string): Promise<string> {
  const parts = relativeFile.split('/');
  const paths = parts.map((_, index) => root + sep + parts.slice(0, index + 1).join(sep));
  // Components are checked in order, each with lstat, so a link anywhere on the path is refused.
  await parts.reduce(async (previous, part, index) => {
    await previous;
    if (UNSAFE_PATH_PART.test(part)) {
      throw new Error('Expected a normalized workspace-relative path.');
    }

    const info = await lstat(paths[index] ?? root);
    const acceptable = index === parts.length - 1 ? info.isFile() : info.isDirectory();
    if (!acceptable) {
      throw new Error('Expected a regular workspace file without symbolic links.');
    }
  }, Promise.resolve());
  return paths.at(-1) ?? root;
}

/**
 * Orders names by UTF-16 code units, independent of locale.
 *
 * @param left The first name.
 * @param right The second name.
 * @returns A negative, zero or positive comparison result.
 */
export function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * Walks one content directory in name order. A missing directory is silent; any other failure is
 * reported as an unsafe path.
 */
function discoverUnder(
  root: string,
  directory: string,
  walk: Walk,
): Effect.Effect<void, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directoryPath = root + sep + directory;
    if ((yield* fs.lstat(directoryPath)).type !== 'Directory') {
      unsafeSource(directory, walk.diagnostics);
      return;
    }

    const entries = yield* fs.readDirectoryEntries(directoryPath);
    const sorted = entries.toSorted((left, right) => compareNames(left.name, right.name));
    yield* Effect.forEach(sorted, (entry) => visit(root, directory, entry, walk), {
      discard: true,
    });
  }).pipe(
    Effect.catch((error) =>
      hasCode(error.reason.cause, 'ENOENT')
        ? Effect.void
        : Effect.sync(() => unsafeSource(directory, walk.diagnostics)),
    ),
  );
}

/**
 * Descends into a directory entry, records a Markdown file or rejects a symbolic link.
 */
function visit(
  root: string,
  directory: string,
  entry: DirectoryEntry,
  walk: Walk,
): Effect.Effect<void, never, FileSystem.FileSystem> {
  if (entry.name.startsWith('.')) {
    return Effect.void;
  }

  const file = `${directory}/${entry.name}`;
  if (entry.type === 'Directory') {
    return discoverUnder(root, file, walk);
  }

  if (entry.type === 'SymbolicLink') {
    unsafeSource(file, walk.diagnostics);
  } else if (entry.type === 'File' && MARKDOWN_EXTENSION.test(entry.name)) {
    discoverFile(file, walk.files, walk.diagnostics);
  }

  return Effect.void;
}

/**
 * Reports an unsafe source path at the start of the affected file.
 */
function unsafeSource(file: string, diagnostics: Array<Diagnostic>): void {
  addDiagnostic(diagnostics, fileStart(file), {
    severity: 'error',
    rule: 'unsafe-path',
    message: `Cannot read ${file} as workspace content.`,
    fix: 'Use a regular file or directory inside the workspace instead of a symbolic link.',
  });
}

/**
 * Classifies one author file or explains a misplaced Markdown document.
 */
function discoverFile(
  file: string,
  files: Array<EntityFile>,
  diagnostics: Array<Diagnostic>,
): void {
  const setDirectory = SET_FILE.exec(file)?.[1];
  const itemDirectory = ITEM_FILE.exec(file)?.[1];
  if (setDirectory !== undefined) {
    files.push({ file, kind: 'set', setDirectory });
  } else if (itemDirectory !== undefined) {
    files.push({ file, kind: 'item', setDirectory: itemDirectory });
  } else if (RELEASE_FILE.test(file)) {
    files.push({ file, kind: 'release' });
  } else {
    addDiagnostic(diagnostics, fileStart(file), {
      severity: 'warning',
      rule: 'misplaced-markdown',
      message: `${file} is outside the authoring layout and will be skipped.`,
      fix: 'Move the file to a feature set, its items folder or releases.',
    });
  }
}
