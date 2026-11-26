import type { PreparedEntry } from '@roadmark/web/client/search-rank';

import { matchesFilters } from '@roadmark/web/client/palette-filters';
import { prepareEntry, rank } from '@roadmark/web/client/search-rank';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { publish } from '../src/publish.ts';
import { preview } from '../src/server.ts';

/**
 * Number of synthetic deliverables published in the portfolio benchmark.
 */
const ITEMS = 1000;

/**
 * Size of the benchmark release directory.
 */
const RELEASES = 50;

/**
 * Number of team and feature-set groups in the benchmark.
 */
const TEAMS = 20;

/**
 * Maximum wall time allowed for a complete cold site build.
 */
const BUILD_BUDGET_MS = 10_000;

/**
 * Longest a warm search may take to rank the index for one query.
 */
const SEARCH_BUDGET_MS = 150;

/**
 * Filesystem root used to resolve workspace-relative paths.
 */
const root = await mkdtemp(path.join(os.tmpdir(), 'roadmap-benchmark-'));
try {
  const teams = Array.from({ length: TEAMS }, (_, i) => '  team-' + i + ': Engineering team ' + i);
  await writeFile(
    path.join(root, 'roadmap.yaml'),
    [
      'schema_version: 1',
      'title: Portfolio',
      'people: {pm: Product manager}',
      'teams:',
      ...teams,
    ].join('\n'),
  );
  await mkdir(path.join(root, 'releases'));
  for (let i = 0; i < RELEASES; i++) {
    await writeDocument('releases/r-' + i + '.md', [
      'id: rel-' + i,
      'title: Release ' + i,
      'description: This release groups work across teams.',
      'outcome: Reduce setup time.',
      'status: planned',
      'target: "2027-Q3"',
    ]);
  }

  for (let i = 0; i < TEAMS; i++) {
    const folder = 'feature-sets/set-' + i;
    await mkdir(path.join(root, folder, 'items'), { recursive: true });
    await writeDocument(folder + '/README.md', [
      'id: set-' + i,
      'title: Area ' + i,
      'description: Product area.',
      'outcome: Reduce repeated work.',
      'pm: pm',
      'engineering_team: team-' + i,
    ]);
  }

  for (let i = 0; i < ITEMS; i++) {
    const group = i % TEAMS;
    await writeDocument('feature-sets/set-' + group + '/items/' + i + '.md', [
      'id: item-' + i,
      'title: Delivery item ' + i,
      'description: Deliver the next improvement for customers.',
      'outcome: Customers can complete setup.',
      'status: planned',
      'release: rel-' + (i % RELEASES),
      'target: "2027-08"',
      'jira: [ROAD-' + (i + 1) + ']',
    ]);
  }

  const output = path.join(root, 'out');
  const start = performance.now();
  const model = await publish(root, output, '/roadmap/', true);
  const elapsed = performance.now() - start;
  assert.deepEqual(model.diagnostics, []);
  const index = (await readdir(output, { recursive: true })).find(
    (name) => name.endsWith('.json') && name.includes('search'),
  );
  assert.ok(index, 'Expected a generated search index.');
  const raw = await readFile(path.join(output, index));
  console.log(
    `${ITEMS} items, ${RELEASES} releases, ${TEAMS} teams | build ${(elapsed / 1000).toFixed(2)}s | index ${raw.length} bytes (${gzipSync(raw).length} gzip) | ${os.platform()} ${os.arch()} ${os.cpus()[0]?.model}, Node ${process.version}`,
  );
  const server = await preview(output, 0);
  try {
    // The Items search loads the index the way the page does, then answers every query from it.
    const prepared = await loadIndex(server.url + index.split(path.sep).join('/'));
    // The first search after loading warms the code, as the default Items search did in the page.
    for (const mode of ['table', 'list'] as const) {
      const [found] = search(prepared, mode, 'ROAD-1000');
      assert.equal(found?.entry.title, 'Delivery item 999');
    }

    const timings = [...timeSearches(prepared, 'table'), ...timeSearches(prepared, 'list')];
    const slowest = Math.max(...timings);
    console.log(
      'Warm search, query to ranked results: ' +
        slowest.toFixed(1) +
        ' ms maximum over ' +
        timings.length +
        ' queries (item table and all-records list).',
    );
    assert.ok(slowest < SEARCH_BUDGET_MS, `Warm search exceeded ${SEARCH_BUDGET_MS} ms.`);
  } finally {
    await server.close();
  }

  assert.ok(
    elapsed < BUILD_BUDGET_MS,
    'The full site build exceeded the 10 second benchmark budget.',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

/**
 * Writes a benchmark brief with a realistic searchable body and the supplied frontmatter.
 */
async function writeDocument(name: string, fields: Array<string>): Promise<void> {
  await writeFile(
    path.join(root, name),
    [
      '---',
      ...fields,
      '---',
      '',
      '## Delivery notes',
      '',
      'Validate setup with a workspace administrator and record the result in the release brief. '.repeat(
        45,
      ),
      '',
      'The acceptance criteria include recovery after a failed connection.',
    ].join('\n'),
  );
}

/**
 * Fetches the published search index from the preview server and prepares it, as the Items search
 * does on first use (`load` in `packages/web/src/client/item-search.ts`).
 */
async function loadIndex(url: string): Promise<Array<PreparedEntry>> {
  const response = await fetch(url);
  assert.ok(response.ok, `Search index unavailable at ${url}.`);
  const entries: unknown = await response.json();
  assert.ok(Array.isArray(entries), 'Search index has an unexpected shape.');
  return entries.map(prepareEntry);
}

/**
 * Answers one query as the Items search does (`searchItems` in
 * `packages/web/src/client/item-search.ts`): keep the records that pass the URL's filters, then
 * rank them. `table` is the default Items search (items only, narrowing the table); `list` is "All
 * records" (every type, listed as results).
 */
function search(prepared: ReadonlyArray<PreparedEntry>, mode: 'table' | 'list', query: string) {
  const params = new URLSearchParams({ q: query, type: mode === 'table' ? 'item' : 'all' });
  return rank(
    prepared.filter(({ entry }) => matchesFilters(entry, params)),
    query,
  );
}

/**
 * Times each benchmark query from the text to the ranked results the page renders, and checks the
 * page would show the expected record: the only matching item row (`table`) or the first listed
 * result (`list`). This is the client's search code itself, run in Node against the published
 * index; the browser's DOM update after it is not part of the measurement.
 */
function timeSearches(
  prepared: ReadonlyArray<PreparedEntry>,
  mode: 'table' | 'list',
): Array<number> {
  const samples: Array<number> = [];
  const queries = [104, 230, 351, 414, 525, 660, 711, 802, 973, 129].map((key) => ({
    input: 'ROAD-' + key,
    expected: 'Delivery item ' + (key - 1),
  }));
  // A body word plus a key: only one record has both.
  queries.push({ input: 'acceptance ROAD-512', expected: 'Delivery item 511' });
  for (const query of queries) {
    const begin = performance.now();
    const results = search(prepared, mode, query.input);
    samples.push(performance.now() - begin);
    if (mode === 'table') {
      assert.deepEqual(
        results.map(({ entry }) => entry.title),
        [query.expected],
        `The item table should show only ${query.expected} for ${query.input}.`,
      );
    } else {
      assert.equal(results[0]?.entry.title, query.expected, `First result for ${query.input}.`);
    }
  }

  return samples;
}
