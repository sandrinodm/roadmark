import type {
  Image,
  ImageReference,
  Link,
  LinkReference,
  List,
  Paragraph,
  Root,
  RootContent,
  Table,
} from 'mdast';

import type { CodeBlocks } from './code-blocks.ts';
import type { LinkResolver } from './markdown-links.ts';
import type { Markdown } from './markdown.ts';
import type { Media } from './media.ts';
import type { Diagnostic } from './model.ts';
import type { Position } from './source.ts';

import { escapeHtml, headingId } from './markdown.ts';
import { addDiagnostic } from './source.ts';

/**
 * Inputs shared while rendering the Markdown nodes of a single document.
 */
type Context = {
  /**
   * Parsed body and document-local reference definitions.
   */
  markdown: Markdown;

  /**
   * Code include resolver and generated diagram registry for this build.
   */
  blocks: CodeBlocks;

  /**
   * Workspace-relative source path used for link resolution and diagnostics.
   */
  file: string;

  /**
   * Number of source lines preceding the Markdown body.
   */
  lineOffset: number;

  /**
   * Slash-terminated deployment prefix used by the generated URLs.
   */
  base: string;

  /**
   * Resolver for local documents, fragments and media.
   */
  links: LinkResolver;

  /**
   * Shared diagnostic sink for issues found while rendering this body.
   */
  diagnostics: Array<Diagnostic>;

  /**
   * Indicates that an image is already inside a link label.
   */
  insideLink?: boolean;
};

/**
 * Inline and reference-style links handled by the same renderer.
 */
type LinkNode = Link | LinkReference;

/**
 * Inline and reference-style images handled by the same renderer.
 */
type ImageNode = Image | ImageReference;

/**
 * Authored URL and title obtained directly or from a Markdown reference definition.
 */
type Destination = Pick<Link, 'url' | 'title'>;

/**
 * Syntax tree node consumed by this traversal.
 */
type Node = Root | RootContent;

/**
 * Smallest heading level inside a brief, beneath the page title.
 */
const BODY_HEADING_MIN = 2;

/**
 * Display names used to label caption choices for readers.
 */
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

/**
 * Renders allowlisted Markdown elements with validated URLs and escaped author-controlled text.
 */
export async function renderMarkdown(context: Context): Promise<string> {
  return render(context.markdown.tree, context);
}

/**
 * Renderer for each Markdown node type; the mapped type keeps the table exhaustive.
 */
type Renderers = {
  readonly [K in Node['type']]: (
    node: Extract<Node, { type: K }>,
    context: Context,
  ) => string | Promise<string>;
};

/**
 * Renders nothing for definitions, rows outside tables, MDX nodes and YAML.
 */
const nothing = (): string => '';

/**
 * Escaped text and inline HTML, which is shown as text rather than trusted.
 */
const literal = (node: { value: string }): string => escapeHtml(node.value);

/**
 * Renders every supported Markdown node with escaped authored content.
 */
