import type { Code } from 'mdast';
import type { MermaidConfig } from 'mermaid';

import { Predicate } from 'effect';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Diagnostic, Entity } from './model.ts';
import type { Position } from './source.ts';

import { dependencyDiagram } from './dependency-diagram.ts';
import { escapeHtml } from './markdown.ts';
import { addDiagnostic, safeFile } from './source.ts';

/**
 * Resolves code includes and collects the static diagram images for one compilation.
 */
export class CodeBlocks {
  /**
   * Root used to confine workspace-relative source includes.
   */
  private readonly root: string;

  /**
   * Content-addressed SVGs shared by pages containing the same diagram.
   */
  readonly diagrams = new Map<string, string>();

  /**
   * Published diagram file for each Mermaid source already rendered in this build.
   */
  private readonly diagramNames = new Map<string, DiagramFile>();

  /**
   * Resolved roadmap records used by diagrams derived from item relationships.
   */
  private readonly entities: ReadonlyArray<Entity>;

  constructor(root: string, entities: ReadonlyArray<Entity>) {
    this.entities = entities;
    this.root = root;
  }

  /**
   * Renders a language fence or a source include and reports failures at the original fence.
   */
  async render(
    node: Code,
    position: Position,
    base: string,
    diagnostics: Array<Diagnostic>,
  ): Promise<string> {
    try {
      if (node.lang === 'roadmap-dependencies') {
        return dependencyDiagram(this.entities, position.file, base);
      }

      const options = fenceOptions(node.meta ?? '');
      const src = options.get('src');
      const title = options.get('title') ?? options.get('file') ?? src;
      const source = src === undefined ? node.value : await this.readInclude(src, node, position);
      const language = node.lang || (src && path.extname(src).slice(1)) || 'text';
      if (language === 'mermaid' || language === 'mmd') {
        return await this.renderMermaid(source, base, title);
      }

      const html = await highlight(source, language);
      return title
        ? `<figure class="code-listing"><figcaption>${escapeHtml(title)}</figcaption>${html}</figure>`
        : html;
    } catch (error) {
      addDiagnostic(diagnostics, position, {
        severity: 'error',
        rule: 'code-block',
        ...problem(error),
      });
      return '';
    }
  }

  /**
   * Reads a source include from an empty fence using the brief’s directory.
   */
  private async readInclude(src: string, node: Code, position: Position): Promise<string> {
    if (node.value.trim()) {
      throw new Error('A code include must have an empty fence body.');
    }

    const relative = path.posix.join(path.posix.dirname(position.file), src);
    if (path.isAbsolute(src)) {
      throw new Error('Use a source path relative to the brief.');
    }

    // Hidden files such as `.env` or `.git/config` often hold secrets and are never roadmap
    // content (discovery skips them too), so an include must not publish them. `..` is left to
    // `safeFile`, which refuses paths that leave the workspace.
    if (relative.split('/').some((part) => part.startsWith('.') && part !== '..')) {
      throw new IncludeError(
        `Refusing to include ${relative}: hidden files and folders (names starting with ".") are never published.`,
        'Move the source into a folder without a leading dot, or paste the snippet into the fence.',
      );
    }

    const contents = await readFile(await safeFile(this.root, relative), 'utf8');
    // An included file usually ends in a newline that an authored fence body never has.
    return contents.replace(/\n$/, '');
  }

  /**
   * Renders and caches a Mermaid diagram, then links to the shared SVG.
   */
  private async renderMermaid(
    source: string,
    base: string,
    title: string | undefined,
  ): Promise<string> {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize(mermaidConfig());
    const id = digest(source);
    let file = this.diagramNames.get(source);
    if (file === undefined) {
      const { svg } = await mermaid.render('diagram-' + id, source);
      // Name the file after its rendered bytes, so a theme or Mermaid upgrade changes the URL and
      // immutable caches never keep serving an old drawing under the same name.
      file = { name: 'diagrams/' + digest(svg) + '.svg', size: drawingSize(svg) };
      this.diagramNames.set(source, file);
      this.diagrams.set(file.name, svg);
    }

    const caption = escapeHtml(title ?? 'Mermaid diagram');
    const href = escapeHtml(base + file.name);
    const size = file.size ? ` width="${file.size.width}" height="${file.size.height}"` : '';
    return `<figure class="roadmap-diagram"><a href="${href}"><img src="${href}" alt="${caption}"${size} loading="lazy"></a><figcaption>${caption}</figcaption></figure>`;
  }
}

