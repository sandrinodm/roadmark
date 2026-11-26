import type { FileSystem } from 'effect';

import { Effect, Predicate } from 'effect';
import { resolve } from 'node:path';

import type { Markdown } from './markdown.ts';
import type { Compilation, Diagnostic, Entity, Workspace } from './model.ts';
import type { EntityFile, Source } from './source.ts';

import { readBrand } from './brand.ts';
import { CodeBlocks } from './code-blocks.ts';
import { ContentError, MdxError } from './errors.ts';
import { validateGraph } from './graph.ts';
import { LinkResolver } from './markdown-links.ts';
import { parseMarkdown } from './markdown.ts';
import { MediaCatalog } from './media.ts';
import { renderMarkdown } from './render-markdown.ts';
import { errorText, runPromise } from './run.ts';
import { schemaFor, SLUG_PATTERN } from './schemas.ts';
import { addDiagnostic, discover, fileStart, readSource } from './source.ts';
import { readWorkspace } from './workspace.ts';

/**
 * Decoded frontmatter and Markdown kept together through ownership and link resolution.
 */
type EntitySource = Source<Entity> & {
  markdownBody: Markdown;
  setDirectory?: string;
};

/**
 * Fallback metadata used while reporting an invalid workspace.
 */
const EMPTY_WORKSPACE: Workspace = {
  /**
   * Version reported when workspace decoding failed.
   */
  schema_version: 1,

  /**
   * Display title used while reporting a workspace configuration error.
   */
  title: 'Roadmap',

  /**
   * Empty people registry used while collecting workspace errors.
   */
  people: {},

  /**
   * Empty team registry used while collecting workspace errors.
   */
  teams: {},
};

/**
 * Entity files read at once. Each read returns its own diagnostics, concatenated in file order, so
 * the report is identical to a sequential read.
 */
const READ_CONCURRENCY = 8;

/**
 * A compiled MDX document waiting to be executed.
 */
type MdxBundle = {
  /**
   * CommonJS bundle of the document and its local imports.
   */
  code: string;

  /**
   * Absolute path of the document.
   */
  filename: string;
};

/**
 * A decoded document whose body is parsed Markdown or an MDX bundle not yet executed.
 */
type PendingEntity = {
  /**
   * Parsed Markdown, or the MDX bundle that renders it.
   */
  body: Markdown | MdxBundle;

  /**
   * Workspace-relative path and body offset, for locating execution errors.
   */
  source: Source<unknown>;

  /**
   * Builds the entity once its body is known.
   */
  finish: (markdownBody: Markdown) => EntitySource;
};

/**
 * One file's decoded document, or undefined, with the diagnostics found while reading it.
 */
type EntityRead = {
  /**
   * The decoded document, unless reading, decoding or compiling failed.
   */
  pending: PendingEntity | undefined;

  /**
   * Problems found in this file, in the order they were found.
   */
  diagnostics: Array<Diagnostic>;
};

/**
 * Compiles workspace content and reports author errors as diagnostics.
 *
 * @param root Path to the workspace directory, resolved against the working directory.
 * @param base Slash-terminated deployment prefix used for rendered links and media URLs.
 * @returns The compiled workspace, records, publication assets and source-located findings.
 */
