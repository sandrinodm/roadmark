---
id: set-sdks
title: SDKs and API
description: The public REST API v1 and the TypeScript and Python SDKs built on it.
outcome: Agent frameworks integrate Cloche in under 50 lines, and the API surface stays backwards-compatible for at least 12 months after GA.
pm: priya
engineering_team: devex
links:
  - label: OpenAPI spec (v1)
    url: https://api.cloche.example/v1/openapi.json
  - label: SDK design guidelines
    url: https://docs.cloche.example/internal/sdk-guidelines
---

## Surface

| Package | Registry | Runtime support | Status |
| --- | --- | --- | --- |
| `@cloche/sdk` | npm | Node 20+, Bun 1.1+, Deno 2 | 0.9 beta, 1.0 at GA |
| `cloche` | PyPI | Python 3.9 to 3.13, sync and asyncio | 0.9 beta, 1.0 at GA |
| REST API v1 | `api.cloche.example/v1` | Any HTTP client | Frozen 11 December |

Both SDKs are generated from the OpenAPI document for transport and models, with hand-written ergonomic layers (`exec`, `fork`, context managers, streaming). The generated layer is regenerated in CI on every API change; a diff in the hand-written layer needs review from both SDK owners.
