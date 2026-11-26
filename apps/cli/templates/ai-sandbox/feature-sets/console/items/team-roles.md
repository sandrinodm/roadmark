---
id: item-team-roles
title: Team workspaces with roles
description: Owner, Admin, Developer and Billing roles, with API keys scoped to a project.
outcome: Companies can give 50 engineers access without giving all of them the ability to delete keys or see invoices.
status: planned
release: rel-teams-regions
start: "2027-03-01"
target: "2027-05"
contributors: [aiyana, rafael]
contributing_teams: [platform]
jira: [CON-40, CON-41]
---

## Roles

| Role | Sandboxes | API keys | Members | Billing |
| --- | --- | --- | --- | --- |
| Owner | All | All | All | All |
| Admin | All | All | Invite, remove | View |
| Developer | Own project | Own project | None | None |
| Billing | View | None | None | All |

Projects group sandboxes, keys and egress policies. Every organisation gets a `default` project at migration so nothing changes until an admin creates a second one.
