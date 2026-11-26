---
id: set-observability
title: Observability
description: Logs, metrics and traces for every sandbox, in the console and exported to the customer's tools.
outcome: When an agent run goes wrong, the customer can see what happened inside the sandbox without having added any logging of their own.
pm: tomas
engineering_team: platform
---

## Signals

| Signal | Source | Retention | Where |
| --- | --- | --- | --- |
| Process stdout and stderr | Guest agent | 7 days (Pro), 30 days (Team) | Console, API, CLI `logs -f` |
| CPU, memory, disk, network | Host agent, 1 s resolution | 15 days | Console, API |
| Egress decisions | Egress proxy | 30 days | Console, API |
| Lifecycle events | Control plane | 90 days | Console, API, webhook |
| Traces (OTLP) | Control plane and SDKs | Customer's backend | Teams and regions |
