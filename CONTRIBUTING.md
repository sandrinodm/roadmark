# Contributing

Thanks for helping improve `roadmark`.

## Setup

You need Node.js 26 and the pnpm version in `packageManager` in the root `package.json`. Corepack or `pnpm/action-setup` picks it up.

```bash
pnpm install
pnpm --filter @roadmark/web exec e2e-web install chromium   # once, for the browser tests
pnpm dev                                                    # the ai-sandbox template with the CLI from source
```

## Layout

| Path                     | What it is                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `apps/cli`               | The published `roadmark` CLI. `pnpm build` bundles the private packages into `apps/cli/lib`. |
| `packages/compiler`      | Reads a workspace, validates it and renders Markdown, MDX, Mermaid and code.                 |
| `packages/web`           | The static site renderer and the browser script, with the browser (`e2e`) tests.             |
| `packages/test-fixtures` | The Atlas workspace used by the tests.                                                       |
| `docs/`                  | Authoring guide, field reference, branding and verification.                                 |

Every source file has a `.test.ts` beside it. `pnpm test` fails when one is missing.

## Before opening a pull request

```bash
pnpm ready          # check, reference check, typecheck, tests, browser tests, build, template build
pnpm test:package   # packs the CLI, installs the tarball in a temporary project and runs it
```

After changing a schema, run `pnpm reference` and commit the regenerated `docs/` files.

## Commits and releases

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`). Breaking changes use `feat!:` or a `BREAKING CHANGE:` footer.

The maintainer cuts releases:

1. A pull request bumps the version in `apps/cli/package.json`.
2. A GitHub release is tagged `v<version>` on a commit that passed CI on `main`.
3. The publish workflow packs the CLI, installs and runs the tarball, then publishes it to npm with trusted publishing and provenance after the maintainer approves the deployment.
