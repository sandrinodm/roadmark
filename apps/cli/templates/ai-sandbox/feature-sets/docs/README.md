---
id: set-docs
title: Docs
description: docs.cloche.example with the quickstart, guides and generated reference.
outcome: The median new user creates their first sandbox within 5 minutes of opening the quickstart.
pm: priya
engineering_team: devex
links:
  - label: Docs analytics
    url: https://analytics.cloche.example/docs
---

## Information architecture

Get started (quickstart, concepts, templates), Guides (task-shaped, one per common agent pattern), Reference (generated from OpenAPI and SDK type definitions) and the CLI reference generated from the command spec. Every code sample in the docs is executed in CI against the staging API, so a broken sample fails the build.

## Baseline

Beta median time from opening the quickstart to the first successful `create` is 9 min 40 s. The largest drop-off (31%) is at "create an API key", which currently needs three clicks in the console and a page reload.
