/** Assemblies: instances, mates, relations, mate values, BOM and transforms. */

import { z } from "zod";

import type { MateValue, MateValueUpdate } from "../api/assemblies.js";
import {
  buildAssemblyGroup,
  buildAssemblyMate,
  buildAssemblyMateConnector,
  MATE_VALUE_KEYS,
  mateValueField,
  mateValueFromUser,
  mateValueToUser,
  RELATION_TYPES,
  type MateConnectorRef,
} from "../builders/assembly.js";
import { addAssemblyFeature, run, updateAssemblyFeature } from "./feature-helpers.js";
import { docWsShape, requireDocWs, requireTarget, targetShape, validateShape } from "./shapes.js";
import type { ToolDef } from "./types.js";

const featureBase = { ...targetShape, ...validateShape };

const mateConnectorShape = z.union([
  z.string().min(1).describe("Feature id of an assembly-level mate connector."),
  z
    .object({
      path: z
        .array(z.string().min(1))
        .min(1)
        .describe("Occurrence path of the instance that owns the connector, e.g. [instance id]."),
      connector: z
        .string()
        .min(1)
        .describe('Part Studio mate connector id, e.g. "FabC_0.mcPinion" (parts[].mateConnectors[].featureId).'),
    })
    .describe("A mate connector defined in the Part Studio, as onshape_get_assembly lists it."),
]);

