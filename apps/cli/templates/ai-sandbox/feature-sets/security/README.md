---
id: set-security
title: Security and compliance
description: Isolation assurance, secrets handling, abuse prevention and SOC 2.
outcome: A security reviewer at a 500-person company can approve Cloche from our documentation and reports, without a bespoke questionnaire.
pm: tomas
engineering_team: platform
links:
  - label: Threat model
    url: https://docs.cloche.example/internal/threat-model
  - label: Trust centre (draft)
    url: https://trust.cloche.example
---

## Threat model in one paragraph

We assume the code inside a sandbox is hostile: it was written by a model that may have been prompt-injected. The guest kernel is untrusted. The trust boundary is the microVM monitor and the host kernel beneath it, hardened with seccomp, a jailer per VM and no shared filesystems. The second boundary is the network: by default a sandbox can reach the public internet but never our internal ranges, the metadata service or another sandbox.
