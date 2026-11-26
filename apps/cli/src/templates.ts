import { fileURLToPath } from 'node:url';

/**
 * Starter workspaces `roadmark init --template <name>` copies, in the order help lists them.
 */
export const TEMPLATES = [
  {
    name: 'blank',
    summary: 'One feature set, two items with a dependency, one release, one person and one team.',
    directory: fileURLToPath(new URL('../templates/blank/', import.meta.url)),
  },
  {
    name: 'ai-sandbox',
    summary:
      'A full product launch for a fictional agent sandbox: 5 releases, 11 feature sets, 40 items, screenshots, code samples and Mermaid diagrams.',
    directory: fileURLToPath(new URL('../templates/ai-sandbox/', import.meta.url)),
  },
] as const;

/**
 * Template copied when `init` is given no `--template`.
 */
export const DEFAULT_TEMPLATE = 'blank';

/**
 * Name of a packaged starter workspace.
 */
export type TemplateName = (typeof TEMPLATES)[number]['name'];
