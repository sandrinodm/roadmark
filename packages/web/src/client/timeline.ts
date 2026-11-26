/**
 * The timeline: view, grouping and zoom from the URL, selection of a bar with its dependencies
 * drawn, regrouped lanes and the today marker. Plain DOM; the UI SDK controls and tooltips load
 * from `timeline-controls.ts` the first time someone points at or tabs into the timeline.
 */

import { showChoice } from './chip-text.ts';
import { loadModule } from './stale.ts';
import { drawEdges } from './timeline-edges.ts';

/**
 * Settings the URL can carry, with their defaults.
 */
const DEFAULTS = {
  /**
   * Lanes by release.
   */
  group: 'release',

  /**
   * Month columns.
   */
  zoom: 'month',

  /**
   * Gantt or list, chosen by screen width when absent.
   */
  view: '',

  /**
   * No bar selected.
   */
  selected: '',
};

/**
 * A setting stored in the URL.
 */
type Setting = keyof typeof DEFAULTS;

/**
 * Lane name for records outside every lane of a grouping.
 */
const FALLBACK = new Map([['release', 'Unassigned release']]);

/**
 * Page parts the timeline works with.
 */
type Parts = {
  /**
   * Timeline root.
   */
  root: HTMLElement;

  /**
   * Chart section, absent when nothing has a date.
   */
  chart: HTMLElement | null;

  /**
   * Chart grid.
   */
  gantt: HTMLElement | null;

  /**
   * Dated list.
   */
  list: HTMLElement | null;

  /**
   * Chart rows by record ID.
   */
  rows: Map<string, HTMLElement>;
};

/**
 * Lanes currently shown, as `mode:id` keys of collapsed lanes plus the active grouping.
 */
const lanes = {
  /**
   * Grouping the lanes currently follow.
   */
  mode: 'release',

  /**
   * Collapsed lanes, as `mode:id`.
   */
  collapsed: new Set<string>(),
};

/**
 * Narrow screens open on the list.
 */
const narrow = matchMedia('(max-width: 41rem)');

/**
 * Reads the timeline settings from the URL.
 *
 * @returns Settings with defaults applied.
 */
function state(): Record<Setting, string> {
  const query = new URLSearchParams(location.search);
  const view = query.get('view');
  return {
    group: ['release', 'set', 'team'].includes(query.get('group') ?? '')
      ? (query.get('group') ?? 'release')
      : 'release',
    zoom: query.get('zoom') === 'quarter' ? 'quarter' : 'month',
    view: view === 'list' || view === 'chart' ? view : defaultView(),
    selected: query.get('selected') ?? '',
  };
}

/**
 * Writes one setting to the URL and updates the page.
 *
 * @param parts Page parts.
 * @param name Setting.
 * @param value New value; the default removes it from the URL.
 */
function update(parts: Parts, name: Setting, value: string): void {
  const url = new URL(location.href);
  if ((url.searchParams.get(name) ?? DEFAULTS[name]) === value) {
    return;
  }

  if (value === DEFAULTS[name]) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }

  history.pushState(null, '', url);
  sync(parts);
}

/**
 * Shows the view, grouping, zoom and selection the URL asks for.
 *
 * @param parts Page parts.
 */
function sync(parts: Parts): void {
  const settings = state();
  const selected = parts.rows.get(settings.selected)?.hidden ? '' : settings.selected;
  if (parts.gantt && parts.chart && parts.list) {
    parts.gantt.dataset['zoom'] = settings.zoom;
    parts.chart.hidden = settings.view === 'list';
    parts.list.hidden = settings.view === 'chart';
    showView(parts.root, settings.view);
    showSettings(parts.root, settings);
    regroup(parts, settings.group);
    placeToday(parts.gantt);
  }

  const panel = showSelection(parts, selected);
  requestAnimationFrame(() => drawEdges(parts.root, panel));
}

/**
 * Shows the selected record's panel, marks its bar and highlights the rows it connects to.
 *
 * @param parts Page parts.
 * @param selected Selected record ID, or empty.
 * @returns The selection panel, if any.
 */
function showSelection(parts: Parts, selected: string): Element | null {
  for (const panel of parts.root.querySelectorAll<HTMLElement>('[data-selection]')) {
    panel.hidden = panel.dataset['selection'] !== selected;
  }

  const connected = new Set([selected]);
  const panel = parts.root.querySelector(`[data-selection="${CSS.escape(selected)}"]`);
  for (const edge of panel?.querySelectorAll<HTMLElement>('[data-edge-from]') ?? []) {
    connected.add(edge.dataset['edgeFrom'] ?? '');
    connected.add(edge.dataset['edgeTo'] ?? '');
  }

  for (const mark of parts.root.querySelectorAll<HTMLElement>('[data-mark]')) {
    mark.toggleAttribute('data-selected', mark.dataset['mark'] === selected);
  }

  for (const [id, row] of parts.rows) {
    row.classList.toggle('is-connected', selected !== '' && connected.has(id));
  }

  return panel;
}

