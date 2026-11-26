import type { Root, RootContent } from 'mdast';
import type { ComponentType, ReactNode } from 'react';

import { compile } from '@mdx-js/mdx';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { compileFunction } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import remarkGfm from 'remark-gfm';

import { mdxTree } from './mdx-tree.ts';

/**
 * Virtual module shared by compiled documents and imported partials. Its exports come from the
 * installed CLI so every component uses the same React instance and roadmap component catalog.
 */
const COMPONENT_MODULE = 'roadmap:components';

/**
 * Roadmap callouts accept a short title and ordinary MDX content.
 */
type CalloutProps = {
  /**
   * Optional heading in place of the default role.
   */
  title?: string;

  /**
   * Markdown, JSX or expressions inside the callout.
   */
  children?: ReactNode;
};

/**
 * Renders a semantic aside using the workspace palette.
 */
function callout(kind: string): ComponentType<CalloutProps> {
  return ({ title, children }) =>
    createElement(
      'aside',
      { className: 'roadmap-callout' },
      createElement('strong', null, title ?? kind),
      children,
    );
}

/**
 * Supplies an embeddable code block whose source and language are resolved by the content compiler.
 */
function codeBlock(props: {
  src?: string;
  lang?: string;
  title?: string;
  children?: string;
  'data-roadmap-line'?: string;
  'data-roadmap-column'?: string;
}): ReactNode {
  const meta = [
    props.src && 'src=' + JSON.stringify(props.src),
    props.title && 'title=' + JSON.stringify(props.title),
  ]
    .filter(Boolean)
    .join(' ');
  return createElement(
    'pre',
    {
      'data-roadmap-line': props['data-roadmap-line'],
      'data-roadmap-column': props['data-roadmap-column'],
    },
    createElement(
      'code',
      { className: 'language-' + (props.lang ?? ''), 'data-code-meta': meta },
      props.children ?? '',
    ),
  );
}

/**
 * Built-ins shared by MDX documents and their local components.
 */
const components = {
  /**
   * Records an agreed course of action.
   */
  Decision: callout('Decision'),

  /**
   * Describes uncertainty and mitigation.
   */
  Risk: callout('Risk'),

  /**
   * Highlights a measurable customer or business result.
   */
  Outcome: callout('Outcome'),

  /**
   * Includes an inline or workspace-relative source listing.
   */
  Code: codeBlock,

  /**
   * Shows the item's upstream and downstream work directly from its frontmatter.
   */
  DependencyDiagram: (props: Parameters<typeof codeBlock>[0]) =>
    codeBlock({ ...props, lang: 'roadmap-dependencies' }),

  /**
   * Includes a Mermaid fence supplied by an MDX component.
   */
  Mermaid: (props: Parameters<typeof codeBlock>[0]) => codeBlock({ ...props, lang: 'mermaid' }),
};

/**
 * Passes original fence options and source coordinates through the MDX HTML transformation.
 */
function sourceLocations() {
  return annotate;
}

/**
 * Marks nodes before the HTML conversion discards their source positions.
 */
function annotate(node: Root | RootContent): void {
  if (
    node.position &&
    ['code', 'image', 'link', 'imageReference', 'linkReference'].includes(node.type)
  ) {
    node.data ??= {};
    node.data.hProperties = {
      ...node.data.hProperties,
      'data-roadmap-line': node.position.start.line,
      'data-roadmap-column': node.position.start.column,
    };
    if (node.type === 'code' && node.meta) {
      node.data.hProperties['data-code-meta'] = node.meta;
    }
  }

  if (
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
    node.position &&
    node.name &&
    ['Code', 'Mermaid', 'DependencyDiagram', 'img', 'a'].includes(node.name)
  ) {
    node.attributes.push(
      {
        type: 'mdxJsxAttribute',
        name: 'data-roadmap-line',
        value: String(node.position.start.line),
      },
      {
        type: 'mdxJsxAttribute',
        name: 'data-roadmap-column',
        value: String(node.position.start.column),
      },
    );
  }

  if ('children' in node) {
    node.children.forEach(annotate);
  }
}

/**
 * Default component emitted by the bundled MDX module.
 */
type MdxExports = {
  /**
   * Renders the document with the workspace’s component catalog.
   */
  default?: ComponentType<{ components: typeof components }>;
};

/**
 * CommonJS wrapper produced by compiling the esbuild output with the module bindings below.
 */
type MdxModuleRunner = (
  ...bindings: [
    module: { exports: MdxExports },
    exports: MdxExports,
    load: (id: string) => void,
    filename: string,
    directory: string,
  ]
) => void;

/**
 * Narrows the VM result to a callable wrapper before passing the CommonJS bindings.
 */
function isMdxModuleRunner(value: unknown): value is MdxModuleRunner {
  return typeof value === 'function';
}

/**
 * Compiles and bundles a trusted MDX module and its local JSX/TSX imports anew on every workspace
 * build. Nothing is executed yet, so documents can be bundled concurrently.
 *
 * @param body The MDX source after the front matter.
 * @param filename The document's absolute path, for imports and error locations.
 * @returns The CommonJS bundle for {@link runMdx}.
 */
export async function bundleMdx(body: string, filename: string): Promise<string> {
  const js = await javascript(body, filename);
  const bundle = await build({
    stdin: {
      contents: js,
      resolveDir: dirname(filename),
      sourcefile: filename,
      loader: 'js',
    },
    bundle: true,
    write: false,
    logLevel: 'silent',
    platform: 'node',
    target: 'node26',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom', COMPONENT_MODULE],
    plugins: [
      {
        name: 'roadmap-mdx-imports',
        setup(builder) {
          builder.onLoad({ filter: /\.mdx$/ }, async ({ path }) => ({
            contents: await javascript(await readFile(path, 'utf8'), path),
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  const code = bundle.outputFiles[0]?.text;
  if (!code) {
    throw new Error('The MDX compiler returned an empty module.');
  }

  return code;
}

/**
 * Executes a bundled MDX document and renders it. Documents run trusted code that may keep
 * process-wide state, so callers run them one at a time in discovery order.
 *
 * @param code The bundle from {@link bundleMdx}.
 * @param filename The document's absolute path, for `require` and error locations.
 * @returns The rendered document as a Markdown tree.
 */
export function runMdx(code: string, filename: string): Root {
  const runtime = createRequire(import.meta.url);
  const local = createRequire(filename);
  const exports: MdxExports = {};
  const module = { exports };
  const execute = compileFunction(
    code,
    ['module', 'exports', 'require', '__filename', '__dirname'],
    { filename },
  );
  if (!isMdxModuleRunner(execute)) {
    throw new TypeError('Expected the compiled MDX module to be callable.');
  }

  execute(
    module,
    module.exports,
    (id) => {
      if (id === COMPONENT_MODULE) {
        return { ...components, useMDXComponents: () => components };
      }

      const loaded: unknown = /^(?:react|react-dom)(?:\/|$)/.test(id) ? runtime(id) : local(id);
      return loaded;
    },
    filename,
    dirname(filename),
  );
  if (!module.exports.default) {
    throw new Error('Expected the compiled MDX document to export a component.');
  }

  return mdxTree(renderToStaticMarkup(createElement(module.exports.default, { components })));
}

/**
 * Compiles an MDX document or a reusable partial with the same GFM and fence conventions.
 */
async function javascript(body: string, filename: string): Promise<string> {
  return String(
    await compile(
      { value: body, path: filename },
      {
        format: 'mdx',
        providerImportSource: COMPONENT_MODULE,
        remarkPlugins: [remarkGfm, sourceLocations],
      },
    ),
  );
}
