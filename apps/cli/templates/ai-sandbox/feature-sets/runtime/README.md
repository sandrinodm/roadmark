---
id: set-runtime
title: Sandbox runtime
description: The microVM host, snapshot store, scheduler and network enforcement behind every sandbox.
outcome: Agents get a full Linux machine in under 400 ms that is isolated from every other tenant and can be snapshotted and forked.
pm: tomas
engineering_team: runtime
links:
  - label: Runtime design doc
    url: https://docs.cloche.example/internal/runtime-design
  - label: Runtime on-call dashboard
    url: https://grafana.cloche.example/d/runtime-overview
---

## What the runtime promises

Every sandbox is its own microVM with its own kernel. Nothing is shared between tenants except the host hardware and the hypervisor. On top of that isolation we offer four primitives: **create**, **exec**, **snapshot** and **fork**.

| Default | Value |
| --- | --- |
| vCPU / memory / disk | 2 vCPU, 4 GiB, 20 GiB |
| Maximum per sandbox | 16 vCPU, 32 GiB, 200 GiB |
| Cold start from warm pool | p50 182 ms, p95 420 ms (GA goal: p95 350 ms) |
| Snapshot create (4 GiB, dirty pages only) | p50 296 ms |
| Snapshot restore | p50 240 ms |
| Fork of a running sandbox | p50 710 ms, p95 1.9 s (beta exit goal: p95 1.5 s) |

## Architecture

```mermaid title="Request path from SDK to microVM"
flowchart TB
  SDK[SDK or CLI] -->|HTTPS| API[Control-plane API]
  API --> SCHED[Scheduler]
  SCHED --> POOL[(Warm pool)]
  SCHED --> HOST[Host agent]
  HOST <--> SNAP[(Snapshot store)]
  HOST --> VM1[microVM sbx_a]
  HOST --> VM2[microVM sbx_b]
  VM1 --> EGRESS[Egress proxy]
  VM2 --> EGRESS
  EGRESS -->|allowed by policy| NET((Internet))
```

The scheduler prefers a host that already holds the base snapshot in local NVMe. That locality is what keeps fork and restore under a second.
