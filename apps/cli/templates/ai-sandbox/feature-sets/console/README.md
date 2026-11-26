---
id: set-console
title: Web console
description: The dashboard where teams see their sandboxes, logs, usage and keys.
outcome: An engineer can answer "what is this sandbox doing and what is it costing me" in under 30 seconds without the CLI.
pm: ines
engineering_team: web
links:
  - label: Console designs
    url: https://design.cloche.example/console
---

## Scope for GA

The console is a read-mostly tool. Agents create sandboxes through the API; people use the console to inspect them, stop runaway ones, manage keys and understand the bill. We are deliberately not building an in-browser IDE.

![Console sandbox list showing running and paused sandboxes with CPU, uptime and cost columns](media/console-sandboxes.png "Sandbox list, public beta build")