const RENDERERS: Renderers = {
  /**
   * Escaped plain text.
   */
  text: literal,

  /**
   * Inline HTML, shown as escaped text.
   */
  html: literal,

  /**
   * Inline code span.
   */
  inlineCode: (node) => tag('code', escapeHtml(node.value)),
  /**
   * Fenced code, a source include or a diagram, rendered by the code-block renderer.
   */
  code: (node, context) =>
    context.blocks.render(node, positionOf(node, context), context.base, context.diagnostics),
  /**
   * Allowed authored element wrapping its rendered children.
   */
  roadmapElement: async (node, context) =>
    node.open + (await renderAll(node.children, context)) + node.close,
  /**
   * Document root: blocks separated by newlines.
   */
  root: (node, context) => renderAll(node.children, context, '\n'),
  /**
   * Paragraph, or a standalone link or image.
   */
  paragraph,

  /**
   * Section heading, demoted below the page title, with its unique ID.
   */
  heading: async (node, context) => {
    const heading = `h${Math.max(BODY_HEADING_MIN, node.depth)}`;
    const id = headingId(context.markdown.headings.get(node) ?? '');
    const attributes = attr('id', id) + authoredAttributes(node, false);
    return tag(heading, await renderAll(node.children, context), attributes);
  },
  /**
   * Strong emphasis.
   */
  strong: (node, context) => wrap('strong', node.children, context),
  /**
   * Emphasis.
   */
  emphasis: (node, context) => wrap('em', node.children, context),
  /**
   * Strikethrough.
   */
  delete: (node, context) => wrap('del', node.children, context),
  /**
   * Block quotation.
   */
  blockquote: (node, context) => wrap('blockquote', node.children, context),
  /**
   * Ordered or unordered list.
   */
  list,

  /**
   * List item, with a disabled checkbox for task items.
   */
  listItem,

  /**
   * Inline link resolved against workspace documents and media.
   */
  link: (node, context) => link(node, context, false),
  /**
   * Reference-style link.
   */
  linkReference: (node, context) => link(node, context, false),
  /**
   * Inline image with alternative text.
   */
  image: (node, context) => image(node, context, false),
  /**
   * Reference-style image.
   */
  imageReference: (node, context) => image(node, context, false),
  /**
   * GFM table.
   */
  table,

  /**
   * Table cell content.
   */
  tableCell: (node, context) => renderAll(node.children, context),
  /**
   * Horizontal rule.
   */
  thematicBreak: () => '<hr>',
  /**
   * Hard line break.
   */
  break: () => '<br>\n',
  /**
   * Footnote body, rendered once at its first definition.
   */
  footnoteDefinition: async (node, context) => {
    if (context.markdown.footnotes.get(node.identifier) !== node) {
      return '';
    }

    const body = await renderAll(node.children, context);
    return tag('aside', body, attr('id', footnoteId(node.identifier)));
  },
  /**
   * Footnote marker linking to its body.
   */
  footnoteReference: (node) => {
    const label = escapeHtml(node.label ?? node.identifier);
    const href = attr('href', `#${footnoteId(node.identifier)}`);
    return tag('sup', tag('a', label, href));
  },
  /**
   * Link definition, consumed by references.
   */
  definition: nothing,

  /**
   * Table row, rendered by its table.
   */
  tableRow: nothing,

  /**
   * MDX expression, evaluated by the MDX compiler instead.
   */
  mdxFlowExpression: nothing,

  /**
   * Inline MDX expression, evaluated by the MDX compiler instead.
   */
  mdxTextExpression: nothing,

  /**
   * MDX element, rendered by the MDX compiler instead.
   */
  mdxJsxFlowElement: nothing,

  /**
   * Inline MDX element, rendered by the MDX compiler instead.
   */
  mdxJsxTextElement: nothing,

  /**
   * MDX import or export, executed by the MDX compiler instead.
   */
  mdxjsEsm: nothing,

  /**
   * Front matter, decoded separately.
   */
  yaml: nothing,
};

/**
 * Renders one supported Markdown node with escaped authored content.
 */
async function render(node: Node, context: Context): Promise<string> {
  return dispatch(node, context);
}

/**
 * Looks up the renderer for a node's type. TypeScript cannot correlate the node with its entry in
 * the mapped table, so the lookup is widened once here.
 */
function dispatch<K extends Node['type']>(
  node: Extract<Node, { type: K }>,
  context: Context,
): string | Promise<string> {
  const renderer: Renderers[K] = RENDERERS[node.type];
  return renderer(node, context);
}

/**
 * Renders children inside one element without attributes.
 */
async function wrap(name: string, children: Array<Node>, context: Context): Promise<string> {
  return tag(name, await renderAll(children, context));
}

/**
 * Detects standalone media before rendering ordinary paragraph content.
 */
async function paragraph(node: Paragraph, context: Context): Promise<string> {
  const only = node.children[0];
  if (node.children.length === 1 && only !== undefined) {
    if (only.type === 'link' || only.type === 'linkReference') {
      return link(only, context, true);
    }

    if (only.type === 'image' || only.type === 'imageReference') {
      return image(only, context, true);
    }
  }

  return tag('p', await renderAll(node.children, context), authoredAttributes(node));
}

/**
 * Resolves and renders an inline link or standalone media player.
 */
async function link(node: LinkNode, context: Context, standalone: boolean): Promise<string> {
  const label = await renderAll(node.children, { ...context, insideLink: true });
  const target = destination(node, context);
  if (target === undefined) {
    return standalone ? tag('p', label) : label;
  }

  const result = await context.links.resolve(
    target.url,
    standalone ? 'standalone' : 'link',
    positionOf(node, context),
  );
  if (result === undefined) {
    return standalone ? tag('p', label) : label;
  }

  if (standalone && result.media?.kind === 'video') {
    return player(result.href, result.media, label, context.base);
  }

  const attributes =
    attr('href', result.href) + optionalAttr('title', target.title) + authoredAttributes(node);
  const anchor = tag('a', label, attributes);
  return standalone ? tag('p', anchor) : anchor;
}

