import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  assertSameNode,
  atlasFile,
  installDom,
  loadPage,
  params,
  query,
  runModule,
  settle,
  setUrl,
} from './test-dom.ts';

/**
 * The rendered timeline: lanes by release, eight dated records, one dependency.
 */
const page = await atlasFile('timeline/index.html');
installDom();

/**
 * Shows the timeline at a URL and runs the timeline module on it, as the page load does.
 *
 * @param path Path and query.
 */
async function open(path: string): Promise<void> {
  loadPage(page, path);
  await runModule('timeline.ts');
}

/**
 * The lanes in display order, with their rows.
 *
 * @returns Lane ID and row IDs per lane.
 */
function lanes(): Array<[string, Array<string>]> {
  return [...document.querySelectorAll<HTMLElement>('[data-gantt-lanes] > details')].map((lane) => [
    lane.dataset['lane'] ?? '',
    [...lane.querySelectorAll<HTMLElement>('[data-timeline-id]')].map(
      (row) => row.dataset['timelineId'] ?? '',
    ),
  ]);
}

/**
 * Clicks an element as a pointer would.
 *
 * @param target Element.
 * @param init Modifier keys and button.
 * @returns The click event, to check whether it was handled.
 */
function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * Reports a value from a timeline control as the UI SDK components do.
 *
 * @param target Control.
 * @param value New value.
 */
function choose(target: Element, value: string): void {
  target.dispatchEvent(new CustomEvent('valuechange', { detail: { value } }));
}

/**
 * The selection panel shown, if any.
 *
 * @returns Its record ID.
 */
function selectedPanel(): string | undefined {
  return document.querySelector<HTMLElement>('[data-selection]:not([hidden])')?.dataset[
    'selection'
  ];
}

