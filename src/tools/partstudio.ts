/** Part Studio reads, raw feature editing, measurement and FeatureScript. */

import { z } from "zod";

import { decodeFsValue, featurescriptMessages } from "../api/fsvalue.js";
import { isRecord } from "../api/util.js";
import { addPartStudioFeature, run } from "./feature-helpers.js";
import { docWsShape, fail, ok, requireDocWs, requireTarget, targetShape, toolError, validateShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

const configurationShape = z
  .string()
  .optional()
  .describe("Encoded configuration string from onshape_encode_configuration.");

export const partStudioTools: ToolDef[] = [
  {
    name: "onshape_create_part_studio",
    title: "Create a Part Studio",
    description: "Add a Part Studio tab to a workspace. The new element id is at result.response.id.",
    inputSchema: { ...docWsShape, name: z.string().min(1).describe("Tab name.") },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().partStudios.createPartStudio(doc, ws, args.name));
    },
  },
  {
    name: "onshape_get_features",
    title: "List Part Studio features",
    description:
      "The full feature tree with each feature's id, type, parameters and regeneration state. Large — prefer " +
      "onshape_measure or onshape_get_parts when you only need the result of the tree.",
    inputSchema: { ...targetShape, configuration: configurationShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.getFeatures(t.doc, t.ws, t.elem, args.configuration));
    },
  },
  {
    name: "onshape_get_feature_specs",
    title: "Get feature specifications",
    description:
      "The parameter ids, enum names and defaults Onshape expects for every feature type in this Part Studio. Read " +
      "this before hand-writing a payload for onshape_add_feature.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.getFeatureSpecs(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_get_sketch_info",
    title: "Get sketch geometry",
    description: "Entities and solved geometry for every sketch in a Part Studio, or for one sketch.",
    inputSchema: { ...targetShape, sketch: z.string().optional().describe("Limit to this sketch feature id.") },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.getSketchInfo(t.doc, t.ws, t.elem, args.sketch));
    },
  },
  {
    name: "onshape_get_body_details",
    title: "Get body topology",
    description: "Bodies, faces and edges with their deterministic ids — the source for explicit edge selection.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.getBodyDetails(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_get_parts",
    title: "List parts",
    description: "The parts a Part Studio produces, with part ids for export and assembly insertion.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.getParts(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_mass_properties",
    title: "Get mass properties",
    description: "Volume, mass, centroid and inertia for the Part Studio's bodies.",
    inputSchema: { ...targetShape, configuration: configurationShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.massProperties(t.doc, t.ws, t.elem, args.configuration));
    },
  },
  {
    name: "onshape_measure",
    title: "Measure the model",
    description:
      "Body count, overall bounding box in inches and total volume. Use this to check a model matches its intended " +
      "dimensions before exporting.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.measure(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_validate_part_studio",
    title: "Validate a Part Studio",
    description:
      "Count parts and bodies, and fail when the counts do not match the expectations you pass. A cheap regression " +
      "check after a run of feature edits.",
    inputSchema: {
      ...targetShape,
      expect_parts: z.number().int().min(0).optional().describe("Fail unless the Part Studio has exactly this many parts."),
      expect_bodies: z.number().int().min(0).optional().describe("Fail unless it has exactly this many bodies."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().partStudios.validatePartStudio(t.doc, t.ws, t.elem, {
          parts: args.expect_parts,
          bodies: args.expect_bodies,
        }),
      );
    },
  },
  {
    name: "onshape_add_feature",
    title: "Add a raw feature",
    description:
      "Post a hand-written BTM feature payload to a Part Studio. The escape hatch for feature types this server has " +
      "no dedicated tool for — read onshape_get_feature_specs first.",
    inputSchema: {
      ...targetShape,
      feature: z.record(z.string(), z.any()).describe("The feature JSON, usually a BTFeatureDefinitionCall-1406 envelope."),
      ...validateShape,
    },
    handler: (args, ctx) => addPartStudioFeature(ctx, args, () => args.feature),
  },
  {
    name: "onshape_update_feature",
    title: "Update a feature",
    description: "Replace an existing feature's payload, e.g. to change a dimension. Post the whole feature JSON.",
    inputSchema: {
      ...targetShape,
      feature_id: z.string().min(1).describe("Id of the feature to replace."),
      feature: z.record(z.string(), z.any()).describe("The full replacement feature JSON."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.updateFeature(t.doc, t.ws, t.elem, args.feature_id, args.feature));
    },
  },
  {
    name: "onshape_delete_feature",
    title: "Delete a feature",
    description: "Remove one feature from the tree. Features added after it may fail to regenerate.",
    inputSchema: { ...targetShape, feature_id: z.string().min(1).describe("Id of the feature to delete.") },
    annotations: { destructiveHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.deleteFeature(t.doc, t.ws, t.elem, args.feature_id));
    },
  },
  {
    name: "onshape_rollback",
    title: "Move the rollback bar",
    description: "Set the rollback index so features after it are suppressed. Index 0 rolls back to before the first feature.",
    inputSchema: {
      ...targetShape,
      index: z.number().int().min(0).describe("Rollback index; use a large number to roll fully forward."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.rollback(t.doc, t.ws, t.elem, args.index));
    },
  },
  {
    name: "onshape_eval_featurescript",
    title: "Evaluate FeatureScript",
    description:
      "Run a FeatureScript function against the Part Studio and return its decoded value. The general-purpose way " +
      "to inspect geometry: 'function(context is Context, queries) { ... }'.",
    inputSchema: {
      ...targetShape,
      script: z.string().min(1).describe("A FeatureScript function expression taking (context, queries)."),
      raw: z.boolean().optional().describe("Return Onshape's raw response instead of the decoded value."),
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const response = await ctx.api().partStudios.evaluateFeatureScript(t.doc, t.ws, t.elem, args.script);
        if (args.raw) return ok(ctx, response);

        const messages = featurescriptMessages(response);
        if (!isRecord(response) || response.result === null || response.result === undefined) {
          return fail(String(messages[0]?.message ?? "FeatureScript evaluation failed"), messages);
        }
        const out: Record<string, unknown> = { value: decodeFsValue(response.result) };
        if (response.console) out.console = response.console;
        if (messages.length) out.warnings = messages;
        return ok(ctx, out);
      } catch (error) {
        return toolError(error);
      }
    },
  },
];
