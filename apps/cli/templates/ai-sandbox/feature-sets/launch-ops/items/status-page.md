---
id: item-status-page
title: Public status page and SLOs
description: A public status page per component, backed by synthetic checks, with published SLOs.
outcome: Customers learn about an incident from our status page before they notice it themselves, and SLO attainment is public.
status: planned
release: rel-ga
start: "2027-01-04"
target: "2027-02-05"
pm: tomas
engineering_team: platform
contributors: [rafael, sam]
jira: [LAUNCH-4, OBS-14]
---

## Design

![Status page reading "All systems operational" with 90-day uptime bars for the sandbox API, runtime, snapshots and forks, egress proxy, console and billing](../media/status-page.png "Status page mockup with launch-week data")

## SLOs at GA

| SLI | Objective | Window | Measured by |
| --- | --- | --- | --- |
| API availability (non-5xx, excluding 429) | 99.9% | 28 days | Load balancer logs |
| Create success | 99.95% | 28 days | Control plane |
| Create latency | p95 under 350 ms | 7 days | Control plane |
| Fork latency, 4 GiB | p95 under 1.5 s | 7 days | Control plane |
| Log delivery | p95 under 1 s | 7 days | Synthetic sandbox every minute |

Synthetic checks create, exec, snapshot and fork a sandbox every minute from two outside networks. Two consecutive failures open an incident automatically; the incident commander posts the first public update within 10 minutes.
