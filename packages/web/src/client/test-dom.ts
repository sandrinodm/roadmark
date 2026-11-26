/**
 * Test-only helper that gives the browser modules' unit tests a DOM. It never ships: it is not a
 * bundle entry (client-bundle.ts bundles `boot` and what it imports), the package build drops the
 * client folder's TypeScript, and tsconfig.browser.json excludes it.
 *
 * Node --test runs every test file in its own process, so each file registers happy-dom's globals
 * once and they never leak into another file. Browser modules touch `document` when they load, so
 * test files import them with `await import()` after `installDom()`.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { compile } from '@roadmark/compiler/compile';
import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock } from 'node:test';

import { renderSite } from '../render.ts';

/**
 * Origin of every test page.
 */
export const ORIGIN = 'https://roadmap.test';

/**
 * The rendered Atlas site, compiled once per test process.
 */
let site: Promise<Map<string, string | Uint8Array>> | undefined;

/**
 * Reads one text file of the Atlas fixture site, rendered with the real compiler and renderer. Call
 * it before `installDom()`: server-side libraries may behave differently once `window` exists.
 *
 * @param key Output path, such as `timeline/index.html` or `search-index.json`.
 * @returns File text.
 * @throws If the site has no such text file.
 */
export async function atlasFile(key: string): Promise<string> {
  site ??= compile(ATLAS_DIRECTORY, '/').then(async (model) => renderSite(model, '/'));
  const file = (await site).get(key);
  if (typeof file !== 'string') {
    throw new TypeError(`The Atlas site has no text file ${key}.`);
  }

  return file;
}

/**
 * Registers the DOM globals for this test file, resets the document before every test (unless
 * `keepPage` is set) and closes the window after the last one.
 *
 * @param options Options.
 * @param options.keepPage Keep one page across tests, for modules that remember the elements of the
 *   page they first saw, as they may in a browser where the page never changes under them.
 */
export function installDom({ keepPage = false }: { keepPage?: boolean } = {}): void {
  GlobalRegistrator.register({
    url: `${ORIGIN}/`,
    width: 1280,
    height: 800,
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: { disableMainFrameNavigation: true },
    },
  });
  stubElementInternals();
  stubOption();
  stubPopover();
  if (!keepPage) {
    beforeEach(() => resetDom());
  }

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });
  after(async () => {
    // Disconnect the components and let their teardown run while the globals still exist.
    resetDom();
    await settle(100);
    mock.restoreAll();
    await GlobalRegistrator.unregister();
  });
}

/**
 * Gives elements the popover methods happy-dom lacks. Browsers have them, and UI SDK overlays use
 * them to reach the top layer; without them the components fall back to moving dialog and tooltip
 * content to the end of `<body>`, which no supported browser does and the modules do not expect.
 * happy-dom has no top layer to show anything in, so they do nothing.
 */
function stubPopover(): void {
  if ('showPopover' in HTMLElement.prototype) {
    return;
  }

  for (const name of ['showPopover', 'hidePopover']) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: () => undefined,
    });
  }
}

/**
 * Gives elements a minimal `attachInternals()`, which happy-dom lacks and every UI SDK component
 * calls when it upgrades. Form association and validity are not under test, so they stay inert.
 */
function stubElementInternals(): void {
  if ('attachInternals' in HTMLElement.prototype) {
    return;
  }

  Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
    configurable: true,
    value: () => ({
      form: null,
      labels: [],
      states: new Set<string>(),
      validity: { valid: true },
      validationMessage: '',
      willValidate: false,
      checkValidity: () => true,
      reportValidity: () => true,
      setFormValue: () => undefined,
      setValidity: () => undefined,
    }),
  });
}

/**
 * Provides the `Option` constructor (`new Option(text, value)`), which happy-dom lacks.
 */
function stubOption(): void {
  if ('Option' in globalThis) {
    return;
  }

  Object.defineProperty(globalThis, 'Option', {
    configurable: true,
    writable: true,
    value: Option,
  });
}

/**
 * Creates an option element, as the browser's `Option` constructor does.
 *
 * @param text Label.
 * @param value Value; the label when absent.
 * @returns Option element.
 */
