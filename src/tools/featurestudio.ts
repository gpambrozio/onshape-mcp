/** Feature Studios — custom FeatureScript features living in the document. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { docWsShape, requireDocWs, requireTarget, targetShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const featureStudioTools: ToolDef[] = [
  {
    name: "onshape_create_feature_studio",
    title: "Create a Feature Studio",
    description: "Add a Feature Studio tab for custom FeatureScript.",
    inputSchema: { ...docWsShape, name: z.string().min(1).describe("Tab name.") },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().featureStudios.create(doc, ws, args.name));
    },
  },
  {
    name: "onshape_get_feature_studio",
    title: "Read a Feature Studio",
    description: "The FeatureScript source of a Feature Studio.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().featureStudios.getContents(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_set_feature_studio",
    title: "Write a Feature Studio",
    description: "Replace the FeatureScript source of a Feature Studio. The whole file is overwritten.",
    inputSchema: { ...targetShape, contents: z.string().describe("The complete new FeatureScript source.") },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().featureStudios.setContents(t.doc, t.ws, t.elem, args.contents));
    },
  },
  {
    name: "onshape_get_feature_studio_specs",
    title: "Get Feature Studio specs",
    description: "The feature specifications a Feature Studio defines, for calling its custom features.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().featureStudios.getSpecs(t.doc, t.ws, t.elem));
    },
  },
];
