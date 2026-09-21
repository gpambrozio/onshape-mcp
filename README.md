# Onshape MCP server

Drive [Onshape](https://www.onshape.com) CAD from an AI assistant. 87 tools for
documents, part studios, sketching, solid features, assemblies, drawings,
measurement and export — and no setup beyond installing it: the first tool call
that needs Onshape opens a browser and asks you to connect.

[![CI](https://github.com/gpambrozio/onshape-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/gpambrozio/onshape-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@gpambrozio/onshape-mcp)](https://www.npmjs.com/package/@gpambrozio/onshape-mcp)

```
"Make a 60 × 40 × 10 mm bracket with 4 mm mounting holes and 2 mm fillets, then show me a render"
```

The assistant sketches it, extrudes it, fillets the edges, measures the result,
renders it back into the conversation, and exports an STL you can print.

## Install

**Claude Code**

```bash
claude mcp add onshape -- npx -y @gpambrozio/onshape-mcp
```

**Claude Desktop** — download `onshape-mcp-<version>.mcpb` from the
[latest release](https://github.com/gpambrozio/onshape-mcp/releases/latest) and
double-click it. Nothing else to install.

**Cursor, VS Code, Windsurf, Zed and other MCP clients** — add the server to the
client's MCP config:

```json
{
  "mcpServers": {
    "onshape": {
      "command": "npx",
      "args": ["-y", "@gpambrozio/onshape-mcp"]
    }
  }
}
```

The file differs per client: `~/.cursor/mcp.json` (Cursor), `.vscode/mcp.json`
(VS Code), `~/.codeium/windsurf/mcp_config.json` (Windsurf), `~/.config/zed/settings.json`
under `context_servers` (Zed).

Node 20 or newer is required. `npx` fetches the package on first run.

## Signing in

Nothing to configure. The first tool call that needs Onshape starts a sign-in
and asks your client to show you the link; clients that support MCP's URL
elicitation render it as a prompt, and the rest get the URL in the reply. The
page that opens links straight to the key page for your Onshape stack and takes
the pasted pair; tick **Read**, **Write** and **Delete** when you create the key
so every tool here works. Keys are verified against Onshape, then stored in your
OS keychain.

Your credentials never pass through the assistant, the model or this project's
authors — the exchange happens between your browser and a server bound to
`127.0.0.1` in this process, which is exactly why MCP has URL elicitation.

Other ways in, if you prefer:

- **`onshape_login`** — start the same flow deliberately.
- **`onshape_set_api_key`** — paste a key pair you already have.
- **OAuth 2.0** — `onshape_login` with `method: "oauth"`, for an app you
  registered at the [Onshape developer portal](https://cad.onshape.com/appstore/dev-portal)
  with redirect URL `http://localhost:8471/oauth/callback`. Tokens refresh
  automatically.
- **Environment variables** — set `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY`
  for unattended installs, and `ONSHAPE_MCP_AUTO_LOGIN=0` to stop the server
  ever opening a browser.

An existing [`onshape-cli`](https://github.com/am-will/onshape-cli) credential at
`~/.onshape/credentials.json` is picked up automatically.

`onshape_auth_status` shows what is in use (redacted); `onshape_logout` forgets it.

## Tools

| Area | Tools |
| --- | --- |
| Sign-in | `login`, `login_status`, `set_api_key`, `auth_status`, `logout` |
| Documents | `list_documents`, `search_documents`, `get_document`, `get_document_summary`, `create_document`, `update_document`, `delete_document`, `get_workspaces`, `get_elements`, `find_part_studios`, `list_versions`, `create_version`, `delete_element` |
| Part studios | `create_part_studio`, `get_features`, `get_feature_specs`, `get_sketch_info`, `get_body_details`, `get_parts`, `mass_properties`, `measure`, `validate_part_studio`, `add_feature`, `update_feature`, `delete_feature`, `rollback`, `eval_featurescript` |
| Sketching | `sketch_rectangle`, `sketch_circle`, `sketch_line`, `sketch_circle_axis`, `create_sketch`, `sketch_candy_cane_path` |
| Solids | `extrude`, `hole`, `thicken`, `revolve`, `sweep`, `fillet`, `chamfer`, `shell`, `draft`, `boolean`, `boolean_union`, `mirror`, `linear_pattern`, `circular_pattern`, `offset_plane` |
| Geometry | `get_edges`, `find_circular_edges`, `find_edges_by_feature` |
| Variables | `get_variables`, `set_variable`, `get_configuration`, `encode_configuration` |
| Export | `export_stl`, `export`, `shaded_view`, `get_thumbnail`, `thumbnail_info` |
| Assemblies | `create_assembly`, `get_assembly`, `insert_instance`, `delete_instance`, `transform_instance`, `get_assembly_features`, `assembly_mate_connector`, `assembly_mate`, `assembly_group`, `assembly_add_feature`, `get_bom`, `assembly_mass_properties` |
| Drawings | `create_drawing`, `get_drawing_views`, `export_drawing` |
| Feature studios | `create_feature_studio`, `get_feature_studio`, `set_feature_studio`, `get_feature_studio_specs` |
| Metadata | `get_metadata`, `set_metadata` |
| Escape hatch | `request` |

All names are prefixed `onshape_`, and every tool returns `{"ok": true, "result": …}`
or `{"ok": false, "error": …, "detail": …}`.

Worth knowing:

- **Units are inches and degrees** throughout.
- **Feature tools validate by default.** Onshape answers `200` for a feature
  that fails to regenerate, so each tool re-reads the feature state and fails
  loudly instead. Pass `validate: false` to skip it.
- **Renders come back as images.** `shaded_view` and `get_thumbnail` return the
  PNG inline as well as writing it, so the model can see the part.
- **Big reads spill to disk.** Anything over `ONSHAPE_MCP_MAX_RESPONSE_BYTES`
  (default 200 kB) is written to a file and summarised, keeping a feature tree
  from swallowing the context window.
- `onshape_request` reaches any REST endpoint the dedicated tools miss.

## Configuration

Every setting is optional.

| Variable | Effect |
| --- | --- |
| `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` | Use this key pair instead of signing in |
| `ONSHAPE_BASE_URL` | Onshape API host (default `https://cad.onshape.com`) |
| `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET` | OAuth app to sign in with, instead of an API key |
| `ONSHAPE_MCP_AUTO_LOGIN` | `0` stops tool calls from starting a browser sign-in |
| `ONSHAPE_MCP_NO_BROWSER` | `1` never launches a browser; the URL is reported instead |
| `ONSHAPE_MCP_SIGNIN_WAIT_MS` | How long a call waits for sign-in (default 120000) |
| `ONSHAPE_DOC`, `ONSHAPE_WS`, `ONSHAPE_ELEM` | Default target; these arguments become optional when set |
| `ONSHAPE_MCP_OUTPUT_DIR` | Where relative export paths land (default: working directory) |
| `ONSHAPE_MCP_MAX_RESPONSE_BYTES` | Response size before spilling to a file (default 200000) |
| `ONSHAPE_MCP_CONFIG` | Credential file path (default `~/.onshape-mcp/credentials.json`) |
| `ONSHAPE_TIMEOUT_MS` | Per-request timeout (default 120000) |

Secrets go to the OS keychain (service `onshape-mcp`) when one is available, and
the config file then holds only non-secret metadata. Without a keychain the file
holds the secret and is written `0600` inside a `0700` directory.

## Onshape account limits

These come from Onshape, not from this server:

- **Free accounts can only create public documents** — pass `public: true` to
  `onshape_create_document`.
- **Deleting needs a key with delete permission.** Without it Onshape answers
  `403 Invalid API key state`; re-create the key at
  [cad.onshape.com/user/developer/apiKeys](https://cad.onshape.com/user/developer/apiKeys)
  with Delete ticked.
- **The variable-table endpoint 404s on some accounts.** `onshape_set_variable`
  and `onshape_get_variables` fall back to `assignVariable` features, which work
  everywhere; `result.route` / `result.source` says which path was taken.

## Development

```bash
npm install
npm run check     # type-check
npm test          # unit tests, no network and no browser
npm run build
npm run bundle    # build the Claude Desktop .mcpb

node scripts/smoke.mjs           # live read-only check against your account
node scripts/smoke.mjs --write   # also builds a throwaway part
```

Layout: `src/auth` (credential store, keychain, login flows, OAuth, elicitation),
`src/api` (REST wrappers), `src/builders` (Onshape BTM feature payloads),
`src/tools` (the MCP surface), `src/server.ts` (registration and the auth gate).

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports:
[SECURITY.md](SECURITY.md).

## Licence

MIT. Portions derived from [`onshape-cli`](https://github.com/am-will/onshape-cli)
— see [NOTICE](NOTICE).

Not affiliated with, endorsed by, or supported by Onshape or PTC. "Onshape" is a
trademark of PTC Inc.