export const compileWorkspace = Effect.fn('compileWorkspace')(function* (
  root: string,
  base: string,
): Effect.fn.Return<Compilation, ContentError, FileSystem.FileSystem> {
  const workspaceRoot = resolve(root);
  const diagnostics: Array<Diagnostic> = [];
  const workspaceSource = yield* readWorkspace(workspaceRoot, diagnostics);
  const files = yield* discover(workspaceRoot, diagnostics);
  const reads = yield* Effect.forEach(files, (file) => readEntity(workspaceRoot, file), {
    concurrency: READ_CONCURRENCY,
  });
  // MDX documents run trusted code that may share process-wide state, so they execute one at a
  // time in discovery order, as a sequential compiler would.
  const sources = yield* Effect.forEach(reads, (read) =>
    finishEntity(read).pipe(
      Effect.tap(() => Effect.sync(() => diagnostics.push(...read.diagnostics))),
    ),
  ).pipe(Effect.map((entities) => entities.filter((source) => source !== undefined)));
  assignParentSets(sources, diagnostics);
  validateGraph(workspaceSource, sources, diagnostics);

  const entities = sources.map(({ data }) => data);
  const blocks = new CodeBlocks(workspaceRoot, entities);
  const media = new MediaCatalog(workspaceRoot, diagnostics);
  const brand = yield* readBrand(workspaceRoot, diagnostics, media.assets);
  const docs = sources.map(({ data, markdownBody }) => ({
    ...data,
    anchors: markdownBody.anchors,
  }));
  const links = new LinkResolver(base, docs, media, diagnostics);
  // Rendering shares the media catalog, diagram list and link resolver, so it stays sequential.
  yield* Effect.forEach(
    sources,
    (source) =>
      Effect.tryPromise({
        try: () =>
          renderMarkdown({
            markdown: source.markdownBody,
            blocks,
            file: source.file,
            lineOffset: source.bodyLineOffset,
            base,
            links,
            diagnostics,
          }),
        catch: (cause) => new ContentError({ message: errorText(cause) }),
      }).pipe(Effect.map((html) => (source.data.html = html))),
    { discard: true },
  );

  diagnostics.sort(compareDiagnostics);
  const theme: Pick<Compilation, 'brand'> = {};
  if (brand !== undefined) {
    theme.brand = brand;
  }

  return {
    workspace: workspaceSource?.workspace ?? EMPTY_WORKSPACE,
    ...theme,
    entities,
    assets: [...media.assets.values(), ...(workspaceSource?.avatars ?? [])],
    diagrams: blocks.diagrams,
    diagnostics,
  };
});

/**
 * Promise facade over {@link compileWorkspace} for callers outside Effect.
 *
 * @param root Path to the workspace directory, resolved against the working directory.
 * @param base Slash-terminated deployment prefix used for rendered links and media URLs.
 * @returns The compiled workspace, records, publication assets and source-located findings.
 */
export function compile(root: string, base = '/'): Promise<Compilation> {
  return runPromise(compileWorkspace(root, base));
}

/**
 * Reads, decodes and parses (or, for MDX, compiles) one entity file, collecting its diagnostics
 * locally.
 */
const readEntity = Effect.fnUntraced(function* (root: string, file: EntityFile) {
  const diagnostics: Array<Diagnostic> = [];
  const skip: EntityRead = { pending: undefined, diagnostics };
  const directory = file.setDirectory;
  if (directory !== undefined && !SLUG_PATTERN.test(directory)) {
    addDiagnostic(diagnostics, fileStart(file.file), {
      severity: 'error',
      rule: 'invalid-feature-set-folder',
      message: `The feature-set folder "${directory}" needs a lowercase slug.`,
      fix: 'Rename the feature-set folder using lowercase letters, digits and single hyphens.',
    });
    return skip;
  }

  const options = { diagnostics, frontMatter: true };
  const source = yield* readSource(root, file.file, schemaFor(file.kind), options);
  if (source === undefined) {
    return skip;
  }

  const body = yield* readBody(root, source, diagnostics);
  if (body === undefined) {
    return skip;
  }

  /**
   * Builds the normalized record around the rendered body.
   */
  const finish = (markdownBody: Markdown): EntitySource => {
    const data = entityData(file, source.data, markdownBody);
    const result: EntitySource = { ...source, data, markdownBody };
    if (directory !== undefined) {
      result.setDirectory = directory;
    }

    return result;
  };
  return { pending: { body, source, finish }, diagnostics } satisfies EntityRead;
});

/**
 * Executes a pending MDX document, if any, and completes the entity.
 */
const finishEntity = Effect.fnUntraced(function* (read: EntityRead) {
  const pending = read.pending;
  if (pending === undefined) {
    return undefined;
  }

  if (!('code' in pending.body)) {
    return pending.finish(pending.body);
  }

  const { code, filename } = pending.body;
  const markdownBody = yield* mdxStep(async () => {
    const mdx = await import('./mdx.ts');
    return mdx.runMdx(code, filename);
  }).pipe(Effect.map(parseMarkdown), recoverMdx(pending.source, read.diagnostics));
  return markdownBody === undefined ? undefined : pending.finish(markdownBody);
});

/**
 * Frontmatter inferred from the document schemas before graph resolution.
 */
