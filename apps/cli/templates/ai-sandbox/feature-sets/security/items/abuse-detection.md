---
id: item-abuse-detection
title: Abuse detection
description: Detect and stop crypto-mining, outbound attacks and proxying on free and trial accounts.
outcome: Abuse costs less than 2% of free-tier compute, and no abuse report from a third party goes unanswered for more than 1 hour.
status: in-progress
release: rel-ga
start: "2026-12-14"
target: "2027-02-05"
contributors: [hana]
contributing_teams: [runtime]
depends_on:
  - item: item-egress-policy
    reason: Detection relies on per-sandbox egress decisions and byte counts from the proxy.
jira: [SEC-12]
---

## Signals

| Signal | Threshold | Action |
| --- | --- | --- |
| Sustained CPU above 95% for 20 min on a free account | 1 sandbox | Pause and email |
| Connections to known mining pools | Any | Stop and suspend org |
| Outbound SYN rate | Over 500 per second | Stop, rate-limit org egress |
| Distinct destination IPs per hour | Over 5,000 | Flag for review |

During the beta, 4% of free organisations were abusive and used 19% of free-tier compute. Suspended organisations can appeal through support; false positives in beta were 3 of 212 suspensions.
