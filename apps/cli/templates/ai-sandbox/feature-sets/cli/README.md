---
id: set-cli
title: CLI
description: The cloche command for humans at a terminal and for CI jobs.
outcome: A developer goes from install to a running sandbox in under two minutes, and CI pipelines script Cloche without parsing human output.
pm: priya
engineering_team: devex
links:
  - label: CLI command spec
    url: https://docs.cloche.example/internal/cli-spec
---

## Principles

- Every command has `--json` output with a documented, versioned schema. Human output may change; JSON output follows the 12-month deprecation policy.
- Exit codes mean something: `0` success, `2` invalid usage, `3` authentication, `4` quota, `5` Cloche-side error. `exec` is the exception: it returns the exit code of the command inside the sandbox and reserves `125` to `127` for its own failures, as described in [CLI 1.0](items/cli-1-0.mdx). CI scripts branch on them.
- No interactive prompts unless stdin is a TTY.

## Distribution

Single static Go binary for macOS (arm64, x64), Linux (arm64, x64) and Windows (x64). Installed through Homebrew, a `curl | sh` script that verifies the checksum, and as a release asset with a Sigstore signature.
