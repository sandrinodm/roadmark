---
id: item-sandbox-metrics
title: Per-sandbox metrics
description: CPU, memory, disk and network for every sandbox at 1-second resolution, through the API and console.
outcome: An engineer can tell whether a sandbox is busy, idle or out of memory without opening a shell.
status: in-progress
release: rel-public-beta
start: "2026-10-12"
target: "2026-11-27"
contributors: [rafael]
contributing_teams: [runtime]
jira: [OBS-6]
---

## Status

Collection at 1 s from the host agent works in production. Remaining: the query API (`GET /v1/sandboxes/:id/metrics?since=15m`) and downsampling to 10 s after 24 hours to keep storage at about 2 KB per sandbox-hour.
