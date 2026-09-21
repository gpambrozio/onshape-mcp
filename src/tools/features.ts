/** Solid features: extrude, revolve, sweep, thicken, booleans, edge treatments,
 *  patterns and construction planes. Lengths are inches, angles degrees. */

import { z } from "zod";

import {
  buildBoolean,
  buildBooleanUnion,
  buildChamfer,
  buildCircularPattern,
  buildDraft,
  buildExtrude,
  buildFillet,
  buildLinearPattern,
  buildMirror,
  buildOffsetPlane,
  buildRevolve,
  buildRevolveAxis,
  buildShell,
  buildSweep,
  buildThicken,
} from "../builders/features.js";
import { addPartStudioFeature } from "./feature-helpers.js";
import {
  nameShape,
  operationShape,
  selectionFrom,
  selectionShape,
  targetShape,
  validateShape,
} from "./shapes.js";
import type { ToolDef } from "./types.js";

const base = { ...targetShape, ...validateShape };

export const featureTools: ToolDef[] = [
  {
    name: "onshape_extrude",
    title: "Extrude a sketch",
    description:
      "Extrude the closed regions of a sketch into a solid. op=NEW makes a body, ADD merges into existing bodies, " +
      "REMOVE cuts them, INTERSECT keeps the overlap.",
    inputSchema: {
      ...base,
      name: nameShape("Extrude"),
      sketch: z.string().min(1).describe("Feature id of the sketch to extrude."),
      depth: z.number().describe("Extrusion depth in inches."),
      depth_variable: z.string().optional().describe("Use a Part Studio variable (by name) for the depth instead."),
      op: operationShape,
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildExtrude({
          name: args.name ?? "Extrude",
          sketchFeatureId: args.sketch,
          depth: args.depth,
          operationType: args.op ?? "NEW",
          depthVariable: args.depth_variable,
        }),
      ),
  },
  {
    name: "onshape_hole",
    title: "Cut a hole",
    description: "Extrude a sketch as a cut (op=REMOVE). Sketch a circle first, then cut it through the body.",
    inputSchema: {
      ...base,
      name: nameShape("Hole"),
      sketch: z.string().min(1).describe("Feature id of the sketch to cut with."),
      depth: z.number().describe("Cut depth in inches; make it deeper than the body to cut through."),
      depth_variable: z.string().optional().describe("Use a Part Studio variable for the depth."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildExtrude({
          name: args.name ?? "Hole",
          sketchFeatureId: args.sketch,
          depth: args.depth,
          operationType: "REMOVE",
          depthVariable: args.depth_variable,
        }),
      ),
  },
  {
    name: "onshape_thicken",
    title: "Thicken a sketch",
    description: "Give a sketch region a wall thickness instead of a solid depth.",
    inputSchema: {
      ...base,
      name: nameShape("Thicken"),
      sketch: z.string().min(1).describe("Feature id of the sketch to thicken."),
      thickness: z.number().positive().describe("Thickness in inches."),
      thickness_variable: z.string().optional().describe("Use a Part Studio variable for the thickness."),
      midplane: z.boolean().optional().describe("Grow symmetrically about the sketch plane."),
      opposite: z.boolean().optional().describe("Thicken in the opposite direction."),
      op: operationShape,
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildThicken({
          name: args.name ?? "Thicken",
          sketchFeatureId: args.sketch,
          thickness: args.thickness,
          operationType: args.op ?? "NEW",
          thicknessVariable: args.thickness_variable,
          midplane: args.midplane,
          opposite: args.opposite,
        }),
      ),
  },
  {
    name: "onshape_revolve",
    title: "Revolve a sketch",
    description:
      "Revolve a sketch profile around an axis. With no axis given, the sketch's own construction line is used " +
      "(see onshape_sketch_circle_axis); otherwise pass axis_ids or an axis query.",
    inputSchema: {
      ...base,
      name: nameShape("Revolve"),
      sketch: z.string().min(1).describe("Feature id of the sketch holding the profile."),
      angle: z.number().optional().describe("Revolve angle in degrees (default 360)."),
      axis_ids: z.array(z.string()).optional().describe("Deterministic ids of the axis entity."),
      axis: z.string().optional().describe("FeatureScript query selecting the axis."),
      type: z.enum(["FULL", "BLIND"]).optional().describe("FULL revolves all the way around (default FULL when an axis is given)."),
      op: operationShape,
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () => {
        const name = args.name ?? "Revolve";
        const operationType = args.op ?? "NEW";
        const angle = args.angle ?? 360;
        if (args.axis_ids?.length || args.axis) {
          return buildRevolveAxis({
            name,
            sketchFeatureId: args.sketch,
            axisIds: args.axis_ids,
            axisQuery: args.axis,
            operationType,
            revolveType: args.type ?? "FULL",
            angle,
          });
        }
        return buildRevolve({ name, sketchFeatureId: args.sketch, angle, operationType });
      }),
  },
  {
    name: "onshape_sweep",
    title: "Sweep a profile along a path",
    description: "Sweep the closed regions of one sketch along the edges of another.",
    inputSchema: {
      ...base,
      name: nameShape("Sweep"),
      profile: z.string().min(1).describe("Feature id of the profile sketch."),
      path: z.string().min(1).describe("Feature id of the path sketch."),
      op: operationShape,
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildSweep({
          name: args.name ?? "Sweep",
          profileSketchFeatureId: args.profile,
          pathSketchFeatureId: args.path,
          operationType: args.op ?? "NEW",
        }),
      ),
  },
  {
    name: "onshape_fillet",
    title: "Fillet edges",
    description:
      "Round the selected edges. Name the edges with one of: edges (ids), query (FeatureScript), feature (every edge " +
      "that feature made), all, or circular.",
    inputSchema: {
      ...base,
      ...selectionShape,
      name: nameShape("Fillet"),
      radius: z.number().positive().optional().describe("Fillet radius in inches (default 0.1)."),
      radius_variable: z.string().optional().describe("Use a Part Studio variable for the radius."),
      type: z.enum(["EDGE", "FULL_ROUND"]).optional().describe("Fillet type (default EDGE)."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildFillet({
          name: args.name ?? "Fillet",
          radius: args.radius,
          radiusVariable: args.radius_variable,
          filletType: args.type,
          ...selectionFrom(args),
        }),
      ),
  },
  {
    name: "onshape_chamfer",
    title: "Chamfer edges",
    description: "Bevel the selected edges. Selection works exactly as for onshape_fillet.",
    inputSchema: {
      ...base,
      ...selectionShape,
      name: nameShape("Chamfer"),
      width: z.number().positive().optional().describe("Chamfer width in inches (default 0.1)."),
      width_variable: z.string().optional().describe("Use a Part Studio variable for the width."),
      type: z
        .enum(["EQUAL_OFFSETS", "TWO_OFFSETS", "OFFSET_ANGLE"])
        .optional()
        .describe("Chamfer type (default EQUAL_OFFSETS)."),
      angle: z.number().optional().describe("Angle in degrees, for type=OFFSET_ANGLE."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildChamfer({
          name: args.name ?? "Chamfer",
          width: args.width,
          widthVariable: args.width_variable,
          chamferType: args.type,
          angle: args.angle,
          ...selectionFrom(args),
        }),
      ),
  },
  {
    name: "onshape_shell",
    title: "Shell a body",
    description: "Hollow the body out to a wall thickness, removing the selected faces to open it.",
    inputSchema: {
      ...base,
      name: nameShape("Shell"),
      thickness: z.number().positive().optional().describe("Wall thickness in inches (default 0.125)."),
      thickness_variable: z.string().optional().describe("Use a Part Studio variable for the thickness."),
      faces: z.array(z.string()).optional().describe("Deterministic ids of faces to remove."),
      query: z.string().optional().describe("FeatureScript query selecting the faces to remove."),
      outward: z.boolean().optional().describe("Thicken outward instead of inward."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildShell({
          name: args.name ?? "Shell",
          thickness: args.thickness,
          thicknessVariable: args.thickness_variable,
          faceIds: args.faces,
          queryString: args.query,
          inward: !args.outward,
        }),
      ),
  },
  {
    name: "onshape_draft",
    title: "Draft faces",
    description: "Taper faces away from a neutral plane — the usual requirement for moulded or cast parts.",
    inputSchema: {
      ...base,
      name: nameShape("Draft"),
      neutral: z.string().min(1).describe("FeatureScript query selecting the neutral plane or face."),
      faces: z.string().min(1).describe("FeatureScript query selecting the faces to draft."),
      angle: z.number().optional().describe("Draft angle in degrees (default 3)."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildDraft({
          name: args.name ?? "Draft",
          angle: args.angle,
          neutralPlaneQuery: args.neutral,
          faceQuery: args.faces,
        }),
      ),
  },
  {
    name: "onshape_boolean",
    title: "Boolean bodies",
    description: "Combine bodies: UNION, SUBTRACTION or INTERSECTION. Subtraction also needs the targets query.",
    inputSchema: {
      ...base,
      name: nameShape("Boolean"),
      op: z.enum(["UNION", "SUBTRACTION", "INTERSECTION"]).optional().describe("Boolean operation (default UNION)."),
      tool_ids: z.array(z.string()).optional().describe("Deterministic ids of the tool bodies."),
      tools: z.string().optional().describe("FeatureScript query selecting the tool bodies."),
      targets: z.string().optional().describe("FeatureScript query selecting the target bodies (SUBTRACTION)."),
      keep_tools: z.boolean().optional().describe("Keep the tool bodies after the operation."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildBoolean({
          name: args.name ?? "Boolean",
          operationType: args.op ?? "UNION",
          toolIds: args.tool_ids,
          toolsQuery: args.tools,
          targetsQuery: args.targets,
          keepTools: args.keep_tools,
        }),
      ),
  },
  {
    name: "onshape_boolean_union",
    title: "Union every body",
    description: "Merge all modifiable solid bodies into one. The usual cleanup before exporting a single part.",
    inputSchema: { ...base, name: nameShape("Union bodies") },
    handler: (args, ctx) => addPartStudioFeature(ctx, args, () => buildBooleanUnion(args.name ?? "Union bodies")),
  },
  {
    name: "onshape_mirror",
    title: "Mirror geometry",
    description: "Mirror parts, bodies or faces across a plane.",
    inputSchema: {
      ...base,
      name: nameShape("Mirror"),
      entities: z.string().min(1).describe("FeatureScript query selecting what to mirror."),
      type: z.enum(["PART", "FACE", "FEATURE"]).optional().describe("What kind of thing is being mirrored (default PART)."),
      plane_ids: z.array(z.string()).optional().describe("Deterministic id of the mirror plane, e.g. JCC for Front."),
      plane_query: z.string().optional().describe("FeatureScript query selecting the mirror plane."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildMirror({
          name: args.name ?? "Mirror",
          patternType: args.type,
          entitiesQuery: args.entities,
          mirrorPlaneIds: args.plane_ids,
          mirrorPlaneQuery: args.plane_query,
        }),
      ),
  },
  {
    name: "onshape_linear_pattern",
    title: "Linear pattern",
    description: "Repeat geometry along a direction, at a fixed spacing.",
    inputSchema: {
      ...base,
      name: nameShape("Linear Pattern"),
      entities: z.string().min(1).describe("FeatureScript query selecting what to pattern."),
      type: z.enum(["PART", "FACE", "FEATURE"]).optional().describe("What kind of thing is patterned (default PART)."),
      direction_ids: z.array(z.string()).optional().describe("Deterministic id of an edge giving the direction."),
      direction: z.string().optional().describe("FeatureScript query selecting the direction entity."),
      distance: z.number().describe("Spacing between instances, inches."),
      count: z.number().int().min(2).describe("Total number of instances, including the original."),
      opposite: z.boolean().optional().describe("Pattern in the opposite direction."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildLinearPattern({
          name: args.name ?? "Linear Pattern",
          patternType: args.type,
          entitiesQuery: args.entities,
          directionIds: args.direction_ids,
          directionQuery: args.direction,
          distance: args.distance,
          instanceCount: args.count,
          opposite: args.opposite,
        }),
      ),
  },
  {
    name: "onshape_circular_pattern",
    title: "Circular pattern",
    description: "Repeat geometry around an axis.",
    inputSchema: {
      ...base,
      name: nameShape("Circular Pattern"),
      entities: z.string().min(1).describe("FeatureScript query selecting what to pattern."),
      type: z.enum(["PART", "FACE", "FEATURE"]).optional().describe("What kind of thing is patterned (default PART)."),
      axis_ids: z.array(z.string()).optional().describe("Deterministic id of the axis entity."),
      axis: z.string().optional().describe("FeatureScript query selecting the axis."),
      count: z.number().int().min(2).describe("Total number of instances, including the original."),
      angle: z.number().optional().describe("Total angle covered, degrees (default 360)."),
      equal_spacing: z.boolean().optional().describe("Space instances evenly over the angle (default true)."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildCircularPattern({
          name: args.name ?? "Circular Pattern",
          patternType: args.type,
          entitiesQuery: args.entities,
          axisIds: args.axis_ids,
          axisQuery: args.axis,
          instanceCount: args.count,
          angle: args.angle,
          equalSpacing: args.equal_spacing,
        }),
      ),
  },
  {
    name: "onshape_offset_plane",
    title: "Create an offset plane",
    description: "Add a construction plane offset from a default plane, a face, or another plane.",
    inputSchema: {
      ...base,
      name: nameShape("Offset plane"),
      base_plane: z.enum(["Front", "Top", "Right"]).optional().describe("Default plane to offset from (default Front)."),
      base_ids: z.array(z.string()).optional().describe("Deterministic ids of the plane or face to offset from."),
      base_query: z.string().optional().describe("FeatureScript query selecting the base plane or face."),
      offset: z.number().optional().describe("Offset distance in inches (default 1)."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildOffsetPlane({
          name: args.name ?? "Offset plane",
          basePlane: args.base_plane,
          basePlaneIds: args.base_ids,
          basePlaneQuery: args.base_query,
          offset: args.offset,
        }),
      ),
  },
];
