/** Edge discovery — how you find the ids to hand to fillet and chamfer. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { requireTarget, targetShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const geometryTools: ToolDef[] = [
  {
    name: "onshape_get_edges",
    title: "List edges",
    description: "Every edge of every solid body, with its deterministic id, owning body, type and radius (inches).",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().edges.getEdges(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_find_circular_edges",
    title: "Find circular edges",
    description: "Circular edges, optionally only those matching a radius — the usual way to pick hole rims to fillet.",
    inputSchema: {
      ...targetShape,
      radius: z.number().positive().optional().describe("Only return edges with this radius, in inches."),
      tolerance: z.number().positive().optional().describe("Radius match tolerance in inches (default 0.001)."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().edges.findCircularEdges(t.doc, t.ws, t.elem, args.radius, args.tolerance ?? 0.001));
    },
  },
  {
    name: "onshape_find_edges_by_feature",
    title: "Find edges created by a feature",
    description: "Deterministic ids of the edges a given feature created, evaluated by Onshape.",
    inputSchema: { ...targetShape, feature: z.string().min(1).describe("Feature id whose edges you want.") },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().edges.findEdgesByFeature(t.doc, t.ws, t.elem, args.feature));
    },
  },
];
