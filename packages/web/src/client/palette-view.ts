import type { IconName } from '../ui/icons.ts';
import type { RankedResult, SearchEntry, Segment } from './search-rank.ts';

import { iconMarkup } from '../ui/icons.ts';
import { statusLabel, statusTone } from '../ui/status.ts';
import { HEADLINE_SCORE } from './search-rank.ts';

/**
 * Result groups in their default order, keyed by index record type.
 */
const GROUPS: ReadonlyArray<[type: string, label: string]> = [
  ['item', 'Items'],
  ['release', 'Releases'],
  ['set', 'Feature sets'],
  ['person', 'People'],
  ['team', 'Teams'],
];

/**
 * Glyph per index record type.
 */
const GLYPHS = new Map<string, IconName>([
  ['item', 'item'],
  ['release', 'release'],
  ['set', 'set'],
  ['person', 'person'],
  ['team', 'team'],
]);

/**
 * Creates an element with a class and optional text.
 *
 * @param tag Tag name.
 * @param className Class attribute.
 * @param text Text content, set as text so author content is never parsed as markup.
 * @returns The new element.
 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

/**
 * Writes runs of text, wrapping matched runs in `<mark>`.
 *
 * @param target Element to fill.
 * @param segments Matched and unmatched runs.
 * @returns The filled element.
 */
function marked(target: HTMLElement, segments: ReadonlyArray<Segment>): HTMLElement {
  for (const { text, match } of segments) {
    target.append(match ? element('mark', '', text) : text);
  }

  return target;
}

/**
 * Builds the leading glyph or portrait for a result.
 *
 * @param entry Indexed record.
 * @returns Decorative leading element.
 */
function leading(entry: SearchEntry): HTMLElement {
  if (entry.avatar) {
    const avatar = element('span', 'avatar avatar-small');
    avatar.setAttribute('aria-hidden', 'true');
    if (entry.avatar.src) {
      const portrait = element('img', '');
      portrait.src = entry.avatar.src;
      portrait.alt = '';
      portrait.width = 20;
      portrait.height = 20;
      avatar.append(portrait);
    } else {
      avatar.textContent = entry.avatar.initials;
    }

    return avatar;
  }

  const glyph = element('span', 'glyph');
  glyph.dataset['kind'] = entry.type;
  glyph.innerHTML = iconMarkup(GLYPHS.get(entry.type) ?? 'item');
  return glyph;
}

/**
 * Builds the status pill and Jira keys shown on the right of a result.
 *
 * @param result Ranked record.
 * @returns Meta element.
 */
function meta(result: RankedResult): HTMLElement {
  const { entry } = result;
  const node = element('span', 'palette-meta');
  if (entry.status) {
    const pill = element('span', 'pill');
    pill.dataset['tone'] = statusTone(entry.status);
    pill.append(element('span', 'pill-dot'), statusLabel(entry.status));
    node.append(pill);
  }

  if (result.keys.length > 0) {
    node.append(marked(element('span', 'palette-key'), result.keys));
  }

  return node;
}

/**
 * Builds one result: a command that renders as a link, so Enter and clicks open the record.
 *
 * @param result Ranked record with highlighted text.
 * @returns A `ui-command-item` wrapping an anchor.
 */
function resultItem(result: RankedResult): HTMLElement {
  const { entry } = result;
  const item = document.createElement('ui-command-item');
  item.setAttribute('value', entry.href);
  item.setAttribute('label', entry.title);
  item.setAttribute('as-child', '');
  const link = element('a', 'palette-row');
  link.href = entry.href;
  const text = element('span', 'palette-text');
  text.append(marked(element('span', 'palette-title'), result.title));
  const snippet = result.snippet.map(({ text: run }) => run).join('');
  if (snippet) {
    text.append(marked(element('span', 'palette-snippet'), result.snippet));
  }

  link.append(leading(entry), text, meta(result));
  item.append(link);
  return item;
}

/**
 * Lays results out so the DOM order never contradicts the rank: matches on a title word, an ID or a
 * Jira key come first as "Best matches" in rank order; the rest follow grouped by type, groups
 * ordered by their best result.
 *
 * @param results Results in rank order.
 * @returns `ui-command-group` elements in display order.
 */
export function resultGroups(results: ReadonlyArray<RankedResult>): Array<HTMLElement> {
  const best = results.filter(({ score }) => score >= HEADLINE_SCORE);
  const groups = new Map<string, Array<RankedResult>>();
  for (const result of results) {
    if (result.score >= HEADLINE_SCORE) {
      continue;
    }

    const known = GROUPS.some(([type]) => type === result.entry.type);
    const type = known ? result.entry.type : 'item';
    const members = groups.get(type) ?? [];
    members.push(result);
    groups.set(type, members);
  }

  const sections: Array<[string, ReadonlyArray<RankedResult>]> = [...groups.entries()].map(
    ([type, members]) => [GROUPS.find(([key]) => key === type)?.[1] ?? 'Results', members],
  );
  if (best.length > 0) {
    sections.unshift(['Best matches', best]);
  }

  return sections.map(([title, members]) => {
    const group = document.createElement('ui-command-group');
    const label = document.createElement('ui-command-group-label');
    label.textContent = title;
    group.append(label, ...members.map(resultItem));
    return group;
  });
}
