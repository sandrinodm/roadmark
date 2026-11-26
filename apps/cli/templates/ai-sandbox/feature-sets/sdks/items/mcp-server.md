---
id: item-mcp-server
title: MCP server for sandboxes
description: Expose create, exec, files and fork as Model Context Protocol tools.
outcome: Any MCP-capable agent can use a Cloche sandbox as its code execution tool without writing integration code.
status: proposed
contributors: [kofi]
jira: [SDK-40]
---

## Proposal

A small open-source server in the public repository that wraps the TypeScript SDK and exposes six tools: `create_sandbox`, `run_command`, `write_file`, `read_file`, `fork_sandbox`, `stop_sandbox`. It runs locally with the user's API key, or hosted at `mcp.cloche.example` with OAuth.

## Not yet assigned to a release

Kofi built a prototype in a day. The open question is ownership: the hosted variant needs on-call and an OAuth flow we do not have. Decide in the January planning review.