/**
 * An include refused for a reason that has its own author-facing fix.
 */
class IncludeError extends Error {
  /**
   * Structural marker read by `problem`, which must not rely on class identity.
   */
  readonly _tag = 'IncludeError';

  /**
   * What the author should change.
   */
  readonly fix: string;

  constructor(message: string, fix: string) {
    super(message);
    this.fix = fix;
  }
}

/**
 * Describes a failed fence, using the refusal's own fix when it carries one.
 */
function problem(error: unknown): Pick<Diagnostic, 'message' | 'fix'> {
  const message = error instanceof Error ? error.message : String(error);
  if (Predicate.isTagged(error, 'IncludeError') && Predicate.hasProperty(error, 'fix')) {
    return { message, fix: String(error.fix) };
  }

  return { message, fix: 'Check the source path, code fence options and diagram syntax.' };
}

/**
 * Reads a Deckster-style quoted filename or title from the fence information string.
 */
function fenceOptions(meta: string): Map<string, string> {
  const options = new Map<string, string>();
  const tokens = /([\w-]+)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"']+)|\S+/gu;
  for (const [token, key, value] of meta.matchAll(tokens)) {
    if (!key || !value) {
      if (/^(?:src|title|file)=/.test(token)) {
        throw new Error('Quote the complete filename or title in the code fence.');
      }

      continue;
    }

    const quoted = value.startsWith('"') || value.startsWith("'");
    options.set(key, quoted ? value.slice(1, -1).replaceAll(/\\(["'\\])/g, '$1') : value);
  }

  return options;
}

/**
 * A published diagram and the size Mermaid drew it at.
 */
type DiagramFile = {
  /**
   * Path of the SVG relative to the site root.
   */
  readonly name: string;

  /**
   * Natural size from the SVG view box, used so the page shows the drawing at its own scale.
   */
  readonly size: { readonly width: number; readonly height: number } | undefined;
};

/**
 * Reads the natural drawing size from the root view box. Mermaid sets `width="100%"`, so without
 * this an image would stretch every diagram to the column width.
 */
export function drawingSize(svg: string): DiagramFile['size'] {
  const box = /<svg\b[^>]*\bviewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/u.exec(svg);
  const width = Math.round(Number(box?.[1]));
  const height = Math.round(Number(box?.[2]));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Short, stable content fingerprint used in diagram ids and file names.
 */
function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

/**
 * Mermaid diagrams ship as standalone SVG files, so page CSS cannot reach them. The `base` theme
 * takes its colours from the site's light tokens (packages/web/src/styles/site.css) instead.
 */
function mermaidConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      background: '#ffffff',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
      primaryColor: '#e5edf8',
      primaryBorderColor: '#2457a6',
      primaryTextColor: '#141a24',
      secondaryColor: '#eceff4',
      secondaryBorderColor: '#b9c1ce',
      tertiaryColor: '#f3f5f8',
      tertiaryBorderColor: '#d8dde6',
      lineColor: '#586274',
      textColor: '#141a24',
      noteBkgColor: '#f6eedb',
      noteBorderColor: '#8a5f0f',
      noteTextColor: '#141a24',
    },
  };
}

/**
 * Highlights known languages at build time and preserves unknown or unlabeled snippets verbatim.
 */
async function highlight(code: string, language: string): Promise<string> {
  if (language !== 'text' && language !== 'plaintext') {
    const { bundledLanguages, bundledLanguagesAlias, codeToHtml } = await import('shiki');
    if (
      Object.hasOwn(bundledLanguages, language) ||
      Object.hasOwn(bundledLanguagesAlias, language)
    ) {
      return codeToHtml(code, { lang: language, theme: 'github-light' });
    }
  }

  return '<pre><code>' + escapeHtml(code) + '\n</code></pre>';
}
