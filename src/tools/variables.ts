/** Part Studio variables and element configurations. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { requireTarget, targetShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const variableTools: ToolDef[] = [
  {
    name: "onshape_get_variables",
    title: "List Part Studio variables",
    description: "The variable table of a Part Studio: names, expressions and descriptions.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().variables.getVariables(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_set_variable",
    title: "Set a Part Studio variable",
    description:
      "Create or update a variable. Feature tools can then reference it by name (depth_variable, radius_variable, " +
      "...) so a dimension lives in one place. Uses the variable table where the account supports it and falls back " +
      "to an assignVariable feature otherwise; result.route says which was used.",
    inputSchema: {
      ...targetShape,
      name: z.string().min(1).describe("Variable name, without the leading #."),
      expression: z.string().min(1).describe('Value expression with units, e.g. "0.25 in" or "2 * #wall".'),
      description: z.string().optional().describe("What the variable means."),
      type: z
        .enum(["LENGTH", "ANGLE", "NUMBER", "ANY"])
        .optional()
        .describe("Variable type; inferred from the expression's units when omitted."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().variables.setVariable(t.doc, t.ws, t.elem, args.name, args.expression, args.description, args.type),
      );
    },
  },
  {
    name: "onshape_get_configuration",
    title: "Get element configuration",
    description: "The configuration parameters an element exposes, with their ids and allowed values.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().configurations.getConfiguration(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_encode_configuration",
    title: "Encode a configuration",
    description:
      "Turn configuration parameter values into the encoded string other tools accept as `configuration`.",
    inputSchema: {
      ...targetShape,
      params: z
        .array(z.object({ parameterId: z.string(), parameterValue: z.string() }))
        .min(1)
        .describe("Parameter ids and the values to set."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().configurations.encodeConfiguration(t.doc, t.elem, args.params));
    },
  },
];
