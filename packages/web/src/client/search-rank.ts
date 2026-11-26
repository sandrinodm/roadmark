/**
 * One record in `search-index.json`, as written by `searchIndex` in `browse.ts`.
 */
export type SearchEntry = {
  /**
   * Visible kind label, such as "Item" or "Release".
   */
  kind: string;

  /**
   * Filterable record type: item, release, set, team or person.
   */
  type: string;

  /**
   * Canonical status, empty for people and teams.
   */
  status: string;

  /**
   * Release IDs, including `~unassigned` for work without one.
   */
  release: ReadonlyArray<string>;

  /**
   * Feature set IDs.
   */
  set: ReadonlyArray<string>;

  /**
   * Team IDs.
   */
  teams: ReadonlyArray<string>;

  /**
   * Deployment-relative link to the record.
   */
  href: string;

  /**
   * Display title.
   */
  title: string;

  /**
   * One-line summary.
   */
  description: string;

  /**
   * Authored outcome, used as the result snippet.
   */
  outcome?: string;

  /**
   * Formatted target date.
   */
  target?: string;

  /**
   * Stable record ID.
   */
  id: string;

  /**
   * Linked Jira keys.
   */
  jira: ReadonlyArray<string>;

  /**
   * Body text, links and involvement, searched last.
   */
  text: string;

  /**
   * Team and people names involved in the record, matched but never quoted as a snippet.
   */
  involvement?: string;

  /**
   * Portrait or initials for people.
   */
  avatar?: { initials: string; src?: string };
};

/**
 * A run of display text, marked when it matched the search.
 */
export type Segment = {
  /**
   * Original text of this run.
   */
  text: string;

  /**
   * Whether the run matched a search term.
   */
  match: boolean;
};

/**
 * One ranked result with the text to show.
 */
export type RankedResult = {
  /**
   * Indexed record.
   */
  entry: SearchEntry;

  /**
   * Higher ranks first.
   */
  score: number;

  /**
   * Title split into matched and unmatched runs.
   */
  title: Array<Segment>;

  /**
   * The outcome, or the one-line summary when there is none. Never body text: a body match only
   * raises the rank.
   */
  snippet: Array<Segment>;

  /**
   * Jira keys, space-separated, with matches marked.
   */
  keys: Array<Segment>;
};

/**
 * A searchable field with its weight and normalized text.
 */
type Field = {
  /**
   * Original text with runs of whitespace collapsed.
   */
  text: string;

  /**
   * Lowercase text without diacritics, used for matching.
   */
  normalized: string;

  /**
   * Score a term earns by matching this field.
   */
  weight: number;
};

/**
 * Index record prepared once for repeated searches.
 */
export type PreparedEntry = {
  /**
   * Indexed record.
   */
  entry: SearchEntry;

  /**
   * Normalized ID followed by the normalized Jira keys.
   */
  keys: Array<string>;

  /**
   * Normalized title.
   */
  title: string;

  /**
   * Weighted fields in matching order.
   */
  fields: Array<Field>;
};

/**
 * Scores per kind of match. Identifier and title prefixes outrank anything found in the body, so
 * typing the start of a Jira key lists the work carrying that key first.
 */
const SCORE = {
  /**
   * The whole query equals an ID or Jira key.
   */
  exactKey: 10_000,

  /**
   * A term starts a Jira key.
   */
  jiraPrefix: 600,

  /**
   * A term starts a record ID.
   */
  idPrefix: 450,

  /**
   * A term starts a word of the title.
   */
  titlePrefix: 300,

  /**
   * A term appears inside the title.
   */
  title: 100,

  /**
   * A term appears in the summary.
   */
  description: 40,

  /**
   * A term appears in the outcome.
   */
  outcome: 20,

  /**
   * A term appears in the body, links, people or teams.
   */
  body: 5,

  /**
   * No terms: every record that passes the filters.
   */
  filterOnly: 1,
} as const;

/**
 * Lowest score of a match on a title word, an ID or a Jira key: results at or above it are headline
 * matches and are listed before anything found only in the summary or body.
 */
export const HEADLINE_SCORE = SCORE.titlePrefix;

/**
 * Removes combining marks after canonical decomposition.
 */
const DIACRITICS = /\p{Diacritic}/gu;

/**
 * Collapses whitespace in indexed text.
 */
const SPACE = /\s+/g;

/**
 * Lowercases text and removes diacritics so "Resume" finds "Résumé".
 *
 * @param value Text to normalize.
 * @returns Comparable text.
 */
export function normalize(value: string): string {
  return value.normalize('NFKD').replaceAll(DIACRITICS, '').toLowerCase();
}

/**
 * Splits a query into normalized terms.
 *
 * @param query Raw search text.
 * @returns Terms.
 */
export function queryTerms(query: string): Array<string> {
  return normalize(query).split(SPACE).filter(Boolean);
}

/**
 * Normalizes an index record's fields once.
 *
 * @param entry Indexed record.
 * @returns Record ready for ranking.
 */
