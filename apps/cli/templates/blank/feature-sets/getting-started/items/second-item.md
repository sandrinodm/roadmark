---
id: item-second-item
title: Second item
description: An item that can only start after the first one is done.
outcome: Describe the result and how you will measure it.
status: proposed
target: '2027-Q2'
depends_on:
  - item: item-first-item
    reason: Builds on the first item's work.
---

Items without a `release` show as not yet scheduled.