/** Mate values in inches and degrees, each key carrying its unit. */
function mateValuesForUser(values: MateValue[]): Array<Record<string, unknown>> {
  return values.map((value) => {
    const out: Record<string, unknown> = {
      featureId: value.featureId,
      mateName: value.mateName,
      jsonType: value.jsonType,
      ownerOccurrencePath: value.ownerOccurrencePath,
    };
    for (const key of MATE_VALUE_KEYS) {
      if (typeof value[key] === "number") out[mateValueField(key)] = round6(mateValueToUser(key, value[key] as number));
    }
    return out;
  });
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const mateValueInputShape = Object.fromEntries(
  MATE_VALUE_KEYS.map((key) => [
    mateValueField(key),
    z
      .number()
      .optional()
      .describe(key.startsWith("translation") ? `${key}, inches.` : `${key}, degrees.`),
  ]),
);

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
      fixed: z
        .boolean()
        .optional()
        .describe(
          "Fix the new instance in place, to ground the assembly. Onshape has no public call to fix or unfix an " +
            "instance afterwards; to change it, insert again and delete the old instance.",
        ),
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
          isFixed: args.fixed,
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
    description:
      "The mates, mate connectors, groups and relations defined in an assembly, with their feature ids, payloads " +
      "and regeneration states.",
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
      ...featureBase,
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
    description:
      "Join two mate connectors with a mate: FASTENED, REVOLUTE, SLIDER, CYLINDRICAL, PLANAR, and so on. Each " +
      "connector is an assembly-level mate connector's feature id, or a Part Studio mate connector given as " +
      "{path: [instance id], connector: feature id} from onshape_get_assembly. The mate's value measures the first " +
      "connector against the second, so list the moving part first.",
    inputSchema: {
      ...featureBase,
      connectors: z.array(mateConnectorShape).min(2).describe("The mate connectors to join, moving part first."),
      type: z.string().optional().describe("Mate type (default FASTENED)."),
      name: z.string().optional().describe('Feature name (default "Mate").'),
    },
    handler: (args, ctx) =>
      addAssemblyFeature(ctx, args, () =>
        buildAssemblyMate({
          name: args.name,
          mateType: args.type,
          mateConnectors: args.connectors as MateConnectorRef[],
        }),
      ),
  },
  {
    name: "onshape_assembly_group",
    title: "Group instances",
    description: "Lock several instances together without individual mates.",
    inputSchema: {
      ...featureBase,
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
      ...featureBase,
      feature: z.record(z.string(), z.any()).describe("The assembly feature JSON."),
    },
    handler: (args, ctx) => addAssemblyFeature(ctx, args, () => args.feature),
  },
  {
    name: "onshape_update_assembly_feature",
    title: "Update an assembly feature",
    description:
      "Replace an assembly feature's payload — a mate's type, connectors or limits, a relation's ratio. Post the " +
      "whole feature JSON, e.g. as onshape_get_assembly_features returns it, inside a BTFeatureDefinitionCall-1406 " +
      "envelope.",
    inputSchema: {
      ...featureBase,
      feature_id: z.string().min(1).describe("Id of the feature to replace."),
      feature: z.record(z.string(), z.any()).describe("The full replacement feature JSON."),
    },
    handler: (args, ctx) => updateAssemblyFeature(ctx, args, args.feature_id, args.feature),
  },
  {
    name: "onshape_delete_assembly_feature",
    title: "Delete an assembly feature",
    description: "Remove a mate, mate connector, group or relation. Relations on a deleted mate stop solving.",
    inputSchema: { ...targetShape, feature_id: z.string().min(1).describe("Id of the feature to delete.") },
    annotations: { destructiveHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().assemblies.deleteFeature(t.doc, t.ws, t.elem, args.feature_id));
    },
  },
  {
    name: "onshape_assembly_relation",
    title: "Relate two mates",
    description:
      "Couple mates so one drives the other: GEAR (two revolutes, ratio), RACK_AND_PINION (a revolute and a slider, " +
      "distance per revolution), SCREW (one cylindrical mate, distance per revolution) or LINEAR (two sliders, " +
      "ratio). Each mate's degree of freedom follows from its type; cylindrical mates contribute whichever the " +
      "relation needs. Mates missing the parameter relations need (made by hand-written payloads) are completed " +
      "first and listed in completedMates. Fails if the relation does not regenerate.",
    inputSchema: {
      ...targetShape,
      type: z.enum(RELATION_TYPES).describe("Relation type."),
      mates: z.array(z.string().min(1)).min(1).max(2).describe("Mate feature ids: two, or one for SCREW."),
      ratio: z.number().positive().optional().describe("GEAR and LINEAR: the ratio between the mates (default 1)."),
      distance_per_revolution: z
        .number()
        .positive()
        .optional()
        .describe("RACK_AND_PINION and SCREW: travel per full turn, inches. A pinion's is its pitch circumference."),
      reverse: z.boolean().optional().describe("Reverse the direction of the coupling."),
      dofs: z
        .array(z.enum(["Rz", "Tz"]))
        .optional()
        .describe("Override the degree of freedom per mate: Rz rotation about, Tz translation along, its Z axis."),
      name: z.string().optional().describe('Feature name (default "Relation").'),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () =>
        ctx.api().assemblies.addMateRelation(t.doc, t.ws, t.elem, {
          relationType: args.type,
          mateIds: args.mates,
          dofs: args.dofs,
          ratio: args.ratio,
          distancePerRevolution: args.distance_per_revolution,
          reverse: args.reverse,
          name: args.name,
        }),
      );
    },
  },
  {
    name: "onshape_get_mate_values",
    title: "Get mate values",
    description:
      "Where every mate currently sits: each degree of freedom's value, translations in inches and rotations in " +
      "degrees, keyed by unit (translationZ_in, rotationZ_deg).",
    inputSchema: { ...targetShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, async () => mateValuesForUser(await ctx.api().assemblies.getMateValues(t.doc, t.ws, t.elem)));
    },
  },
  {
    name: "onshape_set_mate_values",
    title: "Set mate values",
    description:
      "Drive top-level mates to new positions — turn a revolute, slide a slider — and read them back; relations " +
      "move the coupled mates too. Values are inches and degrees. Fails when Onshape does not apply a value, which " +
      "it does silently for mates with limits enabled and for positions the rest of the assembly cannot reach.",
    inputSchema: {
      ...targetShape,
      values: z
        .array(
          z.object({
            mate: z.string().min(1).describe("Mate feature id."),
            ...mateValueInputShape,
          }),
        )
        .min(1)
        .describe("One entry per mate, naming only the degrees of freedom to change."),
    },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, async () => {
        const updates: MateValueUpdate[] = (args.values as Array<Record<string, any>>).map((entry) => {
          const values: MateValueUpdate["values"] = {};
          for (const key of MATE_VALUE_KEYS) {
            const given = entry[mateValueField(key)];
            if (typeof given === "number") values[key] = mateValueFromUser(key, given);
          }
          if (!Object.keys(values).length) throw new Error(`No value given for mate ${entry.mate}.`);
          return { featureId: entry.mate, values };
        });
        return mateValuesForUser(await ctx.api().assemblies.setMateValues(t.doc, t.ws, t.elem, updates));
      });
    },
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
