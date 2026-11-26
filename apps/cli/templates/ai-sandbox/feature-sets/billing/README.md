---
id: set-billing
title: Pricing and billing
description: Per-second metering, plans, invoices and spend controls.
outcome: Every second a sandbox runs is metered within 0.1% accuracy and billed on a plan customers can predict.
pm: tomas
engineering_team: platform
links:
  - label: Pricing model spreadsheet
    url: https://sheets.cloche.example/pricing-model-v4
---

## Unit economics

At list price a default sandbox (2 vCPU, 4 GiB) earns $0.166 per hour. Our fully loaded host cost for the same slice at 70% packing is $0.061 per hour, a 63% gross margin. Free-tier abuse and idle warm-pool capacity bring the blended margin target to 55% for the first two quarters after GA.
