# Verify a roadmap

## Local checks

Use Node 26 and the pnpm version pinned in package.json. Install dependencies with `pnpm install --frozen-lockfile` and Chromium for the browser suites with `pnpm --filter @roadmark/web exec e2e-web install chromium`. Run `pnpm ready`. Run `pnpm benchmark` separately to measure full builds and warm search (the client's search code ranking the published index, timed in Node) against a generated portfolio of 1,000 items, 50 releases, and 20 teams. It prints the machine, build duration and search-index size.

The Atlas workspace in `packages/test-fixtures/atlas` is the strict-lint fixture. Its release and item pages, cross-document heading link, captions, and GIF poster are checked at a nested deployment prefix. The publish suite compares builds from two independent directories and checks that a failed release move retains the previous site.

## Author pilot

1. Initialize an expendable workspace with `roadmark init pilot --template ai-sandbox` and run `roadmark dev --root pilot`.
2. Open the Public beta release, then **Fork a running sandbox**. Find the outcome, the contributing Developer Experience team, and the earlier release that ships its snapshot prerequisite.
3. Change `release: rel-public-beta` to `release: rel-ga` in `pilot/feature-sets/runtime/items/fork.mdx`. Watch the preview rebuild.
4. In a second terminal in the same working directory, run `roadmark lint --strict --root pilot`. Verify the release pages reflect the move.
5. Run `roadmark build --root pilot --out pilot-site --base /product/roadmap/`, then `roadmark preview --dir pilot-site --port 0`. Preview prints a second address on an available port so you can keep the author preview running. Open `items/item-fork/` beneath the printed URL.

## Reader pilot

On the same computer, give the engineering lead the printed reader preview URL. For a remote pilot, share the built site through your usual static host at `/product/roadmap/`. The local preview binds to loopback. Ask them to identify which release owns sandbox forking, how its outcome will be measured, what Developer Experience contributes, and which item it depends on. Ask them to share a filtered link and find every record linked to RT-58. Repeat timeline navigation using a keyboard and check the list view on a phone.

Record which questions were answered correctly, where someone needed help, and any label or relationship that led them to the wrong answer. Real reader feedback complements the automated browser scenarios.
