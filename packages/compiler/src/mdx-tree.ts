import type { Code, Heading, Parent, PhrasingContent, Root, RootContent } from 'mdast';
import type { DefaultTreeAdapterTypes } from 'parse5';

import { parseFragment, serializeOuter } from 'parse5';

import { headingId } from './markdown.ts';

/**
 * A server-rendered JSX element whose descendants still participate in roadmap link resolution.
 */
type RoadmapElement = Parent & {
  /**
   * Discriminator shared with the Markdown renderer.
   */
  type: 'roadmapElement';

  /**
   * Serialized opening tag including authored attributes.
   */
  open: string;

  /**
   * Closing tag, or the empty string for a void element.
   */
  close: string;

  /**
   * Normalized Markdown and JSX descendants.
   */
  children: Array<RootContent>;
};

/* These two maps use declaration merging, the extension mechanism provided by mdast. */
declare module 'mdast' {
  /**
   * Allows a server-rendered element at document level.
   */
  interface RootContentMap {
    /**
     * The element keeps its serialized tag and normalized child nodes.
     */
    roadmapElement: RoadmapElement;
  }

  /**
   * Allows rendered JSX between words in headings and link labels.
   */
  interface PhrasingContentMap {
    /**
     * The element keeps its serialized tag and normalized child nodes.
     */
    roadmapElement: RoadmapElement;
  }
}

/**
 * Node produced by the HTML fragment parser.
 */
type HtmlNode = DefaultTreeAdapterTypes.ChildNode;

/**
 * Element with normalized attributes and descendants.
 */
type Element = DefaultTreeAdapterTypes.Element;

/**
 * Maps rendered HTML heading tags to Markdown heading depths.
 */
const HEADING_DEPTHS = new Map<string, Heading['depth']>([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

/**
 * Converts trusted server-rendered JSX back into the document tree used for links, media and
 * search.
 */
export function mdxTree(html: string): Root {
  return { type: 'root', children: parseFragment(html).childNodes.flatMap(block) };
}

/**
 * Reads an HTML attribute before its element is mapped onto a content node.
 */
function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name === name)?.value;
}

/**
 * Retains source coordinates added to Markdown elements by the MDX compiler.
 */
function location(element: Element): Pick<Root, 'position'> {
  const line = Number(attribute(element, 'data-roadmap-line'));
  if (!line) {
    return {};
  }

  const point = { line, column: Number(attribute(element, 'data-roadmap-column')) || 1 };
  return { position: { start: point, end: point } };
}

/**
 * Recovers block structures that have special roadmap rendering rules.
 */
function block(node: HtmlNode): Array<RootContent> {
  if (!('tagName' in node)) {
    return inline(node);
  }

  const at = location(node);
  const data = elementData(node);
  if (node.tagName === 'video' && attribute(node, 'src')) {
    return [
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: attribute(node, 'src') ?? '',
            children: [{ type: 'text', value: attribute(node, 'aria-label') ?? 'Video' }],
            ...at,
          },
        ],
      },
    ];
  }

  if (node.tagName === 'p') {
    return [{ type: 'paragraph', children: node.childNodes.flatMap(inline), data, ...at }];
  }

  const depth = HEADING_DEPTHS.get(node.tagName);
  if (depth !== undefined) {
    return [
      {
        type: 'heading',
        depth,
        data,
        children: node.childNodes.flatMap(inline),
        ...at,
      },
    ];
  }

  if (node.tagName === 'pre') {
    const code = codeFence(node, at);
    if (code !== undefined) {
      return [code];
    }
  }

  return inline(node);
}

/**
 * Recovers fence metadata and text from a rendered pre/code pair.
 */
function codeFence(node: Element, at: Pick<Root, 'position'>): Code | undefined {
  const code = node.childNodes.find((child) => 'tagName' in child && child.tagName === 'code');
  if (!code || !('tagName' in code)) {
    return undefined;
  }

  return {
    type: 'code',
    lang: attribute(code, 'class')?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? '',
    meta: attribute(code, 'data-code-meta') ?? '',
    value: textContent(code).replace(/\n$/, ''),
    ...location(code),
    ...at,
  };
}

/**
 * Preserves JSX markup while routing ordinary images and links through the shared asset pipeline.
 */
function inline(node: HtmlNode): Array<PhrasingContent> {
  if ('value' in node) {
    return [{ type: 'text', value: node.value }];
  }

  if (!('tagName' in node) || (node.tagName === 'link' && attribute(node, 'rel') === 'preload')) {
    return [];
  }

  const title = attribute(node, 'title') ?? null;
  if (node.tagName === 'img') {
    return [
      {
        type: 'image',
        url: attribute(node, 'src') ?? '',
        alt: attribute(node, 'alt') ?? '',
        title,
        ...location(node),
      },
    ];
  }

  if (node.tagName === 'a' && attribute(node, 'href') !== undefined) {
    return [
      {
        type: 'link',
        url: attribute(node, 'href') ?? '',
        data: elementData(node),
        title,
        children: node.childNodes.flatMap(inline),
        ...location(node),
      },
    ];
  }

  return [customElement(node)];
}

/**
 * Preserves JSX markup while stripping source annotations from the serialized tag.
 */
function customElement(node: Element): RoadmapElement {
  const attrs: Element['attrs'] = [];
  for (const attr of node.attrs) {
    if (!attr.name.startsWith('data-roadmap-')) {
      attrs.push(attr.name === 'id' ? { ...attr, value: headingId(attr.value) } : attr);
    }
  }

  const empty = {
    ...node,
    childNodes: [],
    attrs,
  };
  const markup = serializeOuter(empty);
  const closing = markup.lastIndexOf('</');
  return {
    type: 'roadmapElement',
    data: elementData(node),
    open: closing < 0 ? markup : markup.slice(0, closing),
    close: closing < 0 ? '' : markup.slice(closing),
    children: node.childNodes.flatMap(block),
  };
}

/**
 * Reads code text without interpreting any authored markup as executable source.
 */
function textContent(node: HtmlNode): string {
  if ('value' in node) {
    return node.value;
  }

  return 'childNodes' in node ? node.childNodes.map(textContent).join('') : '';
}

/**
 * Carries explicit anchor IDs and classes through the shared renderer, including GFM footnotes.
 */
function elementData(element: Element): NonNullable<Root['data']> {
  return {
    hProperties: {
      id: attribute(element, 'id'),
      className: attribute(element, 'class')?.split(/\s+/),
    },
  };
}
