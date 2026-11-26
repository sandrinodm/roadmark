import type { Definition, FootnoteDefinition, Heading, Root, RootContent } from 'mdast';

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * Parsed GFM with heading and reference indexes used by both link validation and rendering.
 */
export type Markdown = {
  /**
   * Parsed GitHub Flavored Markdown root.
   */
  tree: Root;

  /**
   * Authored heading slugs accepted in links before reserved IDs are rewritten.
   */
  anchors: Set<string>;

  /**
   * Heading nodes mapped to unique slugs before HTML ID rewriting.
   */
  headings: Map<Heading, string>;

  /**
   * Reference-style Markdown destinations indexed by identifier.
   */
  definitions: Map<string, Definition>;

  /**
   * First footnote definition per identifier, used to avoid duplicate IDs.
   */
  footnotes: Map<string, FootnoteDefinition>;

  /**
   * Plain text from the body, used for full-text search.
   */
  text: string;
};

/**
 * Shared parser configured for GitHub Flavored Markdown.
 */
const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Characters requiring escaping in generated HTML.
 */
const HTML_SPECIAL = /[&<>"']/g;

/**
 * Escaped equivalents used for authored HTML text and attribute values.
 */
const HTML_ENTITIES = new Map([
  /**
   * HTML entity for the literal '&' character.
   */
  ['&', '&amp;'],

  /**
   * HTML entity for the literal '<' character.
   */
  ['<', '&lt;'],

  /**
   * HTML entity for the literal '>' character.
   */
  ['>', '&gt;'],

  /**
   * HTML entity for the literal '"' character.
   */
  ['"', '&quot;'],

  /**
   * HTML entity for the literal "'" character.
   */
  ["'", '&#39;'],
]);

/**
 * Nodes whose children should meet without an inserted space.
 */
const INLINE_TEXT_CONTAINERS = new Set<RootContent['type']>([
  'roadmapElement',
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
]);

/**
 * Characters removed when deriving stable fragments from headings.
 */
const NON_HEADING_CHARACTERS = /[^\p{L}\p{N}\p{M}\s_-]/gu;

/**
 * Runs of whitespace replaced with hyphens in heading fragments.
 */
const HEADING_SPACE = /\s+/g;

/**
 * Fragment IDs reserved by page navigation and search.
 */
const RESERVED_HEADING_IDS = new Set([
  'main',
  'search-title',
  'record-brief',
  'record-facts',
  'record-work',
  'roadmap-items',
  'scope-filters',
]);

/**
 * Fragment namespace reserved for the IDs the UI SDK assigns to upgraded controls (for example
 * `ui-sdk-select-1-label`), which label those controls for screen readers.
 */
const RESERVED_GENERATED = /^ui-sdk-/;

/**
 * Parses Markdown once and assigns unambiguous anchors in document order.
 */
export function parseMarkdown(body: string | Root): Markdown {
  const tree = typeof body === 'string' ? parser.parse(body) : body;
  const anchors = new Set<string>();
  const headings = new Map<Heading, string>();
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  visit(tree, (node) => {
    const explicitId = node.data?.hProperties?.id;
    if (typeof explicitId === 'string') {
      anchors.add(explicitId);
    }

    if (node.type === 'heading') {
      const slug = typeof explicitId === 'string' ? explicitId : headingSlug(node, anchors);
      headings.set(node, slug);
      anchors.add(slug);
    } else if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    } else if (node.type === 'footnoteDefinition' && !footnotes.has(node.identifier)) {
      footnotes.set(node.identifier, node);
    }
  });

  return { tree, anchors, headings, definitions, footnotes, text: visibleText(tree).trim() };
}

/**
 * Prefixes heading IDs that would collide with generated page controls or UI SDK IDs.
 */
export function headingId(slug: string): string {
  if (RESERVED_HEADING_IDS.has(slug) || RESERVED_GENERATED.test(slug)) {
    return `heading:${slug}`;
  }

  return slug;
}

/**
 * Escapes author-controlled values for HTML text or double-quoted attributes.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll(HTML_SPECIAL, (character) => HTML_ENTITIES.get(character) ?? character);
}

/**
 * Derives a heading fragment while keeping author headings distinct from generated sections.
 */
function headingSlug(node: Heading, anchors: Set<string>): string {
  const raw = visibleText(node);
  const normalized = raw.toLowerCase().normalize('NFC').replaceAll(NON_HEADING_CHARACTERS, '');
  const stem = normalized.trim().replaceAll(HEADING_SPACE, '-') || 'section';
  let slug = stem;
  let suffix = 1;
  while (anchors.has(slug)) {
    slug = `${stem}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

/**
 * Extracts readable text for search and heading fragments from Markdown nodes.
 */
function visibleText(node: Root | RootContent): string {
  if (node.type === 'text' || node.type === 'code' || node.type === 'inlineCode') {
    return node.value;
  }

  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? '';
  }

  if (node.type === 'break') {
    return ' ';
  }

  return 'children' in node ? visibleChildText(node) : '';
}

/**
 * Joins visible children using the spacing appropriate to their container.
 */
function visibleChildText(
  node: Extract<Root | RootContent, { children: Array<RootContent> }>,
): string {
  if (
    node.type === 'blockquote' ||
    node.type === 'list' ||
    node.type === 'listItem' ||
    node.type === 'table' ||
    node.type === 'tableCell' ||
    node.type === 'tableRow' ||
    node.type === 'footnoteDefinition' ||
    node.type === 'root'
  ) {
    return node.children.map(visibleText).join(' ');
  }

  return INLINE_TEXT_CONTAINERS.has(node.type) ? node.children.map(visibleText).join('') : '';
}

/**
 * Traverses the syntax tree in source order.
 */
function visit(node: Root | RootContent, action: (node: Root | RootContent) => void): void {
  action(node);
  if ('children' in node) {
    for (const child of node.children) {
      visit(child, action);
    }
  }
}
