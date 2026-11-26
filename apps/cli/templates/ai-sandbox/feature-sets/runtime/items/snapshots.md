---
id: item-snapshots
title: Memory and disk snapshots
description: Capture a sandbox's full state, memory and disk, and restore it into a new sandbox.
outcome: An agent can save a prepared environment once and restore it in under 400 ms instead of reinstalling dependencies.
status: done
release: rel-private-alpha
start: "2026-06-01"
target: "2026-07-24"
contributors: [mei]
jira: [RT-31, RT-33]
---

## Format

A snapshot is a memory file, a device-state file and a disk diff against the template image. After the first full snapshot, later snapshots of the same lineage store only dirty pages. A typical agent sandbox after `pip install` dirties 0.8 to 1.6 GiB of its 4 GiB.

Snapshots are written to local NVMe first and replicated to the regional object store within 20 s. Restore reads from local NVMe when the scheduler can place the sandbox on a host that holds the snapshot, and otherwise streams it from object storage with lazy page loading.

## Results at alpha

- Create: p50 296 ms for a 4 GiB guest; the guest is paused for 40 to 120 ms of that.
- Restore on a warm host: p50 240 ms. Restore cross-host with lazy loading: p50 1.1 s.

This format is what [forking a running sandbox](fork.mdx) builds on.
