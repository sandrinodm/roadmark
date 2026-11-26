---
id: item-gpu-sandboxes
title: GPU sandboxes
description: Explore sandboxes with an attached GPU for agents that run models, notebooks or CUDA code.
outcome: A decision, backed by a prototype, on whether GPU sandboxes can be offered with snapshots and at under 2x the cost of a dedicated instance.
status: proposed
release: rel-gpu
target: "2027-Q3"
pm: tomas
jira: [RT-120]
---

## Why it is only proposed

Fourteen beta organisations asked for GPUs. Most want to run a small open-weight model next to the agent's code. That demand is real but narrow, and GPU passthrough breaks the two things that make Cloche different: memory snapshots and sub-second boot.

## What a prototype must answer

1. Can we snapshot disk only and restore a GPU sandbox in under 5 s?
2. What does a fractional GPU cost us per hour in `iad` without a reserved-capacity commitment?
3. Is a separate, slower product line confusing next to 200 ms CPU sandboxes?