void describe('timeline', () => {
  // First: pointing into the timeline loads the UI SDK controls, which then stay defined for the
  // whole file. (happy-dom also upgrades elements of pages an earlier test left behind, so the
  // switch is tested before and after the upgrade on one page.)
  void it('switches the view from the segmented control before and after it upgrades', async () => {
    await open('/timeline/');
    assert.equal(customElements.get('ui-segmented-control'), undefined);
    const list = query('ui-segmented-control-item[value="list"]', HTMLElement);
    click(list);
    assert.equal(params().get('view'), 'list');
    assert.equal(list.getAttribute('aria-checked'), 'true');
    assert.equal(list.tabIndex, 0);
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, true);

    query('[data-timeline]', HTMLElement).dispatchEvent(
      new PointerEvent('pointerover', { bubbles: true }),
    );
    for (let attempt = 0; attempt < 50 && !customElements.get('ui-select'); attempt += 1) {
      await settle();
    }

    assert.notEqual(customElements.get('ui-segmented-control'), undefined);
    assert.notEqual(customElements.get('ui-select'), undefined);
    assert.equal(
      document.querySelector('ui-segmented-control')?.value,
      'list',
      'the upgraded switch follows the URL',
    );
    choose(query('ui-segmented-control', HTMLElement), 'chart');
    assert.equal(params().get('view'), 'chart', 'an explicit choice outlasts a narrower screen');
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, false);
  });

  void it('opens on the chart in months, grouped by release, on a wide screen', async () => {
    await open('/timeline/');
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, false);
    assert.equal(query('[data-timeline-list]', HTMLElement).hidden, true);
    assert.equal(query('[data-gantt]', HTMLElement).dataset['zoom'], 'month');
    const tools = query('[data-timeline-tools]', HTMLElement);
    assert.equal(tools.dataset['view'], 'chart');
    assert.equal(tools.hasAttribute('data-ready'), true);
    const items = [...document.querySelectorAll('ui-segmented-control-item')];
    assert.deepEqual(
      items.map((item) => [item.getAttribute('value'), item.getAttribute('aria-checked')]),
      [
        ['chart', 'true'],
        ['list', 'false'],
      ],
    );
    assert.deepEqual(
      lanes().map(([lane]) => lane),
      ['rel-foundation', 'rel-spring', 'rel-summer'],
    );
    assert.equal(selectedPanel(), undefined);
  });

  void it('opens on the list on a narrow screen', async () => {
    mock.method(globalThis, 'matchMedia', (media: string) => ({
      media,
      matches: true,
      addEventListener: () => undefined,
    }));
    await open('/timeline/');
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, true);
    assert.equal(query('[data-timeline-list]', HTMLElement).hidden, false);
  });

  void it('shows the view, zoom and grouping a shared link asks for', async () => {
    await open('/timeline/?view=list&zoom=quarter&group=set');
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, true);
    assert.equal(query('[data-timeline-list]', HTMLElement).hidden, false);
    assert.equal(query('[data-gantt]', HTMLElement).dataset['zoom'], 'quarter');
    assert.equal(
      query('ui-select[data-setting="zoom"] .chip-pending', HTMLElement).textContent,
      query(
        'ui-select[data-setting="zoom"] ui-select-item[value="quarter"]',
        HTMLElement,
      ).getAttribute('label'),
    );
    // Releases belong to no single feature set, so they gather in a last lane.
    assert.deepEqual(lanes(), [
      ['set-billing', ['item-invoice-preview']],
      ['set-onboarding', ['item-setup-recovery', 'item-guided-setup']],
      ['set-platform', ['item-setup-events']],
      ['', ['rel-foundation', 'rel-spring', 'rel-summer']],
    ]);
    assert.equal(query('details[data-lane=""] summary', HTMLElement).textContent, 'Release dates');
  });

  void it('ignores settings it does not know', async () => {
    await open('/timeline/?view=table&zoom=year&group=owner');
    assert.equal(query('[data-timeline-chart]', HTMLElement).hidden, false);
    assert.equal(query('[data-gantt]', HTMLElement).dataset['zoom'], 'month');
    assert.equal(lanes().length, 3);
  });

  void it('selects a bar on a plain click and highlights the rows it depends on', async () => {
    await open('/timeline/?zoom=quarter');
    const mark = query('[data-mark="item-guided-setup"]', HTMLElement);
    const event = click(mark);
    assert.equal(event.defaultPrevented, true);
    assert.equal(location.search, '?zoom=quarter&selected=item-guided-setup');
    assert.equal(selectedPanel(), 'item-guided-setup');
    assert.equal(mark.hasAttribute('data-selected'), true);
    const connected = [...document.querySelectorAll<HTMLElement>('.is-connected')].map(
      (row) => row.dataset['timelineId'],
    );
    assert.deepEqual(connected, ['item-setup-events', 'item-guided-setup']);

    click(mark);
    assert.equal(params().has('selected'), false, 'a second click clears the selection');
    assert.equal(selectedPanel(), undefined);
    assertSameNode(document.querySelector('.is-connected, [data-mark][data-selected]'), null);
  });

  void it('lets modified and secondary clicks follow the bar’s link', async () => {
    await open('/timeline/');
    const mark = query('[data-mark="item-setup-events"]', HTMLElement);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      assert.equal(click(mark, init).defaultPrevented, false);
    }

    assert.equal(params().has('selected'), false);
  });

  void it('clears the selection from its panel and returns focus to the bar', async () => {
    await open('/timeline/?selected=item-setup-events');
    assert.equal(selectedPanel(), 'item-setup-events');
    const before = history.length;
    click(query('[data-selection="item-setup-events"] [data-clear-selection]', HTMLElement));
    assert.equal(params().has('selected'), false);
    assert.equal(history.length, before + 1);
    assert.equal(selectedPanel(), undefined);
    assertSameNode(document.activeElement, query('[data-mark="item-setup-events"]', HTMLElement));
  });

  void it('ignores a selection whose row the filters hide', async () => {
    loadPage(page, '/timeline/?selected=item-setup-events');
    query('[data-gantt] [data-timeline-id="item-setup-events"]', HTMLElement).hidden = true;
    await runModule('timeline.ts');
    assert.equal(selectedPanel(), undefined);
  });

  void it('regroups the lanes and zooms from the setting chips', async () => {
    await open('/timeline/');
    choose(query('ui-select[data-setting="group"]', HTMLElement), 'team');
    assert.equal(params().get('group'), 'team');
    assert.deepEqual(
      lanes().map(([lane]) => lane),
      ['billing', 'growth', 'platform', ''],
    );
    choose(query('ui-select[data-setting="zoom"]', HTMLElement), 'quarter');
    assert.equal(query('[data-gantt]', HTMLElement).dataset['zoom'], 'quarter');
    choose(query('ui-select[data-setting="zoom"]', HTMLElement), 'month');
    assert.equal(location.search, '?group=team');
  });

  void it('keeps a collapsed lane closed when regrouping away and back', async () => {
    await open('/timeline/');
    const spring = query('details[data-lane="rel-spring"]', HTMLDetailsElement);
    spring.open = false;
    spring.dispatchEvent(new Event('toggle'));
    choose(query('ui-select[data-setting="group"]', HTMLElement), 'set');
    assert.equal(
      [...document.querySelectorAll<HTMLDetailsElement>('details[data-lane]')].every(
        (lane) => lane.open,
      ),
      true,
    );
    choose(query('ui-select[data-setting="group"]', HTMLElement), 'release');
    const lanesByRelease = [...document.querySelectorAll<HTMLDetailsElement>('details[data-lane]')];
    assert.deepEqual(
      lanesByRelease.map((lane) => [lane.dataset['lane'], lane.open]),
      [
        ['rel-foundation', true],
        ['rel-spring', false],
        ['rel-summer', true],
      ],
    );
  });

  void it('places the today marker inside the chart and hides it outside', async () => {
    loadPage(page, '/timeline/');
    const gantt = query('[data-gantt]', HTMLElement);
    const start = Number(gantt.dataset['start']);
    const end = Number(gantt.dataset['end']);
    mock.timers.enable({ apis: ['Date'], now: start + (end - start) / 4 });
    await runModule('timeline.ts');
    const marker = query('[data-today]', HTMLElement);
    assert.equal(marker.hidden, false);
    assert.equal(marker.style.getPropertyValue('--today'), '0.25');
    mock.timers.setTime(end);
    dispatchEvent(new PopStateEvent('popstate'));
    assert.equal(marker.hidden, true);
  });

  void it('follows history navigation and refiltering', async () => {
    await open('/timeline/');
    setUrl('/timeline/?view=list&selected=rel-spring');
    dispatchEvent(new PopStateEvent('popstate'));
    assert.equal(query('[data-timeline-list]', HTMLElement).hidden, false);
    assert.equal(selectedPanel(), 'rel-spring');
    query('[data-gantt] [data-timeline-id="rel-spring"]', HTMLElement).hidden = true;
    document.dispatchEvent(new Event('roadmap:filters'));
    assert.equal(selectedPanel(), undefined);
  });
});
