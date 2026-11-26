import { compile } from '@roadmark/compiler/compile';
import { ATLAS_DIRECTORY } from '@roadmark/test-fixtures';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderSite } from './render.ts';
import {
  done,
  entity,
  fixture,
  pageText,
  profilesFixture,
  rowTitles,
  spare,
  tabs,
  TEAM_BASE,
} from './test-support.test.ts';

/**
 * The deployment prefix every whole-site check renders under.
 */
const BASE = TEAM_BASE;

void describe('renderSite', () => {
  void it('publishes linked routes and local fonts beneath a deployment prefix', async () => {
    const files = await renderSite(fixture, BASE);
    const overview = files.get('items/index.html');
    assert.ok(typeof overview === 'string');
    assert.match(overview, /<h1>Items<\/h1>/);
    assert.match(overview, /<title>Items · Publication &amp; planning<\/title>/);
    const home = pageText(files, 'index.html');
    assert.match(home, /<title>Releases · Publication &amp; planning<\/title>/);
    assert.match(home, new RegExp(`href="${BASE}"\\s+aria-current="page"\\s*><span>Releases<`));
    assert.match(overview, /Release &lt;Beta&gt;/);
    assert.match(home, /Distinguishable release outcome/);
    assert.ok(home.includes(`href="${BASE}releases/unassigned/"`));
    const moved = pageText(files, 'releases/index.html');
    assert.match(moved, new RegExp(`<meta http-equiv="refresh" content="0; url=${BASE}"`));
    assert.match(moved, new RegExp(`<a href="${BASE}">`));
    assert.ok(overview.includes(`href="${BASE}assets/site.css"`));
    assert.ok(overview.includes('data-index="'));
    assert.ok(files.get('assets/geist-latin.woff2') instanceof Uint8Array);
  });

  void it('publishes grouped items and a separate index covering empty feature sets', async () => {
    const set = entity({ kind: 'set', id: 'publishing', title: 'Publishing' });
    const unused = entity({ kind: 'set', id: 'research', title: 'Research' });
    const files = await renderSite(
      { ...fixture, entities: [set, unused, { ...done, set: set.id }, spare] },
      BASE,
    );
    const overview = pageText(files, 'items/index.html');
    assert.match(overview, /aria-labelledby="queue-set-publishing"/);
    assert.match(overview, /aria-labelledby="queue-unassigned"/);
    assert.doesNotMatch(overview, /aria-labelledby="queue-set-research"/);
    assert.ok(overview.includes(`href="${BASE}sets/publishing/"`));
    assert.ok(overview.includes(`href="${BASE}items/done/"`));
    const sets = pageText(files, 'sets/index.html');
    assert.ok(sets.includes(`href="${BASE}sets/research/"`));
    assert.match(sets, /0 items/);
    assert.ok(pageText(files, 'items/index.html').includes(`href="${BASE}items/done/"`));
    assert.match(overview, /TEST-8/);
  });

  void it('distinguishes a release named unassigned from work without a release', async () => {
    const files = await renderSite(fixture, BASE);
    const overview = files.get('items/index.html');
    assert.ok(typeof overview === 'string');
    assert.match(pageText(files, 'index.html'), /\?release=~unassigned&amp;type=item#browse/);
    assert.match(overview, /<ui-select-item value="unassigned" label="Release &lt;Beta&gt;"/);
    assert.match(overview, /<ui-select-item value="~unassigned" label="Unassigned"/);
    assert.match(
      overview,
      /data-filter-entry="spare"\s+data-type="item"[^>]*data-release="~unassigned"/,
    );
    assert.match(
      overview,
      /data-filter-entry="done"\s+data-type="item"[^>]*data-release="unassigned"/,
    );
  });

  void it('uses stable IDs to distinguish homonyms in the directory and search', async () => {
    const model = profilesFixture();
    const files = await renderSite(model, BASE);
    const directory = pageText(files, 'people/index.html');
    assert.ok(directory.includes(`href="${BASE}people/" aria-current="page"`));
    assert.ok(directory.includes(`href="${BASE}people/alex/"`));
    assert.ok(directory.includes(`href="${BASE}people/alex-ops/"`));
    assert.equal(directory.match(/aria-describedby="person-context-alex(?:-ops)?"/g)?.length, 2);
    assert.match(directory, /<code>alex<\/code>/);
    assert.match(directory, /<code>alex-ops<\/code>/);
    const index = pageText(files, 'search-index.json');
    assert.ok(index.includes(`"href":"${BASE}people/alex-ops/","title":"Alex Reed"`));
    assert.match(index, /"kind":"Person","type":"person"/);

    model.workspace.people['alex'] = 'Alex Renamed';
    const renamed = await renderSite(model, BASE);
    assert.match(pageText(renamed, 'people/alex/index.html'), /<h1>Alex Renamed<\/h1>/);
  });

  void it('shows only direct assignments per person, with all roles and planning context', async () => {
    const files = await renderSite(profilesFixture(), BASE);
    const pm = pageText(files, 'people/alex/index.html');
    assert.equal(pm.match(/>Publish updates<\/a>/g)?.length, 1);
    assert.match(pm, /Product manager \(from feature set\)<\/span>/);
    assert.match(pm, /Contributor<\/span>/);
    assert.match(pm, /<h2>Owned feature sets<\/h2>/);
    assert.ok(pm.includes(`href="${BASE}teams/design/"`));
    assert.ok(pm.includes(`href="${BASE}releases/unassigned/"`));
    assert.doesNotMatch(pm, /Former roadmap item|Get a design review/);

    const explicit = pageText(files, 'people/alex-ops/index.html');
    assert.match(explicit, /Former roadmap item/);
    assert.match(explicit, /Product manager<\/span>/);
    assert.match(explicit, /Write release copy/);
    assert.match(explicit, /Contributor<\/span>/);
    assert.doesNotMatch(explicit, /Publish updates|from feature set/);
    const empty = pageText(files, 'people/taylor/index.html');
    assert.match(empty, /No roadmap items assigned to this person\./);
    assert.ok(empty.includes(`href="${BASE}teams/design/"`));

    const item = pageText(files, 'items/done/index.html');
    const profileLink = `href="${BASE}people/alex/"`;
    assert.equal(item.split(profileLink).length - 1, 2);
    assert.match(item, /From feature set/);
  });

  void it('shows the release scope with cross-release prerequisites, and set items on their own tab', async () => {
    const atlas = ATLAS_DIRECTORY;
    const model = await compile(atlas, BASE);
    assert.deepEqual(model.diagnostics, []);
    const files = await renderSite(model, BASE);
    const releasePage = files.get('releases/rel-spring/index.html');
    assert.ok(typeof releasePage === 'string');
    const scope = releasePage.indexOf('<h2>Release scope</h2>');
    const set = releasePage.indexOf('>Customer onboarding</a></h3>', scope);
    const prerequisites = releasePage.indexOf('<h2>Cross-release prerequisites</h2>', set);
    assert.ok(scope >= 0 && set > scope && prerequisites > set);
    assert.doesNotMatch(releasePage, /team request|Milestone/i);
    assert.match(releasePage.slice(prerequisites), /checklist reads completion events/);
    assert.ok(releasePage.slice(prerequisites).includes(`href="${BASE}releases/rel-foundation/"`));
    assert.ok(releasePage.slice(prerequisites).includes(`href="${BASE}teams/platform/"`));

    const overview = pageText(files, 'sets/set-onboarding/index.html');
    const items = pageText(files, 'sets/set-onboarding/items/index.html');
    assert.deepEqual(tabs(overview), [
      `Overview:${BASE}sets/set-onboarding/:current`,
      `Items:${BASE}sets/set-onboarding/items/:`,
    ]);
    assert.deepEqual(tabs(items), [
      `Overview:${BASE}sets/set-onboarding/:`,
      `Items:${BASE}sets/set-onboarding/items/:current`,
    ]);
    assert.doesNotMatch(overview, />Starter templates<\/a>/);
    assert.doesNotMatch(items, /catalogue-group-row/);
    assert.deepEqual(rowTitles(items), [
      'Connection recovery',
      'Guided workspace setup',
      'Starter templates',
    ]);
    assert.match(items, /<title>Customer onboarding items · /);
  });

  void it('renders index pages as flat lists with status pills and routes old appearance links to Items', async () => {
    const files = await renderSite(fixture, BASE);
    assert.equal(pageText(files, 'themes/index.html'), pageText(files, 'items/index.html'));
    for (const page of ['items/index.html', 'index.html', 'sets/index.html']) {
      const html = pageText(files, page);
      assert.doesNotMatch(html, /data-slot="frame"|data-slot="badge"/, page);
      assert.ok(!html.includes(`href="${BASE}assets/reui.css"`), page);
    }

    assert.match(pageText(files, 'items/index.html'), /class="pill" data-tone="ok"/);
  });

  void it('writes a profile and a timeline per person and team, the mark, and brand styles only for a brand', async () => {
    const files = await renderSite(profilesFixture(), BASE);
    for (const prefix of ['people/alex/', 'people/alex-ops/', 'people/taylor/', 'teams/design/']) {
      assert.ok(files.has(`${prefix}index.html`), prefix);
      assert.match(pageText(files, `${prefix}timeline/index.html`), /data-timeline/, prefix);
    }

    assert.match(
      pageText(files, 'people/alex/timeline/index.html'),
      /<h1>Alex Reed timeline<\/h1>/,
    );
    assert.match(pageText(files, 'assets/mark.svg'), /^<svg /);
    assert.equal(files.has('assets/brand.css'), false);
    assert.ok(files.has('assets/client/boot.js'));
    assert.ok(files.has('sets/set-design/items/index.html'));

    const branded = await renderSite(
      {
        ...fixture,
        brand: { config: { schema_version: 1, colors: { accent: '#0055ff' } }, fonts: {} },
      },
      BASE,
    );
    assert.match(pageText(branded, 'assets/brand.css'), /--accent: #0055ff;/);
    assert.ok(pageText(branded, 'index.html').includes(`href="${BASE}assets/brand.css"`));
  });
});
