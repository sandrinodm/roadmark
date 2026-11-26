# Security policy

## Supported versions

Security fixes go into the latest published version of `roadmark`. Upgrade to the newest release before reporting an issue that may already be fixed.

## Reporting a vulnerability

Don't open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/sandrinodm/roadmark/security/advisories/new) to send the details to the maintainer.

Include the affected version, reproduction steps and the expected impact. Don't include secrets or personal data in the report.

## Scope

These are in scope:

- The `roadmark` CLI.
- The `dev` and `preview` servers it starts. They are for local use and only listen on 127.0.0.1.
- The static sites it builds, including the browser script they ship.

MDX briefs and the components they import run with the permissions of the Node process during `lint`, `build` and `dev`, by design. Only build workspaces from authors you trust. Running code from a workspace you chose to build is not a vulnerability. Escaping the workspace through a path, include or link that should have been refused is.

## Releases

Every release is published from GitHub Actions with npm trusted publishing and carries a provenance attestation. Check it with `npm view roadmark@<version> dist.attestations`. Apart from the first manual publish, a version without provenance did not come from this repository's release workflow. Report it.
