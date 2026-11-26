---
id: item-persistent-volumes
title: Persistent volumes
description: Attach a named volume that outlives the sandbox, for caches and agent workspaces.
outcome: Agents keep a package cache or a cloned repository between runs without paying for a long-lived sandbox or a snapshot.
status: planned
release: rel-ga
start: "2026-12-14"
target: "2027-02-05"
contributors: [mei]
jira: [RT-77]
---

## Shape

`cloche volume create pip-cache --size 10GiB`, then `create --volume pip-cache:/root/.cache/pip`. A volume can be attached read-write to one sandbox, or read-only to many. Volumes are billed at the snapshot storage rate, $0.08 per GiB-month.

## Open questions

- Can a forked sandbox keep a read-write volume? Our current answer is no: forks get the volume read-only and must opt in to a copy.
- Do we need cross-region volume replication for [Teams and regions](../../../releases/teams-and-regions.md), or is region-pinned enough?
