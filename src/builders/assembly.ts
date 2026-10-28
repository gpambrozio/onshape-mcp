/** Assembly feature payloads: mates, mate connectors and groups.
 *  Derived from onshape-cli (MIT, see NOTICE).
 *
 * Assembly features use occurrence-aware queries (BTM*WithOccurrence*), which
 * are different from the Part Studio query types. */

import { isRecord } from "../api/util.js";
import { INCH_TO_METER, pBool, pEnum, pQuantity, type Feature } from "./params.js";

/** A mate connector to join: the feature id of an assembly-level connector, or
 *  a connector defined in a Part Studio, named by the occurrence path of the
 *  instance that carries it and its feature id as onshape_get_assembly lists it
 *  (parts[].mateConnectors[].featureId, e.g. "FabC_0.mcPinion"). */
export type MateConnectorRef = string | { path: string[]; connector: string };

/** Relations refuse to solve against a mate without this parameter: Onshape
 *  regenerates the relation with a bare ERROR and no message. The UI always
 *  writes it, so a mate made there works and a minimal one from the API does
 *  not. PLUS_X is the UI default and does not move anything. */
const SECONDARY_AXIS_ALIGNMENT = () => pEnum("secondaryAxisAlignment", "Reorient secondary axis", "PLUS_X");

function mateConnectorQuery(ref: MateConnectorRef): Feature {
  if (typeof ref === "string") {
    return { btType: "BTMFeatureQueryWithOccurrence-157", path: [], featureId: ref, queryData: "" };
  }
  if (!ref.path.length) throw new Error(`Part Studio mate connector ${ref.connector} needs the instance's occurrence path.`);
  return { btType: "BTMPartStudioMateConnectorQuery-1324", path: ref.path, featureId: ref.connector };
}

export function buildAssemblyMate(opts: { name?: string; mateType?: string; mateConnectors: MateConnectorRef[] }): Feature {
  if (opts.mateConnectors.length < 2) {
    throw new Error("A mate needs at least two mate connectors.");
  }
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMate-64",
      featureType: "mate",
      name: opts.name ?? "Mate",
      suppressed: false,
      parameters: [
        pEnum("mateType", "Mate type", opts.mateType ?? "FASTENED"),
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries: opts.mateConnectors.map(mateConnectorQuery),
          parameterId: "mateConnectorsQuery",
        },
        SECONDARY_AXIS_ALIGNMENT(),
      ],
    },
  };
}

/** The mate as a relation needs it, or null when it already qualifies. The
 *  feature is the one onshape_get_assembly_features returns. */
export function mateReadyForRelations(mate: Record<string, any>): Feature | null {
  const parameters: unknown[] = Array.isArray(mate.parameters) ? mate.parameters : [];
  if (parameters.some((param) => isRecord(param) && param.parameterId === "secondaryAxisAlignment")) return null;
  return { btType: "BTFeatureDefinitionCall-1406", feature: { ...mate, parameters: [...parameters, SECONDARY_AXIS_ALIGNMENT()] } };
}

