/** Shared plumbing for the tools that add a feature to a Part Studio or an
 *  assembly: post the payload, pull the new feature id out of the response,
 *  and check that the feature actually regenerated. */

import { isRecord } from "../api/util.js";
import type { Feature } from "../builders/params.js";
import type { ToolContext } from "./context.js";
import { ok, requireTarget, toolError } from "./shapes.js";
import { featureWriteResult, type FeatureWriteSummary } from "./feature-results.js";
import type { ToolResult } from "./types.js";

export function featureIdOf(response: unknown): string | null {
  if (!isRecord(response) || !isRecord(response.feature)) return null;
  const id = response.feature.featureId;
  return typeof id === "string" ? id : null;
}

/** Build a Part Studio feature, post it, and verify it regenerated cleanly.
 *  Onshape answers 200 even when the feature fails to regenerate, so the
 *  follow-up read is what turns a silent failure into an error. */
export async function addPartStudioFeature(
  ctx: ToolContext,
  args: Record<string, any>,
  build: () => Feature,
): Promise<ToolResult> {
  try {
    const target = requireTarget(args);
    const feature = build();
    const api = ctx.api();
    const response = await api.partStudios.addFeature(target.doc, target.ws, target.elem, feature);
    const featureId = featureIdOf(response);
    const summary: FeatureWriteSummary = { featureId, creationApplied: true };

    if (args.validate !== false && !featureId) {
      return featureWriteResult(ctx, summary, response, "Cannot verify regeneration: add-feature response has no featureId.");
    }
    if (args.validate !== false && featureId) {
      try {
        summary.validation = await api.partStudios.validateFeature(target.doc, target.ws, target.elem, featureId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return featureWriteResult(ctx, summary, response, message);
      }
    }
    if (args.validate === false) summary.validationSkipped = true;
    return featureWriteResult(ctx, summary, response);
  } catch (error) {
    return toolError(error);
  }
}

export async function addAssemblyFeature(
  ctx: ToolContext,
  args: Record<string, any>,
  build: () => Feature,
): Promise<ToolResult> {
  try {
    const target = requireTarget(args);
    const response = await ctx.api().assemblies.addFeature(target.doc, target.ws, target.elem, build());
    return ok(ctx, { featureId: featureIdOf(response), response });
  } catch (error) {
    return toolError(error);
  }
}

/** Wrap a plain read/write call in the standard envelope. */
export async function run(ctx: ToolContext, action: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(ctx, await action());
  } catch (error) {
    return toolError(error);
  }
}
