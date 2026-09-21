/** Sketching tools. Every coordinate is in inches. */

import { z } from "zod";

import { parsePoint2 } from "../builders/params.js";
import {
  buildCandyCanePathSketch,
  buildCircleAxisSketch,
  buildCircleSketch,
  buildLineSketch,
  buildRectangleSketch,
  buildSketchFromEntities,
} from "../builders/sketch.js";
import { addPartStudioFeature } from "./feature-helpers.js";
import { nameShape, point2Shape, targetShape, validateShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

const planeShape = z.enum(["Front", "Top", "Right"]).optional().describe("Default plane to sketch on (default Front).");
const planeFeatureShape = z
  .string()
  .optional()
  .describe("Sketch on a face created by this feature id instead of a default plane.");

const sketchBase = { ...targetShape, plane: planeShape, plane_feature: planeFeatureShape, ...validateShape };

export const sketchTools: ToolDef[] = [
  {
    name: "onshape_sketch_rectangle",
    title: "Sketch a rectangle",
    description: "Add a sketch holding one closed rectangle, ready to extrude. Corners are opposite, in inches.",
    inputSchema: {
      ...sketchBase,
      name: nameShape("Sketch"),
      corner1: point2Shape("First corner."),
      corner2: point2Shape("Opposite corner."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildRectangleSketch({
          name: args.name ?? "Sketch",
          plane: args.plane ?? "Front",
          planeFeatureId: args.plane_feature,
          corner1: parsePoint2(args.corner1),
          corner2: parsePoint2(args.corner2),
        }),
      ),
  },
  {
    name: "onshape_sketch_circle",
    title: "Sketch a circle",
    description: "Add a sketch holding one circle.",
    inputSchema: {
      ...sketchBase,
      name: nameShape("Sketch circle"),
      center: point2Shape("Circle centre."),
      radius: z.number().positive().describe("Radius in inches."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildCircleSketch({
          name: args.name ?? "Sketch circle",
          plane: args.plane ?? "Front",
          planeFeatureId: args.plane_feature,
          center: parsePoint2(args.center),
          radius: args.radius,
        }),
      ),
  },
  {
    name: "onshape_sketch_line",
    title: "Sketch a line",
    description: "Add a sketch holding one line segment. A line alone encloses no region, so it cannot be extruded.",
    inputSchema: {
      ...sketchBase,
      name: nameShape("Sketch"),
      start: point2Shape("Start point."),
      end: point2Shape("End point."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildLineSketch({
          name: args.name ?? "Sketch",
          plane: args.plane ?? "Front",
          planeFeatureId: args.plane_feature,
          start: parsePoint2(args.start),
          end: parsePoint2(args.end),
        }),
      ),
  },
  {
    name: "onshape_sketch_circle_axis",
    title: "Sketch a circle with a revolve axis",
    description:
      "Add a sketch with a circle profile and a construction line. onshape_revolve spins the profile around that " +
      "construction line, which is how you get a torus or a ring.",
    inputSchema: {
      ...targetShape,
      ...validateShape,
      plane: planeShape,
      name: nameShape("Sketch circle and axis"),
      center: point2Shape("Circle centre."),
      radius: z.number().positive().describe("Radius in inches."),
      axis_start: point2Shape("Axis start."),
      axis_end: point2Shape("Axis end."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildCircleAxisSketch({
          name: args.name ?? "Sketch circle and axis",
          plane: args.plane ?? "Front",
          center: parsePoint2(args.center),
          radius: args.radius,
          axisStart: parsePoint2(args.axis_start),
          axisEnd: parsePoint2(args.axis_end),
        }),
      ),
  },
  {
    name: "onshape_create_sketch",
    title: "Sketch arbitrary entities",
    description:
      "Add a sketch from a list of entities: lines, circles, rectangles and arcs. Use this when the single-shape " +
      "sketch tools cannot express the profile. Close the profile if you intend to extrude it.",
    inputSchema: {
      ...sketchBase,
      name: nameShape("Sketch"),
      entities: z
        .array(
          z.object({
            type: z.enum(["line", "circle", "rectangle", "arc"]),
            construction: z.boolean().optional().describe("Construction geometry: guides the model, makes no region."),
            start: z.any().optional().describe("Line start [x, y]."),
            end: z.any().optional().describe("Line end [x, y]."),
            center: z.any().optional().describe("Circle or arc centre [x, y]."),
            radius: z.number().optional().describe("Circle or arc radius, inches."),
            corner1: z.any().optional().describe("Rectangle corner [x, y]."),
            corner2: z.any().optional().describe("Opposite rectangle corner [x, y]."),
            start_angle: z.number().optional().describe("Arc start angle in degrees, counter-clockwise from +X."),
            end_angle: z.number().optional().describe("Arc end angle in degrees."),
          }),
        )
        .min(1)
        .describe("Entities making up the sketch."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildSketchFromEntities({
          name: args.name ?? "Sketch",
          plane: args.plane ?? "Front",
          planeFeatureId: args.plane_feature,
          entities: (args.entities as Array<Record<string, any>>).map((entity) => ({
            ...entity,
            startAngle: entity.start_angle,
            endAngle: entity.end_angle,
          })) as never,
        }),
      ),
  },
  {
    name: "onshape_sketch_candy_cane_path",
    title: "Sketch a hooked sweep path",
    description:
      "Add a sketch of a straight stem joined to a hooked arc, approximated by segments — a ready-made path for " +
      "onshape_sweep.",
    inputSchema: {
      ...targetShape,
      ...validateShape,
      plane: planeShape,
      name: nameShape("Candy cane centerline"),
      x: z.number().optional().describe("X position of the stem (default 0)."),
      bottom: z.number().optional().describe("Y of the stem's bottom (default 0)."),
      straight_height: z.number().positive().describe("Length of the straight stem, inches."),
      hook_radius: z.number().positive().describe("Radius of the hook, inches."),
      hook_angle: z.number().optional().describe("Sweep of the hook in degrees (default 210)."),
      segments: z.number().int().min(2).optional().describe("Total segments used to approximate the path (default 24)."),
    },
    handler: (args, ctx) =>
      addPartStudioFeature(ctx, args, () =>
        buildCandyCanePathSketch({
          name: args.name ?? "Candy cane centerline",
          plane: args.plane ?? "Front",
          x: args.x ?? 0,
          bottom: args.bottom ?? 0,
          straightHeight: args.straight_height,
          hookRadius: args.hook_radius,
          hookAngle: args.hook_angle ?? 210,
          segments: args.segments ?? 24,
        }),
      ),
  },
];
