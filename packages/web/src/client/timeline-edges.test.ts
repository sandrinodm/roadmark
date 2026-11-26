import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { atlasFile, installDom, loadPage, query } from './test-dom.ts';

/**
 * The rendered timeline page. Setup completion events (Feb) is a prerequisite of Guided setup.
 */
const page = await atlasFile('timeline/index.html');
installDom();

/**
 * The module under test, loaded once the DOM globals exist.
 */
const { drawEdges } = await import('./timeline-edges.ts');

/**
 * Prerequisite and dependent record of the Atlas dependency.
 */
const FROM = 'item-setup-events';

/**
 * The record that depends on `FROM`.
 */
const TO = 'item-guided-setup';

/**
 * Shows the timeline and gives the chart and the two bars fixed boxes, as layout would.
 *
 * @param from Prerequisite bar box: left, top, width, height.
 * @param to Dependent bar box.
 * @returns Timeline root and the selection panel of the prerequisite.
 */
function layout(from: [number, number, number, number], to: [number, number, number, number]) {
  loadPage(page, '/timeline/');
  const root = query('[data-timeline]', HTMLElement);
  mock.method(query('[data-gantt]', HTMLElement), 'getBoundingClientRect', () => {
    return new DOMRect(100, 50, 800, 400);
  });
  mock.method(query(`[data-mark="${FROM}"]`, HTMLElement), 'getBoundingClientRect', () => {
    return new DOMRect(...from);
  });
  mock.method(query(`[data-mark="${TO}"]`, HTMLElement), 'getBoundingClientRect', () => {
    return new DOMRect(...to);
  });
  return { root, panel: query(`[data-selection="${FROM}"]`, HTMLElement) };
}

/**
 * The paths drawn in the edge layer.
 *
 * @returns Path elements.
 */
function paths(): Array<Element> {
  return [...query('[data-gantt-edges]', Element).children];
}

void describe('drawEdges', () => {
  void it('routes a straight elbow when the dependent starts well after the prerequisite', () => {
    const { root, panel } = layout([110, 70, 90, 20], [300, 130, 100, 20]);
    drawEdges(root, panel);
    const [path, ...rest] = paths();
    assert.equal(rest.length, 0);
    // From (100, 30) relative to the chart to (200, 90): turn halfway along.
    assert.equal(path?.getAttribute('d'), 'M 100 30 H 150 V 90 H 200 m -5 -3 l 5 3 -5 3');
    assert.equal(path.getAttribute('class'), 'connection-path');
    assert.equal(path.namespaceURI, 'http://www.w3.org/2000/svg');
  });

  void it('doubles back through the middle when the dependent starts too soon', () => {
    const { root, panel } = layout([110, 70, 190, 20], [205, 130, 100, 20]);
    drawEdges(root, panel);
    assert.equal(
      paths()[0]?.getAttribute('d'),
      'M 200 30 H 212 V 60 H 97 V 90 H 105 m -5 -3 l 5 3 -5 3',
    );
  });

  void it('marks an edge whose dates conflict', () => {
    const { root, panel } = layout([110, 70, 90, 20], [300, 130, 100, 20]);
    query('[data-edge-from]', HTMLElement, panel).dataset['conflict'] = 'true';
    drawEdges(root, panel);
    assert.equal(paths()[0]?.getAttribute('class'), 'conflict-path');
  });

  void it('replaces the paths of an earlier selection and clears them without a panel', () => {
    const { root, panel } = layout([110, 70, 90, 20], [300, 130, 100, 20]);
    drawEdges(root, panel);
    drawEdges(root, panel);
    assert.equal(paths().length, 1);
    drawEdges(root, null);
    assert.equal(paths().length, 0);
  });

  void it('skips edges to a filtered-out bar or one in a collapsed lane', () => {
    const { root, panel } = layout([110, 70, 90, 20], [300, 130, 100, 20]);
    query(`[data-timeline-id="${TO}"]`, HTMLElement).hidden = true;
    drawEdges(root, panel);
    assert.equal(paths().length, 0);
    query(`[data-timeline-id="${TO}"]`, HTMLElement).hidden = false;
    query(`[data-timeline-id="${FROM}"]`, HTMLElement).closest('details')?.removeAttribute('open');
    drawEdges(root, panel);
    assert.equal(paths().length, 0);
  });

  void it('leaves the layer alone while the chart is hidden', () => {
    const { root, panel } = layout([110, 70, 90, 20], [300, 130, 100, 20]);
    drawEdges(root, panel);
    query('[data-timeline-chart]', HTMLElement).hidden = true;
    drawEdges(root, null);
    assert.equal(paths().length, 1);
  });

  void it('does nothing on a timeline without a chart', () => {
    loadPage('<div data-timeline></div>');
    assert.doesNotThrow(() => drawEdges(query('[data-timeline]', HTMLElement), null));
  });
});
