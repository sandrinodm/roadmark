# Roadmap field reference

The compiler generates this reference and the editor schemas from its runtime definitions. The linter also checks calendar dates, file paths and relationships across documents.

## Workspace

| Field | Required | Values | Meaning |
|---|---|---|---|
| `schema_version` | Yes | 1 | Workspace format version. |
| `title` | Yes | string | Display name used in navigation and search. |
| `people` | No | object | Map PM identifiers to display names. |
| `teams` | No | object | Map team identifiers to display names. |
| `jira_base_url` | No | string | HTTPS address of the Jira instance, before /browse/. |

[Editor schema](schemas/workspace.json)

## Set

| Field | Required | Values | Meaning |
|---|---|---|---|
| `id` | Yes | string | Stable workspace-wide identifier used in URLs and references. |
| `title` | Yes | string | Display name used in navigation and search. |
| `description` | Yes | string | Short summary for lists and search. |
| `links` | No | array | Ordered list of named web links, each with a label and URL. |
| `outcome` | Yes | string | The change a reader should expect for customers or the business. |
| `pm` | Yes | string | Accountable PM from the people directory. |
| `engineering_team` | Yes | string | Accountable team from the teams directory. |

[Editor schema](schemas/set.json)

## Item

| Field | Required | Values | Meaning |
|---|---|---|---|
| `id` | Yes | string | Stable workspace-wide identifier used in URLs and references. |
| `title` | Yes | string | Display name used in navigation and search. |
| `description` | Yes | string | Short summary for lists and search. |
| `links` | No | array | Ordered list of named web links, each with a label and URL. |
| `outcome` | Yes | string | The change a reader should expect for customers or the business. |
| `status` | Yes | proposed, planned, in-progress, done, cancelled | Current lifecycle state. |
| `release` | No | string | ID of the release containing this work. |
| `start` | No | string | First planned day of work. |
| `target` | No | string | Intended delivery date or window. |
| `pm` | No | string | Accountable PM from the people directory. |
| `engineering_team` | No | string | Accountable team from the teams directory. |
| `contributors` | No | array | People directly contributing to this item. |
| `contributing_teams` | No | array | Teams helping the accountable engineering team. |
| `depends_on` | No | array | Item prerequisites with optional reasons. |
| `jira` | No | array | Searchable Jira issue keys. |

[Editor schema](schemas/item.json)

## Release

| Field | Required | Values | Meaning |
|---|---|---|---|
| `id` | Yes | string | Stable workspace-wide identifier used in URLs and references. |
| `title` | Yes | string | Display name used in navigation and search. |
| `description` | Yes | string | Short summary for lists and search. |
| `outcome` | Yes | string | The change a reader should expect for customers or the business. |
| `status` | Yes | planned, in-progress, shipped, cancelled | Current lifecycle state. |
| `start` | No | string | First planned day of work. |
| `target` | Yes | string | Intended delivery date or window. |
| `shipped_on` | No | string | Actual release day. Required for shipped releases. |

[Editor schema](schemas/release.json)

## Teams

Each stable ID maps to a display name or an object with these fields.

| Field | Required | Values | Meaning |
|---|---|---|---|
| `name` | Yes | string | Nonblank text. |
| `description` | No | string | Short summary for lists and search. |

[Editor schema](schemas/teams.json)

## People

Each stable ID maps to a display name or an object with these fields.

| Field | Required | Values | Meaning |
|---|---|---|---|
| `name` | Yes | string | Nonblank text. |
| `avatar` | No | string | Workspace-relative PNG, JPEG or WebP portrait. |
| `role` | No | string | Nonblank text. |
| `teams` | No | array | Team memberships. |

[Editor schema](schemas/people.json)

## Brand

| Field | Required | Values | Meaning |
|---|---|---|---|
| `schema_version` | Yes | 1 | Workspace format version. |
| `colors` | No | object | Semantic site colors. |
| `typography` | No | object | Body, heading and header type settings. |
| `header` | No | object | Header colors and optional logo. |
| `background` | No | object | Optional image behind the page. |

[Editor schema](schemas/brand.json)
