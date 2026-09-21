/** Assemblies: instances, mates, BOM and transforms. */

import { z } from "zod";

import { buildAssemblyGroup, buildAssemblyMate, buildAssemblyMateConnector } from "../builders/assembly.js";
import { addAssemblyFeature, run } from "./feature-helpers.js";
import { docWsShape, requireDocWs, requireTarget, targetShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

export const assemblyTools: ToolDef[] = [
  {
    name: "onshape_create_assembly",
    title: "Create an assembly",
    description: "Add an assembly tab to a workspace.",
    inputSchema: { ...docWsShape, name: z.string().min(1).describe("Tab name.") },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().assemblies.createAssembly(doc, ws, args.name));
    },
  },
  {
    name: "onshape_get_assembly",
    title: "Get assembly structure",
    description: "The assembly's instances, occurrences, mate features and mate connectors.",
    inputSchema: {
      ...targetShape,
      include_mate_features: z.boolean().optional().describe("Include mate features (default true)."),
      include_mate_connectors: z.boolean().optional().describe("Include mate connectors (default true)."),
      include_non_solids: z.boolean().optional().describe("Include non-solid instances (default false)."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().documents.getAssembly(t.doc, t.ws, t.elem, {
          includeMateFeatures: args.include_mate_features,
          includeMateConnectors: args.include_mate_connectors,
          includeNonSolids: args.include_non_solids,
        }),
      );
    },
  },
  {
    name: "onshape_insert_instance",
    title: "Insert an instance",
    description:
      "Insert a part, a whole Part Studio or another assembly into an assembly. Insert from a version when pulling " +
      "from a different document.",
    inputSchema: {
      ...targetShape,
      src_elem: z.string().min(1).describe("Element id of the source Part Studio or assembly."),
      src_doc: z.string().optional().describe("Source document id (defaults to the target document)."),
      src_version: z.string().optional().describe("Source version id, required when inserting across documents."),
      part: z.string().optional().describe("Part id, to insert a single part."),
      is_assembly: z.boolean().optional().describe("The source element is an assembly."),
      whole_studio: z.boolean().optional().describe("Insert every part of the source Part Studio."),
      configuration: z.string().optional().describe("Encoded configuration for the inserted element."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().assemblies.insertInstance(t.doc, t.ws, t.elem, {
          sourceDocumentId: args.src_doc ?? t.doc,
          sourceElementId: args.src_elem,
          partId: args.part,
          sourceVersionId: args.src_version,
          isAssembly: args.is_assembly,
          isWholePartStudio: args.whole_studio,
          configuration: args.configuration,
        }),
      );
    },
  },
  {
    name: "onshape_delete_instance",
    title: "Delete an instance",
    description: "Remove one instance from an assembly by its occurrence node id.",
    inputSchema: { ...targetShape, node: z.string().min(1).describe("Occurrence node id of the instance.") },
    annotations: { destructiveHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().assemblies.deleteInstance(t.doc, t.ws, t.elem, args.node));
    },
  },
  {
    name: "onshape_transform_instance",
    title: "Transform instances",
    description: "Apply a 4x4 row-major transform (16 numbers, metres) to the given occurrence paths.",
    inputSchema: {
      ...targetShape,
      paths: z.array(z.array(z.string())).min(1).describe("Occurrence paths, each an array of node ids."),
      transform: z.array(z.number()).length(16).describe("Row-major 4x4 transform matrix."),
      absolute: z.boolean().optional().describe("Treat the transform as absolute rather than relative."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().assemblies.transformOccurrences(t.doc, t.ws, t.elem, args.paths, args.transform, {
          isRelative: !args.absolute,
        }),
      );
    },
  },
  {
    name: "onshape_get_assembly_features",
    title: "List assembly features",
    description: "The mates, mate connectors and groups defined in an assembly, with their feature ids.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().assemblies.getFeatures(t.doc, t.ws, t.elem));
    },
  },
  {
    name: "onshape_assembly_mate_connector",
    title: "Add a mate connector",
    description:
      "Place an implicit mate connector on an instance by inference (CENTROID, TOP, ...). Its feature id is what " +
      "onshape_assembly_mate then joins.",
    inputSchema: {
      ...targetShape,
      occurrence: z.string().min(1).describe("Occurrence id of the instance to attach to."),
      name: z.string().optional().describe('Feature name (default "Mate connector").'),
      inference: z.string().optional().describe("Inference type, e.g. CENTROID, TOP, MID_PLANE (default CENTROID)."),
    },
    handler: (args, ctx) =>
      addAssemblyFeature(ctx, args, () =>
        buildAssemblyMateConnector({
          name: args.name,
          occurrenceId: args.occurrence,
          inferenceType: args.inference,
        }),
      ),
  },
  {
    name: "onshape_assembly_mate",
    title: "Add a mate",
    description: "Join two or more mate connectors with a mate: FASTENED, REVOLUTE, SLIDER, PLANAR, and so on.",
    inputSchema: {
      ...targetShape,
      connectors: z.array(z.string()).min(2).describe("Feature ids of the mate connectors to join."),
      type: z.string().optional().describe("Mate type (default FASTENED)."),
      name: z.string().optional().describe('Feature name (default "Mate").'),
    },
    handler: (args, ctx) =>
      addAssemblyFeature(ctx, args, () =>
        buildAssemblyMate({ name: args.name, mateType: args.type, mateConnectorIds: args.connectors }),
      ),
  },
  {
    name: "onshape_assembly_group",
    title: "Group instances",
    description: "Lock several instances together without individual mates.",
    inputSchema: {
      ...targetShape,
      occurrences: z.array(z.string()).min(1).describe("Occurrence ids to group."),
      name: z.string().optional().describe('Feature name (default "Group").'),
    },
    handler: (args, ctx) =>
      addAssemblyFeature(ctx, args, () => buildAssemblyGroup({ name: args.name, occurrenceIds: args.occurrences })),
  },
  {
    name: "onshape_assembly_add_feature",
    title: "Add a raw assembly feature",
    description: "Post a hand-written assembly feature payload — the escape hatch for mate types with no tool here.",
    inputSchema: {
      ...targetShape,
      feature: z.record(z.string(), z.any()).describe("The assembly feature JSON."),
    },
    handler: (args, ctx) => addAssemblyFeature(ctx, args, () => args.feature),
  },
  {
    name: "onshape_get_bom",
    title: "Get the bill of materials",
    description: "The assembly's BOM table.",
    inputSchema: {
      ...targetShape,
      multi_level: z.boolean().optional().describe("Expand sub-assemblies (default false)."),
      indented: z.boolean().optional().describe("Return the indented BOM (default true)."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().assemblies.getBom(t.doc, t.ws, t.elem, {
          multiLevel: args.multi_level,
          indented: args.indented,
        }),
      );
    },
  },
  {
    name: "onshape_assembly_mass_properties",
    title: "Get assembly mass properties",
    description: "Mass, volume, centroid and inertia for a whole assembly.",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().assemblies.massProperties(t.doc, t.ws, t.elem));
    },
  },
];
