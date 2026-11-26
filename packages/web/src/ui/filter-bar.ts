import type { SafeHtml } from './html.ts';

import { icon } from './glyph.ts';
import { html } from './html.ts';

/**
 * Lists longer than this get a search field inside the chip's popup.
 */
const SEARCHABLE = 8;

/**
 * One filter chip.
 */
export type Chip = {
  /**
   * URL parameter the chip reads and writes.
   */
  param: string;

  /**
   * Row data attribute the chip matches, when it differs from the parameter.
   */
  field?: string;

  /**
   * Visible name, such as "Status".
   */
  label: string;

  /**
   * Text shown while nothing is chosen, such as "Any".
   */
  placeholder?: string;

  /**
   * Values and labels in display order.
   */
  choices: ReadonlyArray<readonly [value: string, label: string]>;
};

/**
 * A text field beside the chips.
 */
export type FilterSearch = {
  /**
   * URL parameter for the text.
   */
  param: string;

  /**
   * Placeholder and accessible name.
   */
  label: string;

  /**
   * `contains` filters rows by their text; `index` ranks the search index (the Items page).
   */
  mode: 'contains' | 'index';
};

/**
 * Renders a row of filter chips, each a `ui-select`, with an optional search field and a Clear
 * button. The bar is hidden without JavaScript (filters need the browser) and the chips upgrade the
 * first time someone reaches for them, so pages without filtering never load the select code.
 *
 * @param label Accessible name of the bar.
 * @param chips Chips in display order; chips without choices are left out.
 * @param search Optional text field.
 * @returns Filter bar.
 */
export function filterBar(
  label: string,
  chips: ReadonlyArray<Chip>,
  search?: FilterSearch,
): SafeHtml {
  return html`<div class="filter-bar" data-filter-bar role="group" aria-label="${label}">
    ${
      search
        ? html`<label class="filter-search"
            >${icon('search')}<span class="visually-hidden">${search.label}</span>
            <input
              type="search"
              name="${search.param}"
              placeholder="${search.label}"
              autocomplete="off"
              data-filter-text="${search.mode}"
          /></label>`
        : ''
    }
    ${chips.flatMap((entry) => (entry.choices.length > 0 ? [chip(entry, false)] : []))}
    <button type="button" class="filter-clear" data-filter-clear hidden>Clear</button>
  </div>`;
}

/**
 * Renders one chip: its label, a trigger showing the choice, a remove button and the options. A
 * setting chip (the timeline's grouping and zoom) always has a value, so it has no remove button
 * and is not a filter.
 *
 * @param chip Chip definition.
 * @param setting Whether the chip is a view setting rather than a filter.
 * @returns `ui-select` markup.
 */
export function chip(
  { param, field, label, placeholder = 'Any', choices }: Chip,
  setting = false,
): SafeHtml {
  const items = choices.map(
    ([value, text]) =>
      html`<ui-select-item value="${value}" label="${text}"
        ><ui-select-item-text>${text}</ui-select-item-text
        ><ui-select-item-indicator>${icon('check')}</ui-select-item-indicator></ui-select-item
      >`,
  );
  const role = setting
    ? html`data-setting="${param}"`
    : html`data-filter="${param}" data-field="${field ?? param}"`;
  // No ids here: the chips render on record pages, where authored Markdown may use any id. Before
  // the select upgrades, the button names itself; afterwards the select links its own label.
  return html`<ui-select class="chip" ${role} placeholder="${placeholder}" data-label="${label}">
    <ui-select-label class="chip-label">${label}<span aria-hidden="true">:</span></ui-select-label>
    <ui-select-trigger
      ><button type="button" class="chip-trigger" aria-label="${label}: ${placeholder}">
        <span class="chip-pending">${placeholder}</span
        ><ui-select-value></ui-select-value>${icon('chevron')}
      </button></ui-select-trigger
    >
    ${
      setting
        ? ''
        : html`<ui-select-clear
            ><button type="button" class="chip-remove" aria-label="Clear ${label}">
              ${icon('close')}
            </button></ui-select-clear
          >`
    }
    <ui-select-content class="menu" side="bottom" align="start">
      ${
        choices.length > SEARCHABLE
          ? html`<ui-select-input
                ><input aria-label="Search ${label}" placeholder="Search ${label.toLowerCase()}"
              /></ui-select-input>
              <ui-select-empty>No matches</ui-select-empty>`
          : ''
      }
      <ui-select-list>${items}</ui-select-list>
    </ui-select-content>
  </ui-select>`;
}
