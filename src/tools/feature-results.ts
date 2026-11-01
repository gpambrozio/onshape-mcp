/** Feature-write replies retain the acknowledged write and validation outcome.
 * Large API payloads are optional evidence: losing their local file must never
 * make a successful write look retryable, or hide a regeneration failure. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import type { FeatureValidation } from "../api/partstudio.js";
import type { ToolContext } from "./context.js";
import type { ToolResult } from "./types.js";

export interface FeatureWriteSummary {
  featureId: string | null;
  creationApplied?: true;
  updateApplied?: true;
  validation?: FeatureValidation;
  validationSkipped?: true;
}

export function featureWriteResult(
  ctx: ToolContext,
  summary: FeatureWriteSummary,
  response: unknown,
  validationError?: string,
): ToolResult {
  const failed = validationError !== undefined;
  const envelope = (detail: unknown) => failed
    ? { ok: false, error: validationError, detail }
    : { ok: true, result: detail };
  const full = JSON.stringify(envelope({ ...summary, response }), null, 2);
  const bytes = Buffer.byteLength(full, "utf8");
  let text = full;
  if (bytes > ctx.maxResponseBytes) {
    const metadata: Record<string, unknown> = { truncated: true, bytes };
    try {
      // Concurrent replies must not overwrite each other's evidence files.
      const path = ctx.resolveOutputPath(`onshape-response-${randomUUID()}.json`);
      writeFileSync(path, full, { flag: "wx" });
      metadata.saved_to = path;
    } catch (error) {
      metadata.responseStorageError = error instanceof Error ? error.message : String(error);
    }
    // Keep this small acknowledgement inline even if the configured budget is
    // smaller than the summary. Only the verbose API response is discarded.
    text = JSON.stringify({ ...envelope(summary), ...metadata }, null, 2);
  }
  return { ...(failed ? { isError: true } : {}), content: [{ type: "text", text }] };
}
