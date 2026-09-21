/** Builds the MCP server and registers every Onshape tool. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { allTools, ToolContext } from "./tools/index.js";

export const VERSION = "0.1.0";

/** Shown to the model once, so individual tool descriptions can stay short. */
const INSTRUCTIONS = `Drive Onshape CAD through its REST API.

Signing in: if a tool reports that no credential is configured, call onshape_login.
It opens the user's browser at a local page that walks them through creating an
Onshape API key, then returns status "pending" — poll onshape_login_status until it
reports "complete". onshape_set_api_key stores a key pair the user already has.

Ids: most tools need a document, workspace and element id. They are the three
segments of an Onshape URL: cad.onshape.com/documents/<doc>/w/<ws>/e/<elem>.
onshape_get_document_summary lists every workspace and element of a document.

Units: lengths are inches and angles are degrees everywhere in this server.

Working order that avoids rework:
  1. Search before creating, so repeated runs do not make duplicate documents.
  2. Snapshot with onshape_create_version before restructuring an existing design.
  3. Sketch a single closed profile, then extrude it; capture the returned featureId.
  4. Select edges for fillet/chamfer with a FeatureScript query rather than ids
     where you can — queries survive topology changes.
  5. Check the result with onshape_measure and onshape_shaded_view before exporting.

Feature tools validate by default: they re-read the feature list and fail if the
feature regenerated with an error, because Onshape answers 200 for a feature that
did not build. Read the error detail before retrying.`;

export function createServer(): McpServer {
  const context = new ToolContext();
  const server = new McpServer({ name: "onshape-mcp", version: VERSION }, { instructions: INSTRUCTIONS });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args: Record<string, unknown>) => tool.handler(args, context) as Promise<CallToolResult>,
    );
  }

  return server;
}
