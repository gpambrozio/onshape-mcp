/** Escape hatch for Onshape endpoints this server has no dedicated tool for. */

import { z } from "zod";

import { ok, toolError } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const requestTools: ToolDef[] = [
  {
    name: "onshape_request",
    title: "Call any Onshape REST endpoint",
    description:
      "Make an authenticated request to an arbitrary Onshape REST endpoint, for anything the dedicated tools do not " +
      "cover. Paths start with /api/ and are documented at https://cad.onshape.com/glassworks/explorer. Prefer a " +
      "dedicated tool when one exists — they normalise the response and validate the result.",
    inputSchema: {
      method: z.enum(["GET", "POST", "DELETE"]).describe("HTTP method."),
      path: z
        .string()
        .min(1)
        .describe("API path, e.g. /api/v6/documents/d/{did}/w/{wid}/elements. Must begin with /api/."),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query string parameters."),
      body: z.any().optional().describe("JSON request body, for POST."),
    },
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      try {
        const path = String(args.path);
        if (!path.startsWith("/api/")) {
          throw new Error(`path must begin with /api/, got '${path}'.`);
        }
        const client = ctx.api().client;
        switch (args.method) {
          case "GET":
            return ok(ctx, await client.get(path, args.params));
          case "POST":
            return ok(ctx, await client.post(path, args.body));
          case "DELETE":
            return ok(ctx, await client.delete(path));
          default:
            throw new Error(`Unsupported method '${String(args.method)}'.`);
        }
      } catch (error) {
        return toolError(error);
      }
    },
  },
];
