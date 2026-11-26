---
id: item-api-reference
title: Generated API and SDK reference
description: Reference pages generated from the OpenAPI document and the SDK type definitions, with runnable examples.
outcome: Every endpoint, parameter and error code is documented on the day it ships, with no hand-maintained reference pages.
status: planned
release: rel-ga
start: "2026-12-14"
target: "2027-01-29"
contributors: [jonah]
depends_on:
  - item: item-public-api
    reason: The reference is generated from the frozen v1 OpenAPI document.
jira: [DOC-8]
---

## Scope

- REST: one page per resource, request and response examples in curl, TypeScript and Python generated from the same fixture.
- SDKs: one page per class from TypeDoc and Sphinx output, restyled into the docs theme.
- Errors: one page per `error.code`, linked from the API's `docs` field so a `429` points at the exact explanation.

## Not in scope

Interactive "try it" consoles. They need a browser-safe key flow we will not have by GA.
