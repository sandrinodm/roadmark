/**
 * Stroke paths on a 16px grid, shared by the server renderers and the browser palette so a kind
 * looks the same everywhere. Item glyphs carry inner lines so they never read as checkboxes.
 */
export const ICON_PATHS = {
  /**
   * Forward navigation arrow.
   */
  arrow: '<path d="M4 8h8m-3.5-3.5L12 8l-3.5 3.5"/>',

  /**
   * Globe for a linked website without a favicon.
   */
  globe: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2 8h12"/>',

  /**
   * Magnifying glass for search.
   */
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>',

  /**
   * Tick for a chosen option.
   */
  check: '<path d="m3.5 8.5 3 3 6-7"/>',

  /**
   * Cross for dismissing a control.
   */
  close: '<path d="m4 4 8 8m0-8-8 8"/>',

  /**
   * Three bars for the narrow-screen menu.
   */
  menu: '<path d="M2.5 4.5h11m-11 3.5h11m-11 3.5h11"/>',

  /**
   * Staggered bars for the timeline.
   */
  timeline: '<path d="M2.5 3.5h7m-5 4.5h7m-3 4.5h5"/>',

  /**
   * Stack for a feature set.
   */
  set: '<path d="m8 2 6 3-6 3-6-3 6-3Zm-6 6 6 3 6-3m-12 3 6 3 6-3"/>',

  /**
   * Card with two text lines for an item, so it never reads as a checkbox.
   */
  item: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5"/><path d="M5.5 6.5h5m-5 3h3"/>',

  /**
   * Flag for a release.
   */
  release: '<path d="M4 14V2.5h8.5l-2 3 2 3H4"/>',

  /**
   * Two silhouettes for a team.
   */
  team: '<circle cx="6.25" cy="5" r="2"/><path d="M2 13v-1c0-2 1.75-3.5 4.25-3.5s4.25 1.5 4.25 3.5v1m.25-9.5a2 2 0 0 1 0 4m1 2a3 3 0 0 1 2.25 3V13"/>',

  /**
   * One silhouette for a person.
   */
  person: '<circle cx="8" cy="5" r="2.5"/><path d="M3 14v-1a5 4 0 0 1 10 0v1"/>',

  /**
   * List for the Items collection.
   */
  work: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6 6h4.5M6 10h4.5m-5.5-4h.01m-.01 4h.01"/>',

  /**
   * Disclosure and hierarchy indicator.
   */
  chevron: '<path d="m6 4 4 4-4 4"/>',
} as const;

/**
 * Name of a shared icon.
 */
export type IconName = keyof typeof ICON_PATHS;

/**
 * Wraps a shared pictogram in a decorative SVG that assistive technology ignores.
 *
 * @param name Icon key from the shared set.
 * @returns Inline SVG markup built only from the constant paths above.
 */
export function iconMarkup(name: IconName): string {
  return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}
