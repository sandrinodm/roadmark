---
id: item-cli-core
title: CLI for the private alpha
description: create, exec, snapshot, ls and rm against the internal alpha API.
outcome: Design partners can drive sandboxes from a terminal on day one of the alpha.
status: done
release: rel-private-alpha
start: "2026-06-15"
target: "2026-08-07"
contributors: [jonah]
jira: [CLI-3]
---

## Shipped

Five commands, human output only, distributed as a binary in a private bucket. It did its job: 37 of 41 partners used the CLI before they touched an SDK.

## What we are not keeping

Positional flags in `create`, a table output that changed column widths between versions, and exit code `1` for every kind of failure. [CLI 1.0](cli-1-0.mdx) replaces all three.
