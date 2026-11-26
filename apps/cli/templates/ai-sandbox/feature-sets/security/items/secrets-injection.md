---
id: item-secrets-injection
title: Encrypted secrets injection
description: Store secrets per organisation and inject them as environment variables or files at create time.
outcome: Agents use third-party credentials inside a sandbox without the secret appearing in prompts, code, logs or snapshots.
status: done
release: rel-public-beta
start: "2026-09-21"
target: "2026-10-30"
contributors: [hana]
jira: [SEC-6]
---

## How it works

Secrets are encrypted with a per-organisation key in the KMS. At create, the host agent fetches only the secrets named in the request and writes them into guest memory over vsock, never to disk.

- Snapshots exclude secret memory regions; restored and forked sandboxes get secrets re-injected, which is why forks always see current values.
- Log streams redact exact matches of injected secret values.
- `cloche secrets set MODEL_API_KEY --from-stdin` never echoes the value.
