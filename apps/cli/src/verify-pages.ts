import type { DefaultTreeAdapterTypes } from 'parse5';

import { Schema } from 'effect';
import { parse } from 'parse5';

/**
 * Syntax tree node consumed by this traversal.
 */
type Node = DefaultTreeAdapterTypes.Node;

/**
 * Resolved URL and its source context for validation.
 */
type Link = {
  /**
   * Path relative to the workspace, suitable for diagnostics and links.
   */
  file: string;

  /**
   * Fully qualified address used to reach the resource.
   */
  url: URL;
};

/**
 * HTML attributes treated as links in the built site.
 */
const urlAttributes = new Set(['href', 'src', 'poster', 'data-index']);

/**
 * Recognizes generated CSS url() references for post-build validation.
 */
const cssUrl = /url\(\s*['"]?([^)'"]+)['"]?\s*\)/gi;

/**
 * Reads the links that the generated search index exposes to readers.
 */
const decodeSearchIndex = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        /**
         * Points to the page or heading opened by a search result.
         */
        href: Schema.String,
      }),
    ),
  ),
);

/**
 * Check the generated site as a reader sees it, including subpaths and heading fragments.
 */
export function verifyPages(
  files: Map<string, string | Uint8Array>,
  names: Set<string>,
  base: string,
): void {
  const links: Array<Link> = [];
  const anchors = new Map<string, Set<string>>();
  const origin = 'https://roadmap.invalid';
  for (const [file, source] of files) {
    const page = new URL(base + file, origin);
    if (file.endsWith('.css')) {
      const css = typeof source === 'string' ? source : new TextDecoder().decode(source);
      for (const match of css.matchAll(cssUrl)) {
        if (match[1]) {
          addLink(match[1], page, file, links);
        }
      }
    }

    if (file === 'search-index.json' && typeof source === 'string') {
      for (const entry of decodeSearchIndex(source)) {
        addLink(entry.href, page, file, links);
      }
    }

    if (!file.endsWith('.html') || typeof source !== 'string') {
      continue;
    }

    const ids = new Set<string>();
    visit(parse(source), (node) => {
      for (const attr of node.attrs) {
        if (attr.name === 'id') {
          if (ids.has(attr.value)) {
            throw new Error(`${file} contains duplicate anchor #${attr.value}`);
          }

          ids.add(attr.value);
        }

        if (urlAttributes.has(attr.name)) {
          addLink(attr.value, page, file, links);
        }
      }
    });
    anchors.set(file, ids);
  }

  verifyLinks(links, names, anchors, base);
}

/**
 * Checks that collected links stay under the deployment base and reach existing targets.
 */
function verifyLinks(
  links: ReadonlyArray<Link>,
  names: Set<string>,
  anchors: Map<string, Set<string>>,
  base: string,
): void {
  for (const { file, url } of links) {
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(base)) {
      throw new Error(`${file} links outside the deployment base: ${pathname}`);
    }

    const relative = pathname.slice(base.length);
    const target = names.has(relative)
      ? relative
      : relative.replace(/\/?$/, '/index.html').replace(/^\//, '');
    if (!names.has(target)) {
      throw new Error(`${file} links to a missing file: ${pathname}`);
    }

    const anchor = decodeURIComponent(url.hash.slice(1));
    if (anchor && anchors.has(target) && !anchors.get(target)?.has(anchor)) {
      throw new Error(`${file} links to a missing anchor: ${pathname}#${anchor}`);
    }
  }
}

/**
 * Resolves one local reference relative to the page that contains it.
 */
function addLink(value: string, page: URL, file: string, links: Array<Link>): void {
  if (!URL.canParse(value) && !value.startsWith('//')) {
    links.push({ file, url: new URL(value, page) });
  }
}

/**
 * Traverses the syntax tree in source order.
 */
function visit(node: Node, fn: (element: DefaultTreeAdapterTypes.Element) => void): void {
  if ('attrs' in node) {
    fn(node);
  }

  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      visit(child, fn);
    }
  }
}
