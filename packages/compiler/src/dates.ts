/**
 * Lexical check for YYYY-MM-DD before validating the day against its calendar month.
 */
export const DAY_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$(?!\s)/u;

/**
 * Lexical check for a calendar day, month, or quarter target.
 */
export const TARGET_PATTERN =
  /^\d{4}-(?:Q[1-4]|(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)$(?!\s)/u;

/**
 * Calendar months in a quarter-sized planning window.
 */
const MONTHS_PER_QUARTER = 3;

/**
 * Designator used in a year-quarter target.
 */
const QUARTER_MARKER = 'Q';

/**
 * Length of an exact day in the canonical date syntax.
 */
const DAY_LENGTH = 10;

/**
 * Character count of the YYYY-MM prefix in a day string.
 */
const ISO_YEAR_MONTH_LENGTH = 7;

/**
 * Inclusive day bounds of a valid target, used to compare mixed-precision schedules.
 */
export type DateRange = {
  /**
   * First included calendar day of the planning window.
   */
  first: string;

  /**
   * Last included calendar day of the planning window.
   */
  last: string;
};

/**
 * Parses a day, month or quarter into its inclusive UTC calendar bounds.
 *
 * @param value A target in YYYY-MM-DD, YYYY-MM or YYYY-Qn form.
 * @returns Canonical day bounds, or undefined for invalid dates, including year zero.
 */
export function dateRange(value: string): DateRange | undefined {
  if (!TARGET_PATTERN.test(value) || value.startsWith('0000')) {
    return undefined;
  }

  if (value.length === DAY_LENGTH) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, DAY_LENGTH) !== value) {
      return undefined;
    }

    return { first: value, last: value };
  }

  const [year = '', period = ''] = value.split('-');
  if (period.startsWith(QUARTER_MARKER)) {
    const end = Number(period.slice(1)) * MONTHS_PER_QUARTER;
    return { first: firstDay(year, end - MONTHS_PER_QUARTER + 1), last: lastDay(year, end) };
  }

  return { first: `${value}-01`, last: lastDay(year, Number(period)) };
}

/**
 * Formats the first day of the selected month.
 */
function firstDay(year: string, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Computes the last calendar day of the selected month.
 */
function lastDay(year: string, month: number): string {
  const date = new Date(firstDay(year, month));
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return `${firstDay(year, month).slice(0, ISO_YEAR_MONTH_LENGTH)}-${date.getUTCDate()}`;
}
