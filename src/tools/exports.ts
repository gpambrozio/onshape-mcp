/** Exports and renders. Files land in ONSHAPE_MCP_OUTPUT_DIR (or the server's
 *  working directory) unless an absolute path is given. Renders come back as an
 *  image as well as a file, so the model can actually look at the model. */

import { z } from "zod";

import type { WrittenFile } from "../api/export.js";
import type { ToolContext } from "./context.js";
import { ok, requireTarget, targetShape, toolError } from "./shapes.js";
import type { ToolDef, ToolResult } from "./types.js";

/** Bigger than this and the image is left on disk only; base64 in a transcript
 *  is expensive and a CAD render this large is rarely worth it. */
const MAX_INLINE_IMAGE_BYTES = 1_500_000;

const configurationShape = z.string().optional().describe("Encoded configuration string.");
const kindShape = z
  .enum(["partstudios", "assemblies"])
  .optional()
  .describe("Element kind being exported (default partstudios).");

export const exportTools: ToolDef[] = [
  {
    name: "onshape_export_stl",
    title: "Export STL",
    description: "Export the Part Studio as STL, for 3D printing. Measure the model before exporting it.",
    inputSchema: {
      ...targetShape,
      out: z.string().optional().describe("Output file path (default onshape-<timestamp>.stl in the output directory)."),
      ascii: z.boolean().optional().describe("Write ASCII STL instead of binary."),
      resolution: z.enum(["coarse", "medium", "fine"]).optional().describe("Tessellation quality (default medium)."),
      units: z.enum(["inch", "foot", "meter", "centimeter", "millimeter"]).optional().describe("STL units (default inch)."),
      configuration: configurationShape,
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const out = outputPath(ctx, args.out, "stl");
        const written = await ctx.api().exports.exportStl(t.doc, t.ws, t.elem, out, {
          binary: !args.ascii,
          resolution: args.resolution ?? "medium",
          units: args.units,
          configuration: args.configuration,
        });
        return ok(ctx, describe(written));
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_export",
    title: "Export CAD format",
    description:
      "Export through Onshape's translation service: STEP, IGES, 3MF, PARASOLID, SOLIDWORKS and others. Slower than " +
      "STL because the translation is queued server-side.",
    inputSchema: {
      ...targetShape,
      out: z.string().optional().describe("Output file path (default onshape-<timestamp>.<format> in the output directory)."),
      format: z.string().optional().describe("Format name, e.g. STEP, IGES, 3MF, PARASOLID (default STEP)."),
      kind: kindShape,
      configuration: configurationShape,
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const format = (args.format ?? "STEP") as string;
        const out = outputPath(ctx, args.out, format.toLowerCase());
        const written = await ctx.api().exports.exportTranslation(t.doc, t.ws, t.elem, out, {
          formatName: format,
          elementKind: args.kind ?? "partstudios",
          configuration: args.configuration,
        });
        return ok(ctx, { ...describe(written), format });
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_shaded_view",
    title: "Render the model",
    description:
      "Render the element server-side and return the image. Unlike a thumbnail this is generated on demand, so it " +
      "always shows the current geometry — use it to check a model visually before exporting.",
    inputSchema: {
      ...targetShape,
      out: z.string().optional().describe("Output PNG path (default onshape-<timestamp>.png in the output directory)."),
      kind: kindShape,
      width: z.number().int().min(16).max(2000).optional().describe("Image width in pixels (default 600)."),
      height: z.number().int().min(16).max(2000).optional().describe("Image height in pixels (default 340)."),
      view_matrix: z
        .string()
        .optional()
        .describe("3x4 row-major camera matrix as 12 comma-separated numbers (default isometric)."),
      no_edges: z.boolean().optional().describe("Hide edges in the render."),
      configuration: configurationShape,
      return_image: z.boolean().optional().describe("Also return the PNG inline (default true)."),
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const out = outputPath(ctx, args.out, "png");
        const written = await ctx.api().exports.shadedView(t.doc, t.ws, t.elem, out, {
          elementKind: args.kind ?? "partstudios",
          width: args.width,
          height: args.height,
          viewMatrix: args.view_matrix,
          showEdges: !args.no_edges,
          configuration: args.configuration,
        });
        return withImage(ctx, written, args.return_image !== false);
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_get_thumbnail",
    title: "Download the element thumbnail",
    description:
      "Save Onshape's stored thumbnail. Thumbnails are generated asynchronously and lag edits — prefer " +
      "onshape_shaded_view to see the current state.",
    inputSchema: {
      ...targetShape,
      out: z.string().optional().describe("Output PNG path (default onshape-thumb-<timestamp>.png)."),
      size: z.string().optional().describe('Thumbnail size, e.g. "600x340" or "300x300" (default 600x340).'),
      return_image: z.boolean().optional().describe("Also return the PNG inline (default true)."),
    },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        const out = outputPath(ctx, args.out, "png", "onshape-thumb");
        const written = await ctx.api().exports.getThumbnail(t.doc, t.ws, t.elem, out, { size: args.size });
        return withImage(ctx, written, args.return_image !== false);
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_thumbnail_info",
    title: "List thumbnail sizes",
    description: "The thumbnail sizes Onshape has rendered for this element, with their hrefs.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: async (args, ctx) => {
      try {
        const t = requireTarget(args);
        return ok(ctx, await ctx.api().exports.thumbnailInfo(t.doc, t.ws, t.elem));
      } catch (error) {
        return toolError(error);
      }
    },
  },
];

function outputPath(ctx: ToolContext, requested: string | undefined, extension: string, prefix = "onshape"): string {
  return ctx.resolveOutputPath(requested ?? `${prefix}-${Date.now()}.${extension}`);
}

function describe(written: WrittenFile): Record<string, unknown> {
  return { written: written.path, bytes: written.bytes };
}

function withImage(ctx: ToolContext, written: WrittenFile, inline: boolean): ToolResult {
  const extra =
    inline && written.bytes <= MAX_INLINE_IMAGE_BYTES
      ? [{ type: "image" as const, data: written.buffer.toString("base64"), mimeType: "image/png" }]
      : [];
  return ok(ctx, describe(written), extra);
}
