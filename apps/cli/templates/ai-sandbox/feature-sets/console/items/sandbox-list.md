---
id: item-sandbox-list
title: Sandbox list
description: A filterable list of every sandbox with state, size, creator, uptime and cost to date.
outcome: An engineer can find a runaway or expensive sandbox in under 10 seconds.
status: done
release: rel-public-beta
start: "2026-09-14"
target: "2026-10-09"
pm: ines
contributors: [aiyana]
jira: [CON-11]
---

## What shipped

![Sandbox list with four summary cards, filter chips and a table of nine sandboxes, three of them forks of the first](../media/console-sandboxes.png "Sandbox list as shipped in the public beta")

- Summary cards: running now against the plan's concurrency, created today with p50 cold start, vCPU-hours and spend today, snapshot storage.
- Filters for state, template, API key and region, kept in the URL.
- Forks are nested under their parent.
- Cost to date per sandbox, updated every 60 s from the [usage meter](../../billing/items/usage-metering.mdx).

## Usage since launch

58% of weekly active console users open this page at least once a week. The most used filter is "Created by" (API key), because most organisations use one key per agent.
