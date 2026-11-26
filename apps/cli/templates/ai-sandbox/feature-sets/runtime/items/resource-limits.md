---
id: item-resource-limits
title: Resource limits and concurrency quotas
description: Enforce per-sandbox CPU, memory, disk and process limits, and per-organisation concurrency.
outcome: One runaway agent cannot starve a host or run up an unbounded bill.
status: done
release: rel-public-beta
start: "2026-08-24"
target: "2026-09-11"
contributors: [lukas]
contributing_teams: [platform]
jira: [RT-49]
---

## Limits

| Limit | Default | Maximum | Enforced by |
| --- | --- | --- | --- |
| vCPU | 2 | 16 | VM config, CPU quota |
| Memory | 4 GiB | 32 GiB | VM config, balloon disabled |
| Root disk | 20 GiB | 200 GiB | Block device size |
| Processes | 4,096 | 32,768 | Guest cgroup |
| Session length | 30 min idle | Plan-dependent | Control plane |
| Concurrent sandboxes | Plan-dependent | 500 (Team) | Admission in the API |

A request over the concurrency quota fails fast with `429` and `error.code = "concurrency_limit"`, rather than queueing. Agents retry with backoff; queueing hid problems during the alpha.
