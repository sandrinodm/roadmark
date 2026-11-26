---
id: item-guided-setup
title: Guided workspace setup
description: Walk administrators through three setup steps.
outcome: Administrators can finish setup without contacting support.
status: in-progress
release: rel-spring
start: "2027-03-08"
target: "2027-04-09"
contributors: [noor]
contributing_teams: [analytics, platform]
depends_on:
  - item: item-setup-events
    reason: The checklist reads completion events to show which steps are done.
jira: [ONB-142, PLAT-88]
links:
  - label: Accessible forms tutorial
    url: https://www.w3.org/WAI/tutorials/forms/
---

## Experience

Returning administrators pick up where they left off. The checklist uses the [setup event contract](../../platform/items/setup-events.md#event-contract).

![Workspace checklist with the source connected and event verification in progress](../media/setup-preview.png)

[Watch the guided setup walkthrough](../media/setup-walkthrough.mp4)

## Acceptance criteria

- [x] Preserve completed steps when the administrator returns.
- [ ] Explain how to retry a failed connection.
- [ ] Distinguish first-time setup from a retry.

## Delivery sequence

```roadmap-dependencies
```
