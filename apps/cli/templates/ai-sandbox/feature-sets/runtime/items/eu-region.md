---
id: item-eu-region
title: EU region (fra)
description: A second region in eu-central with region-pinned sandboxes, snapshots and logs.
outcome: EU customers keep sandbox data and logs in the EU, which removes the top blocker in 22% of lost enterprise deals.
status: planned
release: rel-teams-regions
start: "2027-03-08"
target: "2027-Q2"
contributors: [lukas, rafael]
contributing_teams: [platform]
depends_on:
  - item: item-snapshots
    reason: Snapshots must carry a region tag and never replicate across regions.
jira: [RT-102]
---

## Scope

- `region: fra` on create; organisation-level default region.
- Snapshots, volumes and logs never leave the region they were created in.
- The control plane stays global, but stores only metadata (IDs, sizes, timestamps) outside the region.

## Risk

Capacity: the warm pool in `fra` will start at 20% of `iad`. Until it grows, cold starts in `fra` will be closer to 400 ms p50.
