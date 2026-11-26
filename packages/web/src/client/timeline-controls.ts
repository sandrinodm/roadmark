/**
 * Upgrades the timeline's Gantt/List switch, grouping and zoom chips and bar tooltips to UI SDK
 * components. `timeline.ts` loads this the first time someone points at or tabs into the timeline
 * and listens to the components' `valuechange` events itself.
 */

import type { UiTooltipElement } from '@ui-sdk/web';

// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-segmented-control>.
import '@ui-sdk/web/segmented-control';
// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-select>.
import '@ui-sdk/web/select';
// oxlint-disable-next-line import/no-unassigned-import -- importing the entry registers <ui-tooltip>.
import '@ui-sdk/web/tooltip';

import { labelChip } from './filter-chips.ts';

/**
 * Gives every bar its tooltip text and fills the shared tooltip as it moves between bars.
 */
async function connectTooltips(): Promise<void> {
  await customElements.whenDefined('ui-tooltip');
  const tooltip = document.querySelector<UiTooltipElement<string>>('#timeline-tip');
  const content = tooltip?.querySelector('ui-tooltip-content');
  if (!tooltip || !content) {
    return;
  }

  for (const trigger of document.querySelectorAll('ui-tooltip-trigger')) {
    trigger.payload = trigger.getAttribute('data-tip') ?? '';
  }

  tooltip.addEventListener('payloadchange', (event) => {
    content.textContent = event.detail.value ?? '';
  });
}

/**
 * Sets the upgraded controls to the values in the URL.
 */
async function connectControls(): Promise<void> {
  await Promise.all([
    customElements.whenDefined('ui-segmented-control'),
    customElements.whenDefined('ui-select'),
  ]);
  const params = new URLSearchParams(location.search);
  const view = document.querySelector('ui-segmented-control');
  // The URL, or the screen width when it names no view, decides; the component's own default
  // (or the aria-checked it set while upgrading) does not.
  const requested = params.get('view');
  if (view) {
    view.value = requested === 'list' || requested === 'chart' ? requested : widthView();
  }

  for (const chip of settingChips()) {
    const name = chip.dataset['setting'] ?? 'group';
    chip.value = params.get(name) ?? (name === 'zoom' ? 'month' : 'release');
    labelChip(chip);
  }
}

void Promise.all([connectTooltips(), connectControls()]);

/**
 * Lists the timeline's view setting chips.
 *
 * @returns Grouping and zoom chips.
 */
function settingChips(): Array<HTMLElementTagNameMap['ui-select']> {
  return [...document.querySelectorAll('ui-select')].filter((chip) => chip.dataset['setting']);
}

/**
 * Picks the view for a URL without one: the list on narrow screens, the chart elsewhere.
 *
 * @returns View.
 */
function widthView(): string {
  return matchMedia('(max-width: 41rem)').matches ? 'list' : 'chart';
}
