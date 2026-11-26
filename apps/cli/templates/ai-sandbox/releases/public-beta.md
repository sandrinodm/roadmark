---
id: rel-public-beta
title: Public beta
description: Self-serve sign-up, the v1 API, forking, egress policy and the web console.
outcome: 2,000 organisations run production agent traffic on Cloche with a create success rate of 99.9% or better.
status: in-progress
start: "2026-09-02"
target: "2026-12-11"
---

## Where we are

The beta opened to self-serve sign-up on 14 October 2026. As of 24 November:

- 2,140 organisations active in the last 30 days, 11,800 still on the waitlist for higher concurrency.
- 4.1 million sandboxes created; create success rate 99.93% over the last 28 days.
- Cold start from the warm pool: p50 182 ms, p95 420 ms.

## Beta exit criteria

The beta closes on 11 December with a feature freeze for GA. To exit we need:

- [x] `POST /v1/sandboxes` and the rest of the v1 surface frozen; breaking changes after this go to v2.
- [x] Egress policy enforced in every sandbox, defaulting to `allow-all` for compatibility.
- [ ] Fork p95 under 1.5 s for a 4 GiB sandbox (currently 1.9 s).
- [ ] Sandbox detail page with live logs in the console.
- [ ] Zero open Sev-1 isolation findings.
