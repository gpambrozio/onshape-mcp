# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-21

### Fixed

- The sign-in page linked to the wrong place for a new API key. Keys live under
  account settings at `/user/developer/apiKeys` on the account's own host, not
  at `dev.onshape.com/keys` or `/appstore/dev-portal/keys`.

### Changed

- The sign-in page leads with a button to the Onshape key page, names the Read,
  Write and Delete permissions the tools need, and retargets the link at the
  Onshape URL you type, so enterprise users reach their own key page.
- Releases publish to npm through trusted publishing (OIDC) rather than a stored
  npm token; provenance is attached automatically.

## [0.1.0] - 2026-09-20

First release.

### Added

- 87 MCP tools covering Onshape documents, part studios, sketching, solid
  features, geometry queries, variables, exports, assemblies, drawings, feature
  studios and metadata, plus a generic REST escape hatch.
- Sign-in with no configuration: the first tool call that needs Onshape starts a
  browser flow and asks the client to show the link through MCP URL elicitation,
  falling back to returning the URL. API keys and OAuth 2.0 are both supported,
  with credentials verified before being stored in the OS keychain.
- Renders returned inline as images, oversized responses spilled to a file, and
  automatic validation that a newly added feature actually regenerated.
- A Claude Desktop bundle (`.mcpb`) built in CI and attached to releases.

### Fixed

Two Onshape behaviours that break the upstream `onshape-cli` this project draws
its API layer from:

- Feature parameters carrying `libraryRelationType: "NONE"` are rejected with
  `400 BTWeirdStringValueException`; the field is now omitted, which fixes
  extrude, fillet, boolean and every other feature payload.
- The variable-table endpoint answers 404 on some accounts, so variables are
  read and written through `assignVariable` features when it does.

[Unreleased]: https://github.com/gpambrozio/onshape-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/gpambrozio/onshape-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/gpambrozio/onshape-mcp/releases/tag/v0.1.0
