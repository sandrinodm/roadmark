/**
 * Requires labels for the supported lifecycle statuses while allowing string lookups.
 */
type StatusLabelRegistry = Record<
  'proposed' | 'planned' | 'in-progress' | 'done' | 'shipped' | 'cancelled',
  string
> &
  Record<string, string>;

/**
 * Labels shared by status pills, filters and the search palette.
 */
export const STATUS_LABELS: StatusLabelRegistry = {
  /**
   * Labels an item under consideration.
   */
  proposed: 'Proposed',

  /**
   * Labels work scheduled to happen.
   */
  planned: 'Planned',

  /**
   * Labels work under way.
   */
  'in-progress': 'In progress',

  /**
   * Labels completed items.
   */
  done: 'Done',

  /**
   * Labels a delivered release.
   */
  shipped: 'Shipped',

  /**
   * Labels work withdrawn from the roadmap.
   */
  cancelled: 'Cancelled',
};

/**
 * Semantic colour family of a status pill. `progress` is its own hue so it never looks like a link.
 */
export type StatusTone = 'ok' | 'progress' | 'warn' | 'neutral' | 'quiet';

/**
 * Tone per status: finished work is `ok`, active work `progress`, planned and proposed work is
 * neutral and withdrawn work is quiet.
 */
const STATUS_TONES = new Map<string, StatusTone>([
  ['done', 'ok'],
  ['shipped', 'ok'],
  ['in-progress', 'progress'],
  ['cancelled', 'quiet'],
]);

/**
 * Picks the colour family for a status.
 *
 * @param status Canonical status value.
 * @returns The pill tone, neutral for planned, proposed and unknown statuses.
 */
export function statusTone(status: string): StatusTone {
  return STATUS_TONES.get(status) ?? 'neutral';
}

/**
 * Formats a status for display, falling back to a readable form of unknown values.
 *
 * @param status Canonical status value.
 * @returns Visible label.
 */
export function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replaceAll('-', ' ')
  );
}