/**
 * Resolves an image with lazy loading, dimensions and optional animation controls.
 */
async function image(node: ImageNode, context: Context, standalone: boolean): Promise<string> {
  const alt = node.alt ?? '';
  const target = destination(node, context);
  if (target === undefined) {
    return escapeHtml(alt);
  }

  const position = positionOf(node, context);
  validateAlt(alt, position, context.diagnostics);
  const result = await context.links.resolve(target.url, 'image', position);
  if (result === undefined) {
    return escapeHtml(alt);
  }

  const dimensions = result.media?.dimensions;
  const poster = result.media?.asset.poster;
  if (poster !== undefined) {
    const still = img(context.base + poster, alt, { dimensions });
    if (!standalone && context.insideLink) {
      return still;
    }

    const animated = img(result.href, alt, { dimensions });
    return gif(still, animated, { href: result.href, standalone, title: target.title });
  }

  const html = img(result.href, alt, { title: target.title, dimensions });
  if (context.insideLink) {
    return html;
  }

  const fullSize = tag('a', html, attr('href', result.href));
  if (!standalone) {
    return fullSize;
  }

  const caption = target.title ? tag('figcaption', escapeHtml(target.title)) : '';
  return tag('figure', fullSize + caption);
}

/**
 * Reports missing alternative text at the source image.
 */
function validateAlt(alt: string, position: Position, diagnostics: Array<Diagnostic>): void {
  if (alt.trim() === '') {
    addDiagnostic(diagnostics, position, {
      severity: 'warning',
      rule: 'missing-alt',
      message: 'This image has no alternative text.',
      fix: 'Describe the image in the brackets of the Markdown image.',
    });
  }
}

/**
 * Where an animation appears: its full-size target, whether it stands alone and its caption.
 */
type GifPlacement = {
  /**
   * URL of the full animation.
   */
  href: string;

  /**
   * Whether the image is the only content of its paragraph.
   */
  standalone: boolean;

  /**
   * Optional caption from the Markdown image title.
   */
  title?: string | null | undefined;
};

/**
 * Renders an animation behind an explicit playback control with a still poster.
 */
function gif(poster: string, animated: string, placement: GifPlacement): string {
  const { href, standalone, title } = placement;
  if (!standalone) {
    return tag('a', poster, attr('href', href));
  }

  const controls =
    '<span class="gif-control"><span class="gif-play">Play animation</span>' +
    '<span class="gif-pause">Pause animation</span></span>';
  const summary = tag('summary', poster + controls);
  const playback = tag('details', summary + animated, attr('class', 'gif'));
  return title ? tag('figure', playback + tag('figcaption', escapeHtml(title))) : playback;
}

/**
 * Reveals a captioned video and download link under its authored label.
 */
function player(source: string, media: Media, label: string, base: string): string {
  const playerAttributes = ' controls preload="none" playsinline' + attr('src', source);
  const tracks = media.captions.map(({ asset, language }, index) => {
    const labelText = languageNames.of(language) ?? language;
    const attributes =
      attr('src', base + asset.output) + attr('srclang', language) + attr('label', labelText);
    const defaultTrack = index === 0 ? ' default' : '';
    return `<track kind="captions"${attributes}${defaultTrack}>`;
  });
  const download = tag('a', 'Download video', attr('href', source) + ' download');
  const video = tag('video', tracks.join(''), playerAttributes);
  const summary = tag('summary', label || 'Watch video');
  const playback = tag('div', video + download, attr('class', 'video-playback'));
  return tag('details', summary + playback, attr('class', 'video'));
}

/**
 * Renders ordered or unordered Markdown lists.
 */
async function list(node: List, context: Context): Promise<string> {
  const name = node.ordered ? 'ol' : 'ul';
  const start =
    node.start !== null && node.start !== undefined && node.start !== 1
      ? attr('start', String(node.start))
      : '';
  return tag(name, await renderAll(node.children, context), start);
}

/**
 * Preserves task state and child block content in list items.
 */
