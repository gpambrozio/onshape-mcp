/** Element and part properties. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { requireTarget, targetShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const metadataTools: ToolDef[] = [
  {
    name: "onshape_get_metadata",
    title: "Get element or part metadata",
    description: "Read the properties of an element, or of one part when part is given.",
    inputSchema: { ...targetShape, part: z.string().optional().describe("Part id, to read that part's properties.") },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      const api = ctx.api();
      return run(ctx, () =>
        args.part
          ? api.metadata.getPartMetadata(t.doc, t.ws, t.elem, args.part)
          : api.metadata.getElementMetadata(t.doc, t.ws, t.elem),
      );
    },
  },
  {
    name: "onshape_set_metadata",
    title: "Set element or part metadata",
    description:
      "Write properties such as part number, description or material. Only editable properties are accepted; read " +
      "onshape_get_metadata first to find the property ids.",
    inputSchema: {
      ...targetShape,
      properties: z
        .array(z.object({ propertyId: z.string(), value: z.any() }))
        .min(1)
        .describe("Property ids and their new values."),
      part: z.string().optional().describe("Part id, to set that part's properties instead of the element's."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().metadata.setElementMetadata(t.doc, t.ws, t.elem, args.properties, args.part));
    },
  },
];
