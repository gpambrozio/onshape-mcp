/** Shared shapes for the tool registry.
 *
 * Handlers take already-validated arguments as a plain record: the MCP SDK
 * validates each call against the tool's zod schema before we see it, and
 * threading 87 inferred argument types through the registry buys nothing. */

import type { ZodRawShape } from "zod";

import type { ToolContext } from "./context.js";

export interface ToolResultContent {
  [key: string]: unknown;
  type: "text" | "image";
}

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations?: ToolAnnotations;
  /** False for the sign-in tools, which must run without credentials. */
  requiresAuth?: boolean;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}
