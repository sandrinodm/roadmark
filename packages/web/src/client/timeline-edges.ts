/**
 * SVG namespace for the dependency paths.
 */
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Horizontal run before a path turns towards its dependent bar.
 */
const TURN = 12;

/**
 * Horizontal run into the dependent bar.
 */
const ENTRY = 8;

/**
 * Finds a visible bar in an open lane.
 *
 * @param root Timeline root.
 * @param id Record ID.
 * @returns The bar, or undefined when it is filtered out or its lane is collapsed.
 */
function visibleMark(root: HTMLElement, id: string): HTMLElement | undefined {
  const row = root.querySelector<HTMLElement>(`[data-timeline-id="${CSS.escape(id)}"]`);
  if (!row || row.hidden || !row.closest('details')?.open) {
    return undefined;
  }

  return row.querySelector<HTMLElement>('[data-mark]') ?? undefined;
}

/**
 * Measures a visible bar.
 *
 * @param root Timeline root.
 * @param id Record ID.
 * @returns Its box, or undefined when it is not shown.
 */
function markBox(root: HTMLElement, id: string | undefined): DOMRect | undefined {
  return visibleMark(root, id ?? '')?.getBoundingClientRect();
}

/**
 * Draws the selected record's dependencies as elbow paths from prerequisite to dependent bar,
 * dashed red where the dates conflict.
 *
 * @param root Timeline root.
 * @param panel Selection panel listing the dependencies, if any.
 */
export function drawEdges(root: HTMLElement, panel: Element | null): void {
  const svg = root.querySelector('[data-gantt-edges]');
  const gantt = root.querySelector('[data-gantt]');
  const chart = root.querySelector<HTMLElement>('[data-timeline-chart]');
  if (!svg || !gantt || chart?.hidden) {
    return;
  }

  svg.replaceChildren();
  const bounds = gantt.getBoundingClientRect();
  for (const edge of panel?.querySelectorAll<HTMLElement>('[data-edge-from]') ?? []) {
    const from = markBox(root, edge.dataset['edgeFrom']);
    const to = markBox(root, edge.dataset['edgeTo']);
    if (!from || !to) {
      continue;
    }

    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', elbow(bounds, from, to));
    path.setAttribute(
      'class',
      edge.dataset['conflict'] === 'true' ? 'conflict-path' : 'connection-path',
    );
    svg.append(path);
  }
}

/**
 * Routes an elbow path from the end of one bar to the start of another, with an arrowhead.
 *
 * @param bounds Chart grid box.
 * @param from Prerequisite bar box.
 * @param to Dependent bar box.
 * @returns SVG path data.
 */
function elbow(bounds: DOMRect, from: DOMRect, to: DOMRect): string {
  const x1 = from.right - bounds.left;
  const y1 = from.top + from.height / 2 - bounds.top;
  const x2 = to.left - bounds.left;
  const y2 = to.top + to.height / 2 - bounds.top;
  const turn = Math.max(x1 + TURN, (x1 + x2) / 2);
  const route =
    x2 > x1 + 2 * TURN
      ? `H ${turn} V ${y2} H ${x2}`
      : `H ${turn} V ${(y1 + y2) / 2} H ${x2 - ENTRY} V ${y2} H ${x2}`;
  return `M ${x1} ${y1} ${route} m -5 -3 l 5 3 -5 3`;
}
