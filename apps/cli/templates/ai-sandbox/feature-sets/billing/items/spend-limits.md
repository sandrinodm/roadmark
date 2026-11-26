---
id: item-spend-limits
title: Spend limits and alerts
description: Monthly budgets with email and webhook alerts at thresholds, and an optional hard stop.
outcome: No customer receives an invoice more than 10% above the budget they set.
status: planned
release: rel-teams-regions
start: "2027-03-15"
target: "2027-05"
contributors: [rafael]
depends_on:
  - item: item-usage-metering
    reason: Alerts read cost to date from the usage ledger.
jira: [BILL-20]
---

## Behaviour

- Alerts at 50%, 80% and 100% of a monthly budget, by email and webhook.
- Optional hard stop at 100%: new creates fail with `402 budget_exceeded`, and running sandboxes are paused (not deleted) so no work is lost.
- Budgets per organisation at launch; per project once [roles and projects](../../console/items/team-roles.md) ship.
