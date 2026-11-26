/**
 * Matches delimiters that need escaping in HTML text or quoted attributes.
 */
const HTML_CHARACTERS = /[&<>"']/g;

/**
 * Character references for the delimiters matched by `HTML_CHARACTERS`.
 */
const HTML_ENTITIES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * Every `SafeHtml` this module created. Membership, not shape, makes a value trusted: an object
 * that merely looks like `SafeHtml` is never in this set.
 */
const minted = new WeakSet<object>();

/**
 * Markup that is already safe to place in a document: escaped author text, renderer templates, or
 * compiled Markdown that entered through `trustedHtml`. Only this module can create one.
 */
export type SafeHtml = {
  /**
   * Finished markup.
   */
  readonly value: string;

  /**
   * Returns the markup so a page can be written to disk or compared in tests.
   */
  toString: () => string;
};

/**
 * Values a template slot accepts. Strings and numbers are escaped; `SafeHtml` passes through;
 * absent values and `false` render nothing; arrays render each entry in order.
 */
export type HtmlValue =
  | SafeHtml
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<HtmlValue>;

/**
 * Encodes HTML delimiters in text and quoted attributes.
 *
 * @param value Text to encode.
 * @returns Escaped text.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll(
    HTML_CHARACTERS,
    (character) => HTML_ENTITIES.get(character) ?? character,
  );
}

/**
 * Marks compiled Markdown or constant renderer markup as safe. This is the only way unescaped
 * strings enter a page, so every call site is a reviewable trust decision.
 *
 * @param markup Markup produced by the content compiler or a constant in the renderer.
 * @returns The same markup as `SafeHtml`.
 */
export function trustedHtml(markup: string): SafeHtml {
  return mint(markup);
}

/**
 * Builds markup from a template, escaping every interpolated string.
 *
 * @param strings Literal template parts, written by the renderer.
 * @param values Interpolated values.
 * @returns Safe markup.
 */
export function html(strings: TemplateStringsArray, ...values: Array<HtmlValue>): SafeHtml {
  let markup = strings[0] ?? '';
  for (const [index, value] of values.entries()) {
    markup += render(value) + (strings[index + 1] ?? '');
  }

  return mint(markup);
}

/**
 * Joins fragments, optionally with a literal separator written by the renderer.
 *
 * @param parts Fragments in display order.
 * @param separator Markup placed between fragments.
 * @returns Safe markup.
 */
export function joinHtml(parts: ReadonlyArray<HtmlValue>, separator: SafeHtml | '' = ''): SafeHtml {
  return mint(parts.map(render).join(render(separator)));
}

/**
 * Creates and registers safe markup.
 *
 * @param value Finished markup.
 * @returns Frozen `SafeHtml`.
 */
function mint(value: string): SafeHtml {
  const safe: SafeHtml = Object.freeze({ value, toString: () => value });
  minted.add(safe);
  return safe;
}

/**
 * Serializes one template value.
 *
 * @param value Interpolated value.
 * @returns Markup for the value.
 * @throws TypeError when an object that is not genuine `SafeHtml` reaches a template.
 */
function render(value: HtmlValue): string {
  if (Array.isArray(value)) {
    return value.map(render).join('');
  }

  if (typeof value === 'string') {
    return escapeHtml(value);
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (isMinted(value)) {
    return value.value;
  }

  if (typeof value === 'object' && value !== null) {
    throw new TypeError('Only SafeHtml created by html`` or trustedHtml() can be interpolated.');
  }

  return '';
}

/**
 * Recognizes markup this module created, by identity rather than shape.
 *
 * @param value Template value.
 * @returns Whether the value is genuine `SafeHtml`.
 */
function isMinted(value: HtmlValue): value is SafeHtml {
  return typeof value === 'object' && value !== null && minted.has(value);
}
