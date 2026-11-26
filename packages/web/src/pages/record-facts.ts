import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { Fact } from '../ui/facts.ts';
import type { SafeHtml } from '../ui/html.ts';

import { icon } from '../ui/glyph.ts';
import { html, joinHtml } from '../ui/html.ts';
import { entityLink, personChip, teamLink, time } from '../ui/links.ts';

/**
 * Matches slashes that would otherwise duplicate the Jira browse path separator.
 */
const TRAILING_SLASHES = /\/+$/;

/**
 * Matches a dotted IPv4 address as the URL parser normalizes it.
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Local-use, infrastructure and reserved suffixes that use the built-in link icon.
 */
const LOCAL_SUFFIXES = new Set([
  'arpa',
  'corp',
  'example',
  'home',
  'internal',
  'invalid',
  'intranet',
  'lan',
  'local',
  'localhost',
  'localdomain',
  'onion',
  'test',
]);

/**
 * Collects a record's facts in rail order. Short facts (dates, Jira, ID) pair up on narrow screens;
 * ownership and parent records take the full width.
 *
 * @param data Indexed roadmap with linked records and profiles.
 * @param entity Record whose facts are shown.
 * @returns Facts, empty values included (the rail leaves them out).
 */
export function recordFacts(data: SiteData, entity: Entity): Array<Fact> {
  const contributors = entity.contributors ?? [];
  return [
    { term: 'Feature set', value: entity.set ? entityLink(data, entity.set) : '', wide: true },
    { term: 'Start', value: entity.start ? time(entity.start) : '' },
    { term: 'Target', value: entity.target ? time(entity.target) : '' },
    { term: 'Shipped', value: entity.shipped_on ? time(entity.shipped_on) : '' },
    { term: 'Product manager', value: owner(data, entity), wide: true },
    {
      term: 'Contributors',
      value:
        contributors.length > 0
          ? html`<span class="person-group"
              >${contributors.map((id) => personChip(data, id))}</span
            >`
          : '',
      wide: true,
    },
    { term: 'Engineering team', value: engineering(data, entity), wide: true },
    {
      term: 'Contributing teams',
      value: joinHtml(
        entity.contributing_teams.map((id) => teamLink(data, id)),
        html`<br />`,
      ),
      wide: true,
    },
    { term: 'Release', value: releaseOf(data, entity), wide: true },
    { term: 'Jira', value: jira(data, entity.jira) },
    { term: 'ID', value: entity.kind === 'item' ? html`<code>${entity.id}</code>` : '' },
  ];
}

/**
 * Links the releases before and after this one in target order.
 *
 * @param data Releases in target order.
 * @param release Current release.
 * @returns Previous and next links, or nothing when the release stands alone.
 */
export function releaseNeighbours(data: SiteData, release: Entity): SafeHtml | '' {
  const index = data.releases.findIndex(({ id }) => id === release.id);
  const previous = data.releases[index - 1];
  const next = data.releases[index + 1];
  if (!previous && !next) {
    return '';
  }

  return html`<nav class="facts-neighbours" aria-label="Releases">
    ${
      previous
        ? html`<a href="${data.base}releases/${encodeURIComponent(previous.id)}/" rel="prev"
            ><span>Previous release</span>${previous.title}</a
          >`
        : ''
    }
    ${
      next
        ? html`<a href="${data.base}releases/${encodeURIComponent(next.id)}/" rel="next"
            ><span>Next release</span>${next.title}</a
          >`
        : ''
    }
  </nav>`;
}

/**
 * Shows the linked release, or "Unassigned" for items without one.
 *
 * @param data Indexed roadmap.
 * @param entity Record that may belong to a release.
 * @returns Release link, label or nothing.
 */
export function releaseOf(data: SiteData, entity: Entity): SafeHtml | '' {
  if (entity.release) {
    return entityLink(data, entity.release);
  }

  return entity.kind === 'item' ? html`Unassigned` : '';
}

/**
 * Lists named external links with their hosts.
 *
 * @param links Validated web links in authored order.
 * @returns Links section, or nothing.
 */
export function resourceLinks(links: Entity['links']): SafeHtml | '' {
  if (!links?.length) {
    return '';
  }

  const rows = links.map(({ label, url }) => {
    const destination = new URL(url);
    return html`<li>
      <a class="resource-link" href="${url}">
        ${resourceIcon(destination.hostname)}
        <span
          ><span class="resource-label">${label}</span>
          <span class="resource-host">${destination.host}</span></span
        >
      </a>
    </li>`;
  });
  return html`<section class="resource-links" aria-label="Links">
    <h2>Links</h2>
    <ul>
      ${rows}
    </ul>
  </section>`;
}

/**
 * Adds a hostname-only favicon request for public web names, over a local globe fallback.
 *
 * @param hostname Normalized hostname without port, path or query.
 * @returns Decorative icon tile.
 */
function resourceIcon(hostname: string): SafeHtml {
  const domain = hostname.replace(/\.$/, '');
  const suffix = domain.split('.').at(-1) ?? '';
  const isPublic =
    domain.includes('.') &&
    !domain.startsWith('[') &&
    !IPV4.test(domain) &&
    !LOCAL_SUFFIXES.has(suffix);
  let image: SafeHtml | '' = '';
  if (isPublic) {
    const src = new URL('https://www.google.com/s2/favicons');
    src.searchParams.set('domain', domain);
    src.searchParams.set('sz', '32');
    // One line keeps the favicon element easy to find in the published markup.
    // prettier-ignore
    image = html`<img src="${src.href}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
  }

  return html`<span class="resource-icon" aria-hidden="true">${icon('globe')}${image}</span>`;
}

/**
 * Shows the effective product manager and marks inherited ownership.
 *
 * @param data Indexed people registry.
 * @param entity Record with a resolved product manager.
 * @returns Profile chip and inheritance note, or nothing.
 */
function owner(data: SiteData, entity: Entity): SafeHtml | '' {
  return entity.pm ? html`${personChip(data, entity.pm)}${inherited(entity.inherited_pm)}` : '';
}

/**
 * Shows the effective engineering team and marks inherited ownership.
 *
 * @param data Indexed team registry.
 * @param entity Record with a resolved engineering team.
 * @returns Team link and inheritance note, or nothing.
 */
function engineering(data: SiteData, entity: Entity): SafeHtml | '' {
  const team = entity.engineering_team;
  return team ? html`${teamLink(data, team)}${inherited(entity.inherited_engineering_team)}` : '';
}

/**
 * Notes ownership inherited from a feature set.
 *
 * @param value Whether the ownership is inherited.
 * @returns Note, or nothing.
 */
function inherited(value: boolean | undefined): SafeHtml | '' {
  return value ? html` <span class="inherited">From feature set</span>` : '';
}

/**
 * Formats Jira keys, linked when the workspace sets a Jira base URL.
 *
 * @param data Workspace settings.
 * @param keys Issue keys on the record.
 * @returns Keys as code, linked when possible.
 */
function jira(data: SiteData, keys: ReadonlyArray<string>): SafeHtml {
  const base = data.workspace.jira_base_url;
  return joinHtml(
    keys.map((key) => {
      if (!base) {
        return html`<code>${key}</code>`;
      }

      const url = new URL(base);
      const prefix = url.pathname.replace(TRAILING_SLASHES, '');
      const browse = prefix.endsWith('/browse') ? prefix : `${prefix}/browse`;
      url.pathname = `${browse}/${encodeURIComponent(key)}`;
      return html`<a href="${url.href}"><code>${key}</code></a>`;
    }),
    html``,
  );
}
