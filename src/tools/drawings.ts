/** Drawings. A drawing references its source by version, so create a version first. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { docWsShape, ok, requireDocWs, requireTarget, targetShape, toolError } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const drawingTools: ToolDef[] = [
  {
    name: "onshape_create_drawing",
    title: "Create a drawing",
    description:
      "Create a drawing of a part, Part Studio or assembly. The source must be referenced by version — call " +
      "onshape_create_version first and pass its id as src_version.",
    inputSchema: {
      ...docWsShape,
      name: z.string().min(1).describe("Drawing name."),
      src_elem: z.string().min(1).describe("Element id being drawn."),
      src_version: z.string().min(1).describe("Version id of the source element."),
      src_doc: z.string().optional().describe("Source document id (defaults to the target document)."),
      part: z.string().optional().describe("Part id, to draw a single part."),
    },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () =>
        ctx.api().drawings.createDrawing(doc, ws, {
          name: args.name,
          sourceElementId: args.src_elem,
          sourceVersionId: args.src_version,
          sourceDocumentId: args.src_doc,
          partId: args.part,
        }),
      );
    },
  },
  {
    name: "onshape_get_drawing_views",
    title: "List drawing views",
    description: "The views placed on a drawing sheet.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().drawings.getViews(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_export_drawing",
    title: "Export a drawing",
    description: "Export a drawing as PDF (or DWG/DXF) through the translation service.",
    inputSchema: {
      ...targetShape,
      out: z.string().optional().describe("Output file path (default onshape-drawing-<timestamp>.<format>)."),
      format: z.string().optional().describe("Format name: PDF, DWG, DXF (default PDF)."),
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const format = (args.format ?? "PDF") as string;
        const out = ctx.resolveOutputPath(args.out ?? `onshape-drawing-${Date.now()}.${format.toLowerCase()}`);
        const written = await ctx.api().exports.exportTranslation(t.doc, t.ws, t.elem, out, {
          formatName: format,
          elementKind: "drawings",
        });
        return ok(ctx, { written: written.path, bytes: written.bytes, format });
      } catch (error) {
        return toolError(error);
      }
    },
  },
];