async function listItem(
  node: Extract<Node, { type: 'listItem' }>,
  context: Context,
): Promise<string> {
  const body = await renderAll(node.children, context);
  if (node.checked === null || node.checked === undefined) {
    return tag('li', body);
  }

  const checked = node.checked ? ' checked' : '';
  const checkbox = `<input type="checkbox" disabled${checked} aria-label="Task status">`;
  return tag('li', checkbox + body, attr('class', 'task-list-item'));
}

/**
 * Renders a GFM table with semantic header and data cells.
 */
async function table(node: Table, context: Context): Promise<string> {
  const rows = await inOrder(node.children, async (row, index) => {
    const cellTag = index === 0 ? 'th' : 'td';
    const cells = await inOrder(row.children, async (cell, column) => {
      const align = node.align?.[column];
      return tag(cellTag, await render(cell, context), optionalAttr('align', align));
    });
    return tag('tr', cells.join(''));
  });
  const [first = '', ...rest] = rows;
  return tag('table', tag('thead', first) + tag('tbody', rest.join('')));
}

/**
 * Looks up an inline destination or its reference definition.
 */
function destination(node: LinkNode | ImageNode, context: Context): Destination | undefined {
  if ('url' in node) {
    return node;
  }

  return context.markdown.definitions.get(node.identifier);
}

/**
 * Maps a Markdown node's body-relative coordinates back to the source file.
 */
function positionOf(node: Node, context: Context): Position {
  const start = node.position?.start;
  return {
    file: context.file,
    line: context.lineOffset + (start?.line ?? 1),
    column: start?.column ?? 1,
  };
}

/**
 * Renders children in document order using the requested separator.
 */
async function renderAll(nodes: Array<Node>, context: Context, separator = ''): Promise<string> {
  const parts = await inOrder(nodes, (node) => render(node, context));
  return parts.join(separator);
}

/**
 * Maps items one after another. Rendering registers media, diagrams and diagnostics as it goes, so
 * document order must be kept; starting the renders together would reorder them.
 */
async function inOrder<A, B>(
  items: ReadonlyArray<A>,
  task: (item: A, index: number) => Promise<B>,
): Promise<Array<B>> {
  const results: Array<B> = [];
  await items.reduce(async (previous, item, index) => {
    await previous;
    results.push(await task(item, index));
  }, Promise.resolve());
  return results;
}

/**
 * Produces a stable escaped target for a footnote reference.
 */
function footnoteId(identifier: string): string {
  return `footnote:${Buffer.from(identifier).toString('base64url')}`;
}

/**
 * Wraps rendered child markup in a supported element.
 */
function tag(name: string, value: string, attrs = ''): string {
  return `<${name}${attrs}>${value}</${name}>`;
}

/**
 * Optional metadata used to reserve space and display a title on an image.
 */
type ImageOptions = {
  /**
   * Optional authored title attribute on the image.
   */
  title?: string | null | undefined;

  /**
   * Intrinsic pixel dimensions reserved in the page before the image loads.
   */
  dimensions?: Media['dimensions'];
};

/**
 * Creates an escaped, lazy-loaded image tag with its alternative text and optional dimensions.
 */
function img(source: string, alt: string, options: ImageOptions): string {
  const attrs = attr('src', source) + attr('alt', alt) + optionalAttr('title', options.title);
  const dimensions = options.dimensions;
  if (dimensions === undefined) {
    return `<img loading="lazy"${attrs}>`;
  }

  return `<img loading="lazy"${attrs} width="${dimensions.width}" height="${dimensions.height}">`;
}

/**
 * Serializes one escaped HTML attribute.
 */
function attr(name: string, value: string): string {
  return ` ${name}="${escapeHtml(value)}"`;
}

/**
 * Omits an attribute when its authored value is absent.
 */
function optionalAttr(name: string, value?: string | null): string {
  return value ? attr(name, value) : '';
}

/**
 * Retains authored classes and stable IDs when normalizing MDX links, paragraphs and headings.
 */
function authoredAttributes(node: Node, includeId = true): string {
  const id = node.data?.hProperties?.id;
  const cssClass = node.data?.hProperties?.className;
  const anchor = includeId && typeof id === 'string' ? attr('id', headingId(id)) : '';
  return anchor + (cssClass?.length ? attr('class', cssClass.join(' ')) : '');
}
