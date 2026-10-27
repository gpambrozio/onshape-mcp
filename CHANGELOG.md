# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `onshape_clearance`: the minimum distance between two solid bodies, each named
  by part id or by the feature that created it, in inches and millimetres with
  the closest points. Zero means the bodies touch or overlap, so it doubles as
  an interference check.
- `onshape_extrude` and `onshape_hole` take `end_type` (`BLIND`, `SYMMETRIC` or
  `THROUGH_ALL`) and `opposite`. A through-all cut needs no depth, and a
  symmetric extrude spends its depth half on each side of the sketch plane.

### Changed

- **`onshape_export_stl` now writes millimetres by default**, not inches. STL
  carries no unit and slicers read it as millimetres, so the old default printed
  parts 25.4 times too small. Pass `units: "inch"` for the previous behaviour.
  The result now states the unit used.

### Fixed

- `onshape_set_variable` on accounts without the variable table appended a new
  Variable feature every time, so setting an existing name changed nothing built
  before the new feature, and said nothing about it. It now rewrites the existing
  feature in place, keeping its description unless given a new one, and reports
  `action: "updated"` or `"created"`.
- `construction: true` was ignored on arcs in `onshape_create_sketch`.
- `onshape_find_circular_edges` returned `[]` on every part, and
  `onshape_get_edges` labelled arcs and circles as lines. Both read the radius
  from the edge's `geometry`, but `/bodydetails` describes the curve (type,
  radius, centre) under `curve`. Circular edges now also report their centre in
  inches, which tells a hole rim from a fillet arc of the same radius.

## [0.1.2] - 2026-09-21

### Fixed

- `server.json` carried a description longer than the 100 characters the MCP
  registry accepts, so the 0.1.1 release reached npm but was rejected by the
  registry. Shortened, and a test now holds the limit.

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

[Unreleased]: https://github.com/gpambrozio/onshape-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/gpambrozio/onshape-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/gpambrozio/onshape-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/gpambrozio/onshape-mcp/releases/tag/v0.1.0