/**
 * Reflects the view in the Gantt/List switch, before and after it upgrades.
 *
 * @param root Timeline root.
 * @param view `chart` or `list`.
 */
function showView(root: HTMLElement, view: string): void {
  const tools = root.querySelector<HTMLElement>('[data-timeline-tools]');
  if (tools) {
    tools.dataset['view'] = view;
  }

  const control = root.querySelector('ui-segmented-control');
  if (control && customElements.get('ui-segmented-control')) {
    if (control.value !== view) {
      control.value = view;
    }

    return;
  }

  for (const item of control?.querySelectorAll('ui-segmented-control-item') ?? []) {
    const checked = item.getAttribute('value') === view;
    item.setAttribute('aria-checked', String(checked));
    item.tabIndex = checked ? 0 : -1;
    item.toggleAttribute('data-checked', checked);
  }
}

/**
 * Reflects grouping and zoom in their chips, before and after they upgrade.
 *
 * @param root Timeline root.
 * @param settings Current settings.
 */
function showSettings(root: HTMLElement, settings: Record<Setting, string>): void {
  for (const chip of settingChips(root)) {
    const value = settings[chip.dataset['setting'] === 'zoom' ? 'zoom' : 'group'];
    const label = chip.querySelector(`ui-select-item[value="${value}"]`)?.getAttribute('label');
    if (label) {
      showChoice(chip, label);
    }

    if (customElements.get('ui-select') && chip.value !== value) {
      chip.value = value;
    }
  }
}

/**
 * Moves the chart rows into the lanes of a grouping.
 *
 * @param parts Page parts.
 * @param mode Grouping.
 */
function regroup(parts: Parts, mode: string): void {
  const container = parts.root.querySelector('[data-gantt-lanes]');
  if (!container || mode === lanes.mode) {
    return;
  }

  const partitions = new Map<string, Array<HTMLElement>>();
  for (const row of parts.rows.values()) {
    const id = row.getAttribute(`data-zoom-${mode}`) ?? '';
    partitions.set(id, [...(partitions.get(id) ?? []), row]);
  }

  const names = [...parts.root.querySelectorAll<HTMLElement>(`[data-lanes="${mode}"] span`)];
  const order: Array<[string, string]> = [
    ...names.map((name): [string, string] => [name.dataset['laneId'] ?? '', name.textContent]),
    ['', FALLBACK.get(mode) ?? 'Release dates'],
  ];
  container.replaceChildren(
    ...order.flatMap(([id, name]) => {
      const members = partitions.get(id);
      return members ? [lane(mode, id, name, members)] : [];
    }),
  );
  lanes.mode = mode;
}

/**
 * Builds one collapsible lane.
 *
 * @param mode Grouping.
 * @param id Lane ID.
 * @param name Lane heading.
 * @param rows Rows in the lane.
 * @returns Lane.
 */
function lane(
  mode: string,
  id: string,
  name: string,
  rows: ReadonlyArray<HTMLElement>,
): HTMLElement {
  const wrapper = document.createElement('details');
  const header = document.createElement('summary');
  const label = document.createElement('span');
  wrapper.dataset['filterGroup'] = '';
  wrapper.dataset['lane'] = id;
  wrapper.open = !lanes.collapsed.has(`${mode}:${id}`);
  wrapper.hidden = rows.every((row) => row.hidden);
  header.className = 'gantt-group';
  label.textContent = name;
  header.append(label);
  wrapper.append(header, ...rows);
  return wrapper;
}

/**
 * Places the today marker, hidden when today is outside the chart.
 *
 * @param gantt Chart grid with its date range.
 */
function placeToday(gantt: HTMLElement): void {
  const marker = gantt.querySelector<HTMLElement>('[data-today]');
  const start = Number(gantt.dataset['start']);
  const end = Number(gantt.dataset['end']);
  const now = Date.now();
  if (!marker) {
    return;
  }

  marker.hidden = !(now >= start && now < end);
  marker.style.setProperty('--today', String((now - start) / (end - start)));
}

/**
 * Selects a bar on click (a plain link without the script), and clears the selection.
 *
 * @param parts Page parts.
 * @param event Click.
 */
function select(parts: Parts, event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const mark = target?.closest<HTMLElement>('[data-mark]');
  const item = target?.closest('ui-segmented-control-item');
  if (mark && isPlainClick(event)) {
    event.preventDefault();
    const id = mark.dataset['mark'] ?? '';
    update(parts, 'selected', state().selected === id ? '' : id);
  } else if (target?.closest('[data-clear-selection]')) {
    const previous = state().selected;
    update(parts, 'selected', '');
    parts.root.querySelector<HTMLElement>(`[data-mark="${CSS.escape(previous)}"]`)?.focus();
  } else if (item && !customElements.get('ui-segmented-control')) {
    update(parts, 'view', item.getAttribute('value') ?? 'chart');
  }
}

