---
id: item-log-streaming
title: Live log streaming
description: Stream stdout and stderr of every process in a sandbox over WebSocket to the console, CLI and SDKs.
outcome: Engineers see a sandbox's output in under a second without adding logging to their agent.
status: done
release: rel-public-beta
start: "2026-09-07"
target: "2026-10-16"
contributors: [rafael]
contributing_teams: [runtime]
jira: [OBS-3]
---

## Shipped

The guest agent captures output of every process it starts and tags lines with PID and command. Lines reach the console in 380 ms p95. Logs are kept 7 days on Pro and 30 days on Team, and are deleted with the organisation.

`cloche logs -f sbx_…` and `sbx.logs({ follow: true })` use the same stream.
