# onshape-mcp

An MCP server for driving [Onshape](https://www.onshape.com) CAD from an AI
assistant: 87 tools covering documents, Part Studios, sketching, solid features,
assemblies, drawings, measurement and export — plus a browser login flow, so
getting connected is one tool call rather than a detour through a developer
portal and a config file.

It covers the same ground as the [`onshape-cli`](https://github.com/am-will/onshape-cli)
command set (see [NOTICE](NOTICE)), re-cut as MCP tools.

## Install

```bash
git clone <this repo> onshape-mcp && cd onshape-mcp
npm install
npm run build
```

Register it with Claude Code:

```bash
claude mcp add onshape -- node /absolute/path/to/onshape-mcp/dist/index.js
```

Or, for any other MCP client, add the equivalent stdio entry:

```json
{
  "mcpServers": {
    "onshape": { "command": "node", "args": ["/absolute/path/to/onshape-mcp/dist/index.js"] }
  }
}
```

## Signing in

Ask the assistant to sign in to Onshape, or call `onshape_login` directly. No
keys or config files needed up front.

**API key (default).** The server opens your browser at a page it serves on
`127.0.0.1`. That page links to the Onshape developer key page; you create a key
pair, paste both halves back into the local page, and the server verifies them
against Onshape and stores them in your OS keychain. Nothing is sent anywhere
but Onshape. The tool returns straight away with `status: "pending"` — the
assistant polls `onshape_login_status` while you finish.

**OAuth 2.0.** `onshape_login` with `method: "oauth"` runs the authorization-code
flow. It needs an app registered at
[the Onshape developer portal](https://cad.onshape.com/appstore/dev-portal) with
its redirect URL set to `http://localhost:8471/oauth/callback`; pass the app's
`client_id` and `client_secret` (or set `ONSHAPE_OAUTH_CLIENT_ID` and
`ONSHAPE_OAUTH_CLIENT_SECRET`). Access tokens are refreshed automatically.

**Already have keys?** `onshape_set_api_key` stores a pair without a browser,
and the server also reads `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY` and an
existing `onshape-cli` credential at `~/.onshape/credentials.json`.

`onshape_auth_status` shows which credential is in use (redacted) and whether it
still works; `onshape_logout` forgets the one this server stored.

### Where credentials live

Secrets go to the OS keychain (service `onshape-mcp`) when one is available, and
`~/.onshape-mcp/credentials.json` keeps only non-secret metadata. Without a
keychain, that file holds the secret and is written `0600` inside a `0700`
directory.

Resolution order: environment variables → this server's store → an existing
`onshape-cli` install.

## Tools

| Area | Tools |
| --- | --- |
| Sign-in | `login`, `login_status`, `set_api_key`, `auth_status`, `logout` |
| Documents | `list_documents`, `search_documents`, `get_document`, `get_document_summary`, `create_document`, `update_document`, `delete_document`, `get_workspaces`, `get_elements`, `find_part_studios`, `list_versions`, `create_version`, `delete_element` |
| Part Studios | `create_part_studio`, `get_features`, `get_feature_specs`, `get_sketch_info`, `get_body_details`, `get_parts`, `mass_properties`, `measure`, `validate_part_studio`, `add_feature`, `update_feature`, `delete_feature`, `rollback`, `eval_featurescript` |
| Sketching | `sketch_rectangle`, `sketch_circle`, `sketch_line`, `sketch_circle_axis`, `create_sketch`, `sketch_candy_cane_path` |
| Solids | `extrude`, `hole`, `thicken`, `revolve`, `sweep`, `fillet`, `chamfer`, `shell`, `draft`, `boolean`, `boolean_union`, `mirror`, `linear_pattern`, `circular_pattern`, `offset_plane` |
| Geometry | `get_edges`, `find_circular_edges`, `find_edges_by_feature` |
| Variables | `get_variables`, `set_variable`, `get_configuration`, `encode_configuration` |
| Export | `export_stl`, `export`, `shaded_view`, `get_thumbnail`, `thumbnail_info` |
| Assemblies | `create_assembly`, `get_assembly`, `insert_instance`, `delete_instance`, `transform_instance`, `get_assembly_features`, `assembly_mate_connector`, `assembly_mate`, `assembly_group`, `assembly_add_feature`, `get_bom`, `assembly_mass_properties` |
| Drawings | `create_drawing`, `get_drawing_views`, `export_drawing` |
| Feature Studios | `create_feature_studio`, `get_feature_studio`, `set_feature_studio`, `get_feature_studio_specs` |
| Metadata | `get_metadata`, `set_metadata` |
| Escape hatch | `request` |

All names are prefixed `onshape_`. Every tool returns `{"ok": true, "result": …}`
or `{"ok": false, "error": …, "detail": …}`.

A few things worth knowing:

- **Units are inches and degrees** throughout.
- **Feature tools validate by default.** Onshape answers `200` for a feature
  that fails to regenerate, so each one re-reads the feature state and fails
  loudly instead. Pass `validate: false` to skip it.
- **Renders come back as images.** `shaded_view` and `get_thumbnail` return the
  PNG inline as well as writing it, so the model can actually look at the part.
- **Big reads spill to disk.** A response over `ONSHAPE_MCP_MAX_RESPONSE_BYTES`
  (default 200 kB) is written to a file and summarised, which keeps a feature
  tree from swallowing the context window.
- `onshape_request` reaches any REST endpoint the dedicated tools miss.

## Configuration

| Variable | Effect |
| --- | --- |
| `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` | Use this key pair, ahead of any stored credential |
| `ONSHAPE_BASE_URL` | Onshape API host (default `https://cad.onshape.com`) |
| `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET` | Default OAuth app credentials |
| `ONSHAPE_DOC`, `ONSHAPE_WS`, `ONSHAPE_ELEM` | Default target; these arguments become optional when set |
| `ONSHAPE_MCP_OUTPUT_DIR` | Where relative export paths land (default: the server's working directory) |
| `ONSHAPE_MCP_MAX_RESPONSE_BYTES` | Response size before spilling to a file (default 200000) |
| `ONSHAPE_MCP_CONFIG` | Credential file path (default `~/.onshape-mcp/credentials.json`) |
| `ONSHAPE_TIMEOUT_MS` | Per-request timeout (default 120000) |

## Account limitations

These come from Onshape, not from this server:

- **Free accounts can only create public documents** — pass `public: true` to
  `onshape_create_document`.
- **Deleting needs a key with delete permission.** A key without it fails with
  `403 Invalid API key state`; re-create the key at
  [dev.onshape.com/keys](https://dev.onshape.com/keys) with Delete ticked.
- **The variable-table endpoint 404s on some accounts.** `onshape_set_variable`
  and `onshape_get_variables` fall back to `assignVariable` features, which work
  everywhere; `result.route` / `result.source` says which path was taken.

## Development

```bash
npm run check     # type-check
npm test          # 28 unit tests, no network
npm run build

node scripts/smoke.mjs           # live read-only check against your account
node scripts/smoke.mjs --write   # also builds a throwaway part, then deletes it
```

The layout: `src/auth` (credential store, keychain, login flows, OAuth),
`src/api` (REST wrappers), `src/builders` (Onshape BTM feature payloads),
`src/tools` (the MCP surface), `src/server.ts` (registration).

## Licence

MIT. Portions derived from `onshape-cli` — see [NOTICE](NOTICE).
