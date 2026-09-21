/** Builds the MCP server and registers every Onshape tool. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { AuthPrompter, PromptOutcome } from "./auth/prompt.js";
import { allTools, ToolContext } from "./tools/index.js";

export const VERSION = "0.1.2";

/** Shown to the model once, so individual tool descriptions can stay short. */
const INSTRUCTIONS = `Drive Onshape CAD through its REST API.

Signing in happens by itself: the first tool call that needs Onshape starts a
browser sign-in and asks the client to put the link in front of the user. Just
call the tool you want. If a call comes back saying sign-in is still pending,
show the user the URL it returns and retry, or poll onshape_login_status.
onshape_set_api_key stores a key pair the user already has.

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
  context.prompter = clientPrompter(server);

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        if (tool.requiresAuth !== false) {
          const auth = await context.ensureAuthenticated();
          if (!auth.ok) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { ok: false, error: auth.message ?? "Onshape sign-in required.", sign_in_url: auth.url ?? null },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }
        return tool.handler(args, context) as Promise<CallToolResult>;
      },
    );
  }

  return server;
}

/** Bridges the credential flows to the connected MCP client's URL elicitation.
 *  Capabilities are only known after the client connects, so every method reads
 *  them at call time. */
function clientPrompter(server: McpServer): AuthPrompter {
  const supportsUrl = (): boolean => Boolean(server.server.getClientCapabilities()?.elicitation?.url);

  return {
    canPrompt: supportsUrl,

    async prompt({ message, url, elicitationId }): Promise<PromptOutcome> {
      if (!supportsUrl()) return "unsupported";
      try {
        const result = await server.server.elicitInput({ mode: "url", message, url, elicitationId });
        return result.action as PromptOutcome;
      } catch {
        // A client that advertises the capability but rejects the request
        // should not break the tool call; fall back to reporting the URL.
        return "unsupported";
      }
    },

    async complete(elicitationId: string): Promise<void> {
      if (!supportsUrl()) return;
      try {
        await server.server.createElicitationCompletionNotifier(elicitationId)();
      } catch {
        // Dismissing the prompt is best effort.
      }
    },
  };
}
