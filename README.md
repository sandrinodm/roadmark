# Roadmark

Keep a product roadmap in Git and publish it as a searchable static site. Each feature set has a README and a folder of Markdown or MDX items. An item's frontmatter assigns its release. The site derives release scope, dependency backlinks, person and team profiles, and the timeline from those files.

## Quick start

You need Node.js 26 or later.

```sh
npx roadmark init my-roadmap --template ai-sandbox
cd my-roadmap
npx roadmark lint --strict
npx roadmark dev
```

Open the address printed in the terminal. The `ai-sandbox` template plans the launch of Cloche, a fictional agent sandbox product, across 5 releases, 11 feature sets and 40 items, with screenshots, code samples and Mermaid diagrams. Start from `--template blank` (the default) for a small skeleton: one feature set, two items with a dependency, one release, one person and one team.

`init` also writes an `AGENTS.md` that points coding agents at `roadmark guide` and `roadmark help --json`, which describe the commands, the file format and how to fix lint output.

## Commands

| Command                                              | Use                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `roadmark init [dir] [--template blank\|ai-sandbox]` | Copy a starter into a workspace. Existing files are never overwritten.             |
| `roadmark new set\|item\|release <slug>`             | Create one document. Use `--set` and optionally `--release` for an item.           |
| `roadmark lint [--strict] [--json]`                  | Resolve the entire workspace and report errors and warnings with source locations. |
| `roadmark dev`                                       | Watch the roadmap and serve the latest successful build with live diagnostics.     |
| `roadmark build --out dist --base /product/roadmap/` | Compile pages, media and search data for a static host.                            |
| `roadmark preview --dir dist`                        | Serve the published directory at its configured base path.                         |
| `roadmark schema item`                               | Print the editor schema for an entity.                                             |
| `roadmark guide`                                     | Print the authoring guide: layout, frontmatter, IDs, dependencies and lint output. |
| `roadmark help --json`                               | Print every command, flag, template and the guide as one JSON document.            |

The new-set template picks the first configured PM and engineering team in ID order. A new release starts with today’s UTC date as its target. Review those fields when writing the brief.

Set `--root` to read a workspace outside the current directory. Output paths are relative to the working directory. Lint and build return 1 for content failures and 2 for invocation or filesystem errors. Strict mode also fails on warnings.

## Publish

```sh
roadmark lint --strict
roadmark build --base /product/roadmap/ --out dist
roadmark preview --dir dist
```

Upload the contents of `dist/` to the same prefix on a host that serves directory indexes. The site contains its own HTML, styles, scripts, fonts, search index and referenced media. Pages read fine without JavaScript; search and filters load as module scripts, which browsers only run over HTTP, so open the site through a server rather than from `file://`. Choose the host's access settings for your intended readers. Editing and approvals happen in Git. Jira keys link to the configured Jira instance.

Manage names and membership in `people.yaml` and `teams.yaml`. The site opens on **Releases**: one table of releases grouped by the quarter or month they land in (a shipped release under its ship month, undated releases last), with a search field and status filter. The header links to **Releases**, **Feature sets**, **Items**, **Timeline**, **People** and **Teams**; on narrow screens they sit behind the menu button. Press `/` or ⌘K on any page to search titles, people, teams and Jira keys; on **Items**, `/` focuses the item search. Open **Items** to browse work grouped by feature set or search by title, topic, or Jira key. **Feature sets** lists product areas; each set has an **Overview** tab with its description and facts and an **Items** tab with its work sorted by target. Each record page keeps its status, dates, owners and links in a facts rail beside the brief; open a person or team from there to see their assigned work. Narrow any list with the filter chips (status, release, feature set, team or involvement), then switch to the profile’s timeline or share its URL. The optional `brand.yaml` ([example](apps/cli/templates/ai-sandbox/brand.yaml)) sets typefaces, tracking, line height, colors, the workspace logo and the page background.

[Authoring guide](docs/authoring.md) · [Branding guide](docs/branding.md) · [Field reference and JSON Schemas](docs/reference.md) · [Verification and pilot](docs/verification.md)

## Develop

This repository is a pnpm workspace. Only `roadmark` is published; the other packages are private and consumed from their TypeScript sources.

| Path                     | Package                   | Contents                                                                                                 |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/cli`               | `roadmark`                | The CLI: commands, dev and preview servers, publishing, the starter templates and the package build.     |
| `packages/compiler`      | `@roadmark/compiler`      | Reads, validates and compiles a workspace: schemas, frontmatter, MDX, Mermaid, Shiki and diagnostics.    |
| `packages/web`           | `@roadmark/web`           | Renders the compiled model to HTML, styles and the browser enhancement bundle; holds the browser suites. |
| `packages/test-fixtures` | `@roadmark/test-fixtures` | The Atlas workspace shared by the unit and browser tests.                                                |

Run `pnpm check` for Vite+ formatting, type-aware lint and multiline JSDoc coverage. The CLI composes Effect commands with a workspace service and scoped server cleanup. The compiler uses Effect Schema for YAML and frontmatter.

Run `pnpm install` and `pnpm dev` to work on the ai-sandbox template with the CLI from source, and `pnpm roadmark --help` for any other command. Run `pnpm --filter @roadmark/web exec e2e-web install chromium` once before running the browser suites, which use the [e2e](https://e2e.com) test framework: `pnpm test:e2e` builds Atlas with the CLI, serves it with `roadmark preview` and runs `packages/web/e2e/*.e2e.ts` (reports and traces land in `packages/web/.e2e/`). `pnpm ready` checks types, exercises the compiler and browser, builds the distributable CLI, and publishes the ai-sandbox template. `pnpm build` compiles the CLI, compiler and renderer into `apps/cli/lib`, so the published package depends on none of the private packages, and `pnpm test:package` installs the packed tarball and drives it. `pnpm benchmark` measures a 1,000-item workspace. Use `pnpm reference` after changing the schema.

## License

[MIT](LICENSE)