/**
 * Whether a click is a plain primary press, not a request to open a new tab or window.
 *
 * @param event Click.
 * @returns True without modifier keys on the primary button.
 */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/**
 * The UI SDK controls module, once requested.
 */
let controls: Promise<void> | undefined;

/**
 * Loads the UI SDK controls and tooltips once.
 *
 * @returns The pending module.
 */
function loadControls(): Promise<void> {
  controls ??= loadModule('timeline-controls', async () => import('./timeline-controls.ts')).then(
    () => undefined,
  );
  return controls;
}

/**
 * Opens a grouping or zoom chip pressed before its select was ready, so the first press counts.
 *
 * @param event Click anywhere in the timeline.
 */
function replayPress(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const chip = target?.closest('ui-select');
  if (!chip?.dataset['setting'] || customElements.get('ui-select')) {
    return;
  }

  void loadControls()
    .then(async () => customElements.whenDefined('ui-select'))
    .then(() => {
      chip.open = true;
      return chip;
    });
}

/**
 * Connects the timeline on this page.
 *
 * @param root Timeline root.
 */
function connect(root: HTMLElement): void {
  const parts: Parts = {
    root,
    chart: root.querySelector('[data-timeline-chart]'),
    gantt: root.querySelector('[data-gantt]'),
    list: root.querySelector('[data-timeline-list]'),
    rows: new Map(
      [...root.querySelectorAll<HTMLElement>('[data-timeline-id]')].map((row) => [
        row.dataset['timelineId'] ?? '',
        row,
      ]),
    ),
  };
  root.addEventListener('click', (event) => select(parts, event));
  root.querySelector('ui-segmented-control')?.addEventListener('valuechange', (event) => {
    update(parts, 'view', typeof event.detail.value === 'string' ? event.detail.value : 'chart');
  });
  for (const chip of settingChips(root)) {
    chip.addEventListener('valuechange', (event) => {
      const name = chip.dataset['setting'] === 'zoom' ? 'zoom' : 'group';
      update(
        parts,
        name,
        typeof event.detail.value === 'string' ? event.detail.value : DEFAULTS[name],
      );
    });
  }

  root.addEventListener('toggle', (event) => remember(parts, event), true);
  for (const type of ['pointerover', 'focusin']) {
    root.addEventListener(type, () => void loadControls(), { once: true });
  }

  root.addEventListener('click', replayPress, { capture: true });

  root.querySelector<HTMLElement>('[data-timeline-tools]')?.setAttribute('data-ready', '');
  addEventListener('popstate', () => sync(parts));
  document.addEventListener('roadmap:filters', () => sync(parts));
  narrow.addEventListener('change', () => sync(parts));
  if (parts.gantt) {
    new ResizeObserver(() => sync(parts)).observe(parts.gantt);
  }

  sync(parts);
  revealSelection(parts);
}

/**
 * Remembers collapsed lanes so regrouping and refiltering keep them closed.
 *
 * @param parts Page parts.
 * @param event Toggle of a lane.
 */
function remember(parts: Parts, event: Event): void {
  const group = event.target instanceof HTMLDetailsElement ? event.target : null;
  if (!group?.hasAttribute('data-lane')) {
    return;
  }

  const key = `${lanes.mode}:${group.dataset['lane'] ?? ''}`;
  if (group.open) {
    lanes.collapsed.delete(key);
  } else {
    lanes.collapsed.add(key);
  }

  requestAnimationFrame(() =>
    drawEdges(parts.root, parts.root.querySelector('[data-selection]:not([hidden])')),
  );
}

/**
 * Scrolls a selected bar from a shared link into view.
 *
 * @param parts Page parts.
 */
function revealSelection(parts: Parts): void {
  const mark = parts.rows.get(state().selected)?.querySelector('[data-mark]');
  const scroll = parts.root.querySelector('.gantt-scroll');
  if (!mark || !scroll || parts.chart?.hidden) {
    return;
  }

  const markBounds = mark.getBoundingClientRect();
  const scrollBounds = scroll.getBoundingClientRect();
  if (markBounds.right > scrollBounds.right) {
    scroll.scrollLeft += markBounds.left - scrollBounds.left - scrollBounds.width / 2;
  }
}

/**
 * Opens on the list on narrow screens and on the chart elsewhere.
 *
 * @returns Default view.
 */
function defaultView(): string {
  return narrow.matches ? 'list' : 'chart';
}

/**
 * The timeline on this page, if any.
 */
const timeline = document.querySelector<HTMLElement>('[data-timeline]');
if (timeline) {
  connect(timeline);
}

/**
 * Lists the timeline's view setting chips.
 *
 * @param root Timeline root.
 * @returns Grouping and zoom chips.
 */
function settingChips(root: HTMLElement): Array<HTMLElementTagNameMap['ui-select']> {
  return [...root.querySelectorAll('ui-select')].filter((chip) => chip.dataset['setting']);
}
