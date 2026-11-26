---
id: item-pricing-page
title: Pricing page
description: Plans, per-second rates, a worked example and an FAQ on the public site.
outcome: A visitor can estimate their monthly bill in under a minute, and pricing questions to support stay under 5% of launch-week tickets.
status: planned
release: rel-ga
start: "2027-01-18"
target: "2027-02-05"
contributors: [aiyana]
depends_on:
  - item: item-pricing-plans
    reason: The page cannot be finalised until plan limits and rates are signed off.
jira: [WEB-9]
---

## Draft

![Pricing page with Free, Pro, Team and Enterprise plan cards and a usage-rate table for vCPU, memory, snapshot storage, egress and static IPs](../media/pricing.png "Pricing page draft, using the proposed rates")

## Still to decide

- Whether to show an interactive calculator at launch or a worked example only. The draft uses a worked example: a default sandbox at $0.166 per hour and a 90-second task at $0.0041.
- FAQ wording for "what happens when I hit the concurrency limit?" It must match the `429` behaviour in the [API](../../sdks/items/public-api.mdx).
