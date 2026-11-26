import type { SiteData } from '../data.ts';
import type { SafeHtml } from './html.ts';

import { avatarFor, dateLabel, personName, route, teamName } from '../data.ts';
import { html } from './html.ts';

/**
 * Links a roadmap record by stable ID with its display title.
 *
 * @param data Indexed roadmap used to resolve the ID.
 * @param id Stable record ID.
 * @returns Link, or the plain ID when the record is absent.
 */
export function entityLink(data: SiteData, id: string): SafeHtml {
  const entity = data.byId.get(id);
  if (!entity) {
    return html`${id}`;
  }

  return html`<a href="${data.base + route(entity.kind, id)}">${entity.title}</a>`;
}

/**
 * Links a team profile by registry ID.
 *
 * @param data Indexed team registry and deployment prefix.
 * @param id Stable team ID.
 * @returns Team profile link.
 */
export function teamLink(data: SiteData, id: string): SafeHtml {
  return html`<a href="${data.base + route('team', id)}">${teamName(data, id)}</a>`;
}

/**
 * Links a person's profile through their avatar, named for assistive technology.
 *
 * @param data Indexed people registry and deployment prefix.
 * @param id Stable person ID.
 * @returns Avatar link.
 */
export function personLink(data: SiteData, id: string): SafeHtml {
  const name = personName(data, id);
  const avatar = avatarFor(data, id);
  const label = avatar.src ? name : `${avatar.initials}, ${name}`;
  return html`<a
    class="person-link"
    href="${data.base + route('person', id)}"
    aria-label="${label}"
    title="${name}"
    >${personAvatar(avatar)}</a
  >`;
}

/**
 * Pairs a person's avatar link with their visible name.
 *
 * @param data Indexed people registry and deployment prefix.
 * @param id Stable person ID.
 * @returns Avatar link and name.
 */
export function personChip(data: SiteData, id: string): SafeHtml {
  return html`<span class="person-chip"
    >${personLink(data, id)}<span class="person-chip-name">${personName(data, id)}</span></span
  >`;
}

/**
 * Renders a decorative portrait or monogram.
 *
 * @param avatar Thumbnail URL and fallback initials.
 * @returns Circular thumbnail or initials.
 */
export function personAvatar(avatar: ReturnType<typeof avatarFor>): SafeHtml {
  const face = avatar.src
    ? html`<img src="${avatar.src}" width="32" height="32" alt="" decoding="async" />`
    : avatar.initials;
  return html`<span class="person-avatar" aria-hidden="true">${face}</span>`;
}

/**
 * Shows a date at its authored precision.
 *
 * @param date Authored day, month or quarter.
 * @returns A `<time>` element for days and months, plain text for quarters.
 */
export function time(date: string): SafeHtml {
  if (date.includes('-Q')) {
    return html`<span class="num">${dateLabel(date)}</span>`;
  }

  return html`<time class="num" datetime="${date}">${dateLabel(date)}</time>`;
}
