/** Argument shapes shared across tools, plus the JSON envelope every tool returns.
 *
 * Document/workspace/element ids are required unless ONSHAPE_DOC / ONSHAPE_WS /
 * ONSHAPE_ELEM are set in the server's environment, in which case they become
 * optional and default to those values. The schema is built once at startup, so
 * the model sees exactly which ids it must supply. */

import { writeFileSync } from "node:fs";
import { z } from "zod";

import { HttpError } from "../api/client.js";
import { FeatureScriptError } from "../api/fsvalue.js";
import { CredentialError } from "../auth/types.js";
import type { ToolContext } from "./context.js";
import type { ToolResult } from "./types.js";

const ENV_DOC = process.env.ONSHAPE_DOC;
const ENV_WS = process.env.ONSHAPE_WS;
const ENV_ELEM = process.env.ONSHAPE_ELEM;

function idField(description: string, fallback?: string) {
  const base = z.string().min(1).describe(fallback ? `${description} Defaults to ${fallback}.` : description);
  return fallback ? base.optional() : base;
}

export const docShape = {
  doc: idField("Document id — the <doc> in cad.onshape.com/documents/<doc>/w/<ws>/e/<elem>.", ENV_DOC),
};

export const docWsShape = {
  ...docShape,
  ws: idField("Workspace id — the <ws> segment of the document URL.", ENV_WS),
};

export const targetShape = {
  ...docWsShape,
  elem: idField("Element id (tab) — the <elem> segment of the document URL.", ENV_ELEM),
};

export interface Target {
  doc: string;
  ws: string;
  elem: string;
}

export function requireDoc(args: Record<string, any>): string {
  const doc = args.doc ?? ENV_DOC;
  if (!doc) throw new Error("Missing 'doc' (document id).");
  return String(doc);
}

export function requireDocWs(args: Record<string, any>): Omit<Target, "elem"> {
  const ws = args.ws ?? ENV_WS;
  if (!ws) throw new Error("Missing 'ws' (workspace id).");
  return { doc: requireDoc(args), ws: String(ws) };
}

export function requireTarget(args: Record<string, any>): Target {
  const elem = args.elem ?? ENV_ELEM;
  if (!elem) throw new Error("Missing 'elem' (element id).");
  return { ...requireDocWs(args), elem: String(elem) };
}

/** How a tool names edges or faces to operate on. */
export const selectionShape = {
  edges: z.array(z.string()).optional().describe("Explicit deterministic edge ids, from onshape_get_edges."),
  query: z
    .string()
    .optional()
    .describe('FeatureScript query, e.g. query = qCreatedBy(makeId("FID"), EntityType.EDGE);'),
  feature: z.string().optional().describe("Select every edge created by this feature id."),
  all: z.boolean().optional().describe("Select all edges of all solid bodies."),
  circular: z.boolean().optional().describe("Select only circular edges."),
};

export function selectionFrom(args: Record<string, any>) {
  return {
    edgeIds: args.edges as string[] | undefined,
    queryString: args.query as string | undefined,
    featureId: args.feature as string | undefined,
    selectAll: Boolean(args.all),
    circular: Boolean(args.circular),
  };
}

export const nameShape = (fallback: string) =>
  z.string().optional().describe(`Feature name shown in the tree (default "${fallback}").`);

export const operationShape = z
  .enum(["NEW", "ADD", "REMOVE", "INTERSECT"])
  .optional()
  .describe("NEW makes a new body; ADD/REMOVE/INTERSECT combine with existing bodies (default NEW).");

export const point2Shape = (description: string) =>
  z.union([z.tuple([z.number(), z.number()]), z.string()]).describe(`${description} As [x, y] inches or "x,y".`);

export const validateShape = {
  validate: z
    .boolean()
    .optional()
    .describe("Re-read the feature list afterwards and fail if the feature regenerated with an error (default true)."),
};

/** Successful result: {"ok": true, "result": ...}, matching the onshape-cli contract. */
export function ok(ctx: ToolContext, result: unknown, extra: ToolResult["content"] = []): ToolResult {
  const text = JSON.stringify({ ok: true, result }, null, 2);
  if (text.length > ctx.maxResponseBytes) return spill(ctx, text, result, extra);
  return { content: [{ type: "text", text }, ...extra] };
}

export function fail(error: string, detail?: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, error, detail: detail ?? null }, null, 2) }],
  };
}

/** Map the error types the API layer throws onto the failure envelope. */
export function toolError(error: unknown): ToolResult {
  if (error instanceof HttpError) return fail(`HTTP ${error.status}`, error.detail);
  if (error instanceof FeatureScriptError) return fail(error.message, error.notices);
  if (error instanceof CredentialError) return fail(error.message);
  if (error instanceof Error) return fail(error.message);
  return fail(String(error));
}

/** Feature lists and body details can run to megabytes. Keep the transcript
 *  usable by writing the payload next to the user's other exports. */
function spill(ctx: ToolContext, text: string, result: unknown, extra: ToolResult["content"]): ToolResult {
  const path = ctx.resolveOutputPath(`onshape-response-${Date.now()}.json`);
  try {
    writeFileSync(path, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Response of ${text.length} bytes exceeds the limit and could not be written to disk: ${message}`);
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: true,
            truncated: true,
            bytes: text.length,
            saved_to: path,
            keys: Array.isArray(result) ? `array of ${result.length}` : Object.keys(result as object ?? {}),
            hint: "Full JSON written to saved_to; read it with a file tool or narrow the query.",
          },
          null,
          2,
        ),
      },
      ...extra,
    ],
  };
}
