import type { Entity } from '@roadmark/compiler/model';

import type { SiteData } from '../data.ts';
import type { SafeHtml } from '../ui/html.ts';

import { getStatus, KIND_LABELS } from '../data.ts';
import { factsRail, timelineLink } from '../ui/facts.ts';
import { kindGlyph } from '../ui/glyph.ts';
import { html, trustedHtml } from '../ui/html.ts';
import { entityLink } from '../ui/links.ts';
import { statusPill } from '../ui/pill.ts';
import { recordFacts, releaseNeighbours, resourceLinks } from './record-facts.ts';
import { related } from './relations.ts';
import { setTabs } from './set-items.ts';

/**
 * Renders a roadmap record: a header across the page, then the brief and its related work in a
 * reading column beside a facts rail.
 *
 * @param data Indexed roadmap and deployment prefix.
 * @param entity Record to render.
 * @returns Page content.
 */
export function entityPage(data: SiteData, entity: Entity): SafeHtml {
  const work = related(data, entity);
  return html`<article class="doc">
    ${recordHeading(data, entity)} ${entity.kind === 'set' ? setTabs(data, entity, 'overview') : ''}
    <div class="doc-body">
      ${recordRail(data, entity)}
      <div class="doc-main">
        ${recordBrief(entity)}
        ${work.value ? html`<div class="doc-sections" id="record-work">${work}</div>` : ''}
        ${resourceLinks(entity.links)}
      </div>
    </div>
  </article>`;
}

/**
 * Leads with the kind and parent, the title, and the stated outcome (or the description).
 *
 * @param data Indexed roadmap used to link the parent record.
 * @param entity Record with authored copy.
 * @returns Page heading.
 */
export function recordHeading(data: SiteData, entity: Entity): SafeHtml {
  const lead = entity.outcome?.trim() || entity.description.trim();
  const parentId = entity.kind === 'item' ? entity.set : undefined;
  return html`<header class="doc-head">
    <p class="doc-kind">
      ${kindGlyph(entity.kind)}${KIND_LABELS[entity.kind]}${
        parentId ? html` <span aria-hidden="true">·</span> ${entityLink(data, parentId)}` : ''
      }
    </p>
    <h1>${entity.title}</h1>
    ${lead ? html`<p class="doc-lead">${lead}</p>` : ''}
  </header>`;
}

/**
 * Opens the brief with the description when the outcome leads the page, then the compiled Markdown.
 * The Markdown is the page's only trusted island: it enters through `trustedHtml` here and nowhere
 * else.
 *
 * @param entity Record with its description and compiled Markdown.
 * @returns Brief, or nothing when there is no content.
 */
function recordBrief(entity: Entity): SafeHtml | '' {
  const outcome = entity.outcome?.trim();
  const description = entity.description.trim();
  const opening =
    outcome && description && description !== outcome ? html`<p>${description}</p>` : '';
  const body = entity.html.trim();
  if (!opening && !body) {
    return '';
  }

  return html`<div
    id="record-brief"
    class="prose"
    ${entity.kind === 'item' ? html`data-item-gallery` : ''}
  >
    ${opening}${trustedHtml(body)}
  </div>`;
}

/**
 * Shows status, dates, ownership and links in a rail that is always open. Releases also link to the
 * releases before and after them.
 *
 * @param data Indexed roadmap and deployment prefix.
 * @param entity Record whose facts are shown.
 * @returns Facts rail.
 */
function recordRail(data: SiteData, entity: Entity): SafeHtml {
  const selection = entity.kind === 'set' ? 'set' : 'selected';
  const href = `${data.base}timeline/?${selection}=${encodeURIComponent(entity.id)}`;
  return factsRail(
    html`${statusPill(getStatus(entity))}${timelineLink(href, 'Show on timeline')}`,
    recordFacts(data, entity),
    entity.kind === 'release' ? releaseNeighbours(data, entity) : '',
  );
}
