---
id: rel-private-alpha
title: Private alpha
description: Invite-only microVM sandboxes with create, exec and snapshot from the CLI.
outcome: Forty design partners run agent workloads on Cloche and tell us which primitives are missing.
status: shipped
start: "2026-05-04"
target: "2026-08"
shipped_on: "2026-08-19"
---

## What shipped

- One region (`iad`), one template family (`python-3.12`, `node-22`, `ubuntu-24.04`).
- `cloche create`, `exec`, `snapshot` and `rm` in the CLI, backed by an unversioned internal API.
- Memory and disk snapshots, restored into a new sandbox. No forking of a running sandbox yet.

## What we learned

| Signal | Result |
| --- | --- |
| Design partners onboarded | 41 of 45 invited |
| Sandboxes created | 612,000 |
| Cold start from the warm pool | p50 210 ms, p95 640 ms |
| Snapshot restore (4 GiB) | p50 380 ms |
| Top request | Fork a running sandbox to try several agent plans in parallel (29 partners) |
| Top complaint | No way to restrict outbound network traffic (17 partners) |

Both of those became the core of the public beta.