type Metadata = ReturnType<typeof schemaFor<Entity['kind']>>['Type'];

/**
 * Builds a normalized record whose HTML is filled after cross-document links can resolve.
 */
function entityData(file: EntityFile, metadata: Metadata, body: Markdown): Entity {
  return {
    ...metadata,
    kind: file.kind,
    source: file.file,
    html: '',
    text: body.text,
    ...itemArrays(metadata),
  };
}

/**
 * Supplies empty relation arrays for omitted or inapplicable fields.
 */
function itemArrays(
  metadata: Metadata,
): Pick<Entity, 'contributing_teams' | 'depends_on' | 'jira'> {
  const contributingTeams = 'contributing_teams' in metadata ? metadata.contributing_teams : [];
  const dependsOn = 'depends_on' in metadata ? metadata.depends_on : [];
  const jira = 'jira' in metadata ? metadata.jira : [];
  return {
    contributing_teams: [...contributingTeams],
    depends_on: [...dependsOn],
    jira: [...jira],
  };
}

/**
 * Resolves the enclosing feature-set folder to its stable ID.
 */
function assignParentSets(sources: Array<EntitySource>, diagnostics: Array<Diagnostic>): void {
  const sets = new Map<string, string>();
  for (const { data, setDirectory, file } of sources) {
    if (data.kind === 'set' && setDirectory !== undefined) {
      if (sets.has(setDirectory)) {
        addDiagnostic(diagnostics, fileStart(file), {
          severity: 'error',
          rule: 'duplicate-feature-set-readme',
          message: 'Two briefs define the feature set in ' + setDirectory + '.',
          fix: 'Keep one README.md or README.mdx in the feature-set directory.',
        });
        continue;
      }

      sets.set(setDirectory, data.id);
    }
  }

  for (const { data, setDirectory } of sources) {
    if (data.kind !== 'item' || setDirectory === undefined) {
      continue;
    }

    const parent = sets.get(setDirectory);
    if (parent !== undefined) {
      data.set = parent;
    }
  }
}

/**
 * Orders findings by workspace-relative path, then by line and column.
 */
function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  if (left.file !== right.file) {
    return left.file < right.file ? -1 : 1;
  }

  return left.line - right.line || left.column - right.column;
}

/**
 * Compiles executable MDX only for an explicitly named MDX document; it runs later, in order.
 * Ordinary Markdown uses the existing parser. Both formats share heading allocation, search
 * extraction and link checking.
 */
function readBody(
  root: string,
  source: Source<unknown>,
  diagnostics: Array<Diagnostic>,
): Effect.Effect<Markdown | MdxBundle | undefined> {
  if (!source.file.endsWith('.mdx')) {
    return Effect.succeed(parseMarkdown(source.markdown));
  }

  const filename = resolve(root, source.file);
  return mdxStep(async () => {
    const mdx = await import('./mdx.ts');
    return { code: await mdx.bundleMdx(source.markdown, filename), filename };
  }).pipe(recoverMdx(source, diagnostics));
}

/**
 * Reports an MDX failure at its authored position and skips the document.
 */
function recoverMdx(source: Source<unknown>, diagnostics: Array<Diagnostic>) {
  return <A>(effect: Effect.Effect<A, MdxError>): Effect.Effect<A | undefined> =>
    Effect.catchTag(effect, 'MdxError', (error) =>
      Effect.sync(() => {
        addDiagnostic(
          diagnostics,
          { file: source.file, line: source.bodyLineOffset + error.line, column: error.column },
          {
            severity: 'error',
            rule: 'mdx',
            message: error.message,
            fix: 'Check the MDX expression, component name and imported module path.',
          },
        );
        return undefined;
      }),
    );
}

/**
 * Runs one MDX compile or execute step (the compiler is loaded on first use), keeping the
 * compiler's line and column.
 */
function mdxStep<A>(run: () => Promise<A>): Effect.Effect<A, MdxError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const line = Predicate.hasProperty(cause, 'line') ? cause.line : undefined;
      const column = Predicate.hasProperty(cause, 'column') ? cause.column : undefined;
      return new MdxError({
        message: errorText(cause),
        line: cause instanceof Error && typeof line === 'number' ? line : 1,
        column: cause instanceof Error && typeof column === 'number' ? column : 1,
      });
    },
  });
}