export function prepareEntry(entry: SearchEntry): PreparedEntry {
  const keys = [entry.id, ...entry.jira].filter(Boolean);
  return {
    entry,
    keys: [entry.id, ...entry.jira].map(normalize),
    title: normalize(entry.title),
    fields: [
      makeField(entry.title, SCORE.title),
      makeField(entry.description, SCORE.description),
      makeField(entry.outcome ?? '', SCORE.outcome),
      makeField(entry.text, SCORE.body),
      makeField([...keys, entry.kind, entry.involvement ?? ''].join(' '), SCORE.body),
    ],
  };
}

/**
 * Prepares one searchable field.
 *
 * @param text Original text.
 * @param weight Score a term earns here.
 * @returns Normalized field.
 */
function makeField(text: string, weight: number): Field {
  const collapsed = text.replaceAll(SPACE, ' ');
  return { text: collapsed, normalized: normalize(collapsed), weight };
}

/**
 * Wraps text as one unmarked run.
 *
 * @param text Display text.
 * @returns A single run.
 */
function plain(text: string): Array<Segment> {
  return [{ text, match: false }];
}

/**
 * Scores one term against a record's identifiers and title.
 *
 * @param prepared Normalized record.
 * @param term Normalized term.
 * @returns The identifier or title score, or zero.
 */
function headlineScore(prepared: PreparedEntry, term: string): number {
  const [id = '', ...jira] = prepared.keys;
  if (jira.some((key) => key.startsWith(term))) {
    return SCORE.jiraPrefix;
  }

  if (id.startsWith(term)) {
    return SCORE.idPrefix;
  }

  const startsWord = prepared.title.startsWith(term) || prepared.title.includes(' ' + term);
  return startsWord ? SCORE.titlePrefix : 0;
}

/**
 * Ranks one record for a query. Every term must match somewhere.
 *
 * @param prepared Normalized record.
 * @param terms Normalized terms.
 * @param query Whole normalized query, for exact identifier matches.
 * @returns The ranked result, or undefined when the record does not match.
 */
export function rankEntry(
  prepared: PreparedEntry,
  terms: ReadonlyArray<string>,
  query: string,
): RankedResult | undefined {
  const { entry } = prepared;
  const summary = entry.outcome?.trim() || entry.description;
  if (terms.length === 0) {
    const keys = plain(entry.jira.join(' '));
    return {
      entry,
      score: SCORE.filterOnly,
      title: plain(entry.title),
      snippet: plain(summary),
      keys,
    };
  }

  let score = prepared.keys.includes(query) ? SCORE.exactKey : 0;
  for (const term of terms) {
    const matched = prepared.fields.find((candidate) => candidate.normalized.includes(term));
    if (!matched) {
      return undefined;
    }

    score += Math.max(matched.weight, headlineScore(prepared, term));
  }

  return {
    entry,
    score,
    title: highlight(entry.title, terms),
    snippet: highlight(summary, terms),
    keys: highlight(entry.jira.join(' '), terms),
  };
}

/**
 * Ranks the whole index, best first, ties by title.
 *
 * @param index Prepared records that passed the active filters.
 * @param query Raw search text.
 * @returns Matching results in display order.
 */
export function rank(index: ReadonlyArray<PreparedEntry>, query: string): Array<RankedResult> {
  const terms = queryTerms(query);
  const whole = normalize(query.trim());
  return index
    .flatMap((prepared) => rankEntry(prepared, terms, whole) ?? [])
    .toSorted((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
}

/**
 * Splits text into runs, marking every occurrence of every term.
 *
 * @param text Original text.
 * @param terms Normalized terms.
 * @returns Runs that join back to `text`.
 */
export function highlight(text: string, terms: ReadonlyArray<string>): Array<Segment> {
  const normalized = normalize(text);
  const spans = sourceSpans(text);
  const marked = Array.from({ length: text.length }, () => false);
  for (const term of terms.filter(Boolean)) {
    for (let at = normalized.indexOf(term); at >= 0; at = normalized.indexOf(term, at + 1)) {
      const first = spans[at];
      const last = spans[at + term.length - 1];
      if (first && last) {
        marked.fill(true, first.start, last.end);
      }
    }
  }

  const segments: Array<Segment> = [];
  let position = 0;
  for (const character of text) {
    const match = marked[position] ?? false;
    const previous = segments.at(-1);
    if (previous?.match === match) {
      previous.text += character;
    } else {
      segments.push({ text: character, match });
    }

    position += character.length;
  }

  return segments;
}

/**
 * Maps each offset in the normalized text to the original character it came from. Normalizing can
 * change length (Hangul syllables decompose into jamo, "ﬃ" expands to "ffi"), so a match that ends
 * inside an expanded character still covers that whole character.
 *
 * @param text Original text.
 * @returns Start and end offsets in the original text, indexed by normalized offset.
 */
function sourceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let source = 0;
  for (const character of text) {
    const span = { start: source, end: source + character.length };
    const length = normalize(character).length;
    // A combining mark normalizes to nothing; it belongs to the character before it.
    const previous = spans.at(-1);
    if (length === 0 && previous) {
      previous.end = span.end;
    }

    for (let index = 0; index < length; index += 1) {
      spans.push(span);
    }

    source += character.length;
  }

  return spans;
}