function Option(text = '', value?: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.text = text;
  if (value !== undefined) {
    option.value = value;
  }

  return option;
}

/**
 * Number of fresh module instances loaded so far.
 */
let instances = 0;

/**
 * Runs a browser module's top-level code again against the current document, as a page load would.
 * Each call loads a fresh instance of that module (its imports stay shared); listeners an earlier
 * instance added to `document` or `window` stay attached.
 *
 * @param file Module file name in the client folder, such as `timeline.ts`.
 */
export async function runModule(file: string): Promise<void> {
  instances += 1;
  await import(`${new URL(file, import.meta.url).href}?instance=${instances}`);
}

/**
 * Empties the document and session storage and moves back to the site root.
 */
export function resetDom(): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  sessionStorage.clear();
  setUrl('/');
}

/**
 * Moves the window to a URL on the test origin without navigating, as `history.replaceState` does.
 *
 * @param path Path, query and fragment.
 */
export function setUrl(path: string): void {
  history.replaceState(null, '', new URL(path, `${ORIGIN}/`));
}

/**
 * The current URL's query parameters.
 *
 * @returns Parameters.
 */
export function params(): URLSearchParams {
  return new URLSearchParams(location.search);
}

/**
 * Shows a page's `<body>` content at a URL. Its scripts never run.
 *
 * @param html Full page or body fragment.
 * @param path Path, query and fragment of the page.
 * @returns The document body.
 */
export function loadPage(html: string, path = '/'): HTMLElement {
  setUrl(path);
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return document.body;
}

/**
 * Finds an element that a test relies on.
 *
 * @param selector CSS selector.
 * @param type Expected element class.
 * @param root Element or document to search.
 * @returns The element.
 * @throws If nothing matches or the match has another type.
 */
export function query<T extends Element>(
  selector: string,
  type: ElementClass<T>,
  root: ParentNode = document,
): T {
  const node = root.querySelector(selector);
  if (!isA(node, type)) {
    throw new TypeError(`No ${type.name} matches ${selector}.`);
  }

  return node;
}

/**
 * A DOM element class, such as `HTMLDetailsElement`.
 */
export type ElementClass<T extends Element> = {
  /**
   * Prototype every instance inherits from.
   */
  prototype: T;

  /**
   * Class name, for messages.
   */
  name: string;
};

/**
 * Whether a node is an instance of a DOM element class, checked through its prototype chain.
 *
 * @param node Node or nothing.
 * @param type Element class.
 * @returns Whether the node is one.
 */
export function isA<T extends Element>(node: unknown, type: ElementClass<T>): node is T {
  return (
    typeof node === 'object' &&
    node !== null &&
    Object.prototype.isPrototypeOf.call(type.prototype, node)
  );
}

/**
 * Serves fixed responses to `fetch` by URL path, and 404 for anything else.
 *
 * @param files Response bodies by URL path.
 * @returns The mock, to count requests.
 */
export function serve(files: Readonly<Record<string, string>>): ReturnType<typeof mock.fn> {
  const handler = mock.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const body = files[url.pathname];
    return body === undefined
      ? new Response('Not found', { status: 404 })
      : new Response(body, { headers: { 'content-type': 'application/json' } });
  });
  globalThis.fetch = handler;
  return handler;
}

/**
 * Lets pending promise callbacks, animation frames and timers run.
 *
 * @param ms Delay.
 */
export async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Asserts that two values are the same node (or both nothing) without printing them: node:assert
 * would inspect a whole happy-dom window to show a failing node.
 *
 * @param actual Node found.
 * @param expected Node expected, or null.
 * @param message What the check means.
 */
export function assertSameNode(actual: unknown, expected: unknown, message = ''): void {
  assert.ok(
    actual === expected,
    `${message} (got ${nodeName(actual)}, expected ${nodeName(expected)})`,
  );
}

/**
 * Names a node briefly for an assertion message.
 *
 * @param value Node or anything else.
 * @returns Its start tag, or the value as text.
 */
function nodeName(value: unknown): string {
  return isA(value, Element)
    ? value.outerHTML.slice(0, value.outerHTML.indexOf('>') + 1)
    : String(value);
}