export const RELATION_TYPES = ["GEAR", "RACK_AND_PINION", "SCREW", "LINEAR"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** The degree of freedom a relation couples on each mate, in Onshape's
 *  queryData spelling: "Rz" is rotation about the mate's Z axis, "Tz"
 *  translation along it. */
export type MateDof = "Rz" | "Tz";

/** Pick each mate's degree of freedom from its type: a revolute turns, a slider
 *  slides, and a cylindrical does whichever the relation needs of it. */
export function relationDofs(relationType: RelationType, mateTypes: string[]): MateDof[] {
  const expected = relationType === "SCREW" ? 1 : 2;
  if (mateTypes.length !== expected) {
    throw new Error(
      relationType === "SCREW"
        ? "A screw relation takes exactly one cylindrical mate."
        : `A ${relationType} relation takes exactly two mates.`,
    );
  }
  const turns = (type: string) => type === "REVOLUTE" || type === "CYLINDRICAL";
  const slides = (type: string) => type === "SLIDER" || type === "CYLINDRICAL";
  const [first, second] = mateTypes;
  switch (relationType) {
    case "GEAR":
      if (mateTypes.every(turns)) return ["Rz", "Rz"];
      break;
    case "LINEAR":
      if (mateTypes.every(slides)) return ["Tz", "Tz"];
      break;
    case "SCREW":
      if (first === "CYLINDRICAL") return ["Rz"];
      break;
    case "RACK_AND_PINION":
      // One mate turns and the other slides, in either order.
      if (turns(first) && slides(second)) return ["Rz", "Tz"];
      if (slides(first) && turns(second)) return ["Tz", "Rz"];
      break;
  }
  const wants: Record<RelationType, string> = {
    GEAR: "two REVOLUTE or CYLINDRICAL mates",
    LINEAR: "two SLIDER or CYLINDRICAL mates",
    SCREW: "one CYLINDRICAL mate",
    RACK_AND_PINION: "a REVOLUTE (or CYLINDRICAL) mate and a SLIDER (or CYLINDRICAL) mate",
  };
  throw new Error(
    `A ${relationType} relation needs ${wants[relationType]}; got ${mateTypes.join(" and ")}. ` +
      "Pass dofs to choose the degrees of freedom yourself.",
  );
}

/** A relation coupling two mates: a gear or linear ratio, or a rack-and-pinion
 *  or screw distance per revolution in inches. */
export function buildMateRelation(opts: {
  name?: string;
  relationType: RelationType;
  mates: Array<{ featureId: string; dof: MateDof }>;
  ratio?: number;
  distancePerRevolution?: number;
  reverse?: boolean;
}): Feature {
  const usesLength = opts.relationType === "RACK_AND_PINION" || opts.relationType === "SCREW";
  if (usesLength && !(opts.distancePerRevolution && opts.distancePerRevolution > 0)) {
    throw new Error(`A ${opts.relationType} relation needs a positive distance per revolution (inches).`);
  }
  if (!usesLength && opts.ratio !== undefined && !(opts.ratio > 0)) {
    throw new Error(`A ${opts.relationType} relation needs a positive ratio.`);
  }
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateRelation-1412",
      featureType: "mateRelation",
      name: opts.name ?? "Relation",
      suppressed: false,
      parameters: [
        pEnum("relationType", "Relation type", opts.relationType),
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries: opts.mates.map((mate) => ({
            btType: "BTMFeatureQueryWithOccurrence-157",
            path: [],
            featureId: mate.featureId,
            queryData: mate.dof,
          })),
          parameterId: "matesQuery",
        },
        usesLength
          ? pQuantity("relationLength", opts.distancePerRevolution as number, "in")
          : pQuantity("relationRatio", opts.ratio ?? 1, ""),
        pBool("reverseDirection", opts.reverse ?? false),
      ],
    },
  };
}

/** Mate values move between Onshape's metres and radians and the inches and
 *  degrees used at every boundary of this server. */
export const MATE_VALUE_KEYS = [
  "translationX",
  "translationY",
  "translationZ",
  "rotationX",
  "rotationY",
  "rotationZ",
] as const;
export type MateValueKey = (typeof MATE_VALUE_KEYS)[number];

const isTranslation = (key: MateValueKey) => key.startsWith("translation");
/** The user-facing name of a degree of freedom, unit included. */
export const mateValueField = (key: MateValueKey) => (isTranslation(key) ? `${key}_in` : `${key}_deg`);

export function mateValueToUser(key: MateValueKey, value: number): number {
  return isTranslation(key) ? value / INCH_TO_METER : (value * 180) / Math.PI;
}

export function mateValueFromUser(key: MateValueKey, value: number): number {
  return isTranslation(key) ? value * INCH_TO_METER : (value * Math.PI) / 180;
}

/** An implicit mate connector on an instance, placed by inference (CENTROID,
 *  TOP, MID_PLANE, ...) rather than by picking geometry. */
export function buildAssemblyMateConnector(opts: {
  name?: string;
  occurrenceId: string;
  inferenceType?: string;
}): Feature {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateConnector-66",
      featureType: "mateConnector",
      name: opts.name ?? "Mate connector",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterEnum-145",
          enumName: "Origin type",
          value: "ON_ENTITY",
          parameterId: "originType",
          namespace: "",
        },
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          parameterId: "originQuery",
          queries: [
            {
              btType: "BTMInferenceQueryWithOccurrence-1083",
              inferenceType: opts.inferenceType ?? "CENTROID",
              path: [opts.occurrenceId],
              deterministicIds: [],
            },
          ],
        },
      ],
    },
  };
}

/** Lock instances together without individual mates. */
export function buildAssemblyGroup(opts: { name?: string; occurrenceIds: string[] }): Feature {
  if (!opts.occurrenceIds.length) throw new Error("A group needs at least one occurrence id.");
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateGroup-65",
      featureType: "mateGroup",
      name: opts.name ?? "Group",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries: opts.occurrenceIds.map((occurrenceId) => ({
            btType: "BTMIndividualOccurrenceQuery-626",
            path: [occurrenceId],
          })),
          parameterId: "occurrencesQuery",
        },
      ],
    },
  };
}
