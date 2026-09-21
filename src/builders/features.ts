/** Solid feature payloads: extrude, revolve, sweep, thicken, boolean, fillet,
 *  chamfer, shell, draft, mirror, patterns and construction planes.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import {
  featureCall,
  pBool,
  pEnum,
  pQuantity,
  pQuery,
  pSketchEdges,
  pSketchRegion,
  planeId,
  qAllBodies,
  resolveEntityQuery,
  type Feature,
  type Selection,
} from "./params.js";

/** NEW makes a body, ADD/REMOVE/INTERSECT combine with existing ones. */
export type OperationType = "NEW" | "ADD" | "REMOVE" | "INTERSECT";

export function buildExtrude(input: {
  name: string;
  sketchFeatureId: string;
  depth: number;
  operationType: string;
  depthVariable?: string;
}): Feature {
  return featureCall("extrude", input.name, [
    pSketchRegion("entities", input.sketchFeatureId),
    pEnum("operationType", "NewBodyOperationType", input.operationType),
    pQuantity("depth", input.depth, "in", { variable: input.depthVariable }),
    pBool("oppositeDirection", false),
    pBool("defaultScope", true),
  ]);
}

/** Thicken is posted as a bare BTMFeature-134 — the definition-call envelope is
 *  rejected for this feature type. */
export function buildThicken(input: {
  name: string;
  sketchFeatureId: string;
  thickness: number;
  operationType: string;
  thicknessVariable?: string;
  midplane?: boolean;
  opposite?: boolean;
}): Feature {
  const expression = input.thicknessVariable ? `#${input.thicknessVariable}` : `${input.thickness} in`;
  return {
    btType: "BTMFeature-134",
    name: input.name,
    suppressed: false,
    namespace: "",
    featureType: "thicken",
    parameters: [
      {
        btType: "BTMParameterEnum-145",
        enumName: "NewBodyOperationType",
        value: input.operationType,
        parameterId: "operationType",
      },
      pSketchRegion("entities", input.sketchFeatureId),
      { btType: "BTMParameterBoolean-144", value: input.midplane ?? false, parameterId: "midplane" },
      { btType: "BTMParameterQuantity-147", expression, parameterId: "thickness1" },
      { btType: "BTMParameterBoolean-144", value: input.opposite ?? false, parameterId: "oppositeDirection" },
      { btType: "BTMParameterQuantity-147", expression: "0 in", parameterId: "thickness2" },
    ],
  };
}

/** Revolve around the sketch's own construction line. */
export function buildRevolve(input: {
  name: string;
  sketchFeatureId: string;
  angle: number;
  operationType: string;
}): Feature {
  return featureCall("revolve", input.name, [
    pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
    pEnum("operationType", "NewBodyOperationType", input.operationType),
    pSketchRegion("entities", input.sketchFeatureId),
    pQuery("axis", {
      queryString: `query = qConstructionFilter(qCreatedBy(makeId("${input.sketchFeatureId}"), EntityType.EDGE), ConstructionObject.YES);`,
      featureId: input.sketchFeatureId,
    }),
    pBool("fullRevolve", false),
    pEnum("endBound", "RevolveBoundingType", "BLIND"),
    pQuantity("angle", input.angle, "deg"),
    pBool("defaultScope", true),
  ]);
}

/** Revolve around an explicitly selected axis. */
export function buildRevolveAxis(opts: {
  name?: string;
  sketchFeatureId: string;
  axisQuery?: string;
  axisIds?: string[];
  operationType?: string;
  revolveType?: string;
  angle?: number;
}): Feature {
  const axis = opts.axisIds?.length
    ? pQuery("axis", { deterministicIds: opts.axisIds })
    : pQuery("axis", { queryString: opts.axisQuery });
  const full = (opts.revolveType ?? "FULL") === "FULL";
  const params: Feature[] = [
    pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
    pEnum("operationType", "NewBodyOperationType", opts.operationType ?? "NEW"),
    pSketchRegion("entities", opts.sketchFeatureId),
    axis,
    pBool("fullRevolve", full),
  ];
  if (!full) {
    params.push(pEnum("endBound", "RevolveBoundingType", "BLIND"));
    params.push(pQuantity("angle", opts.angle ?? 360, "deg"));
  }
  params.push(pBool("defaultScope", true));
  return featureCall("revolve", opts.name ?? "Revolve", params);
}

export function buildSweep(input: {
  name: string;
  profileSketchFeatureId: string;
  pathSketchFeatureId: string;
  operationType: string;
}): Feature {
  return featureCall("sweep", input.name, [
    pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
    pEnum("operationType", "NewBodyOperationType", input.operationType),
    pSketchRegion("profiles", input.profileSketchFeatureId),
    pSketchEdges("path", input.pathSketchFeatureId),
    pEnum("profileControl", "ProfileControlMode", "NONE"),
    pBool("hasTwist", false),
    pBool("hasScale", false),
    pBool("trimEnds", true),
    pBool("defaultScope", true),
  ]);
}

export function buildFillet(opts: { name?: string; radius?: number; radiusVariable?: string; filletType?: string } & Selection): Feature {
  return featureCall("fillet", opts.name ?? "Fillet", [
    resolveEntityQuery("entities", opts),
    pQuantity("radius", opts.radius ?? 0.1, "in", { variable: opts.radiusVariable }),
    pEnum("filletType", "FilletType", opts.filletType ?? "EDGE"),
  ]);
}

export function buildChamfer(
  opts: { name?: string; width?: number; widthVariable?: string; chamferType?: string; angle?: number } & Selection,
): Feature {
  const chamferType = opts.chamferType ?? "EQUAL_OFFSETS";
  const params = [
    resolveEntityQuery("entities", opts),
    pEnum("chamferType", "ChamferType", chamferType),
    pQuantity("width", opts.width ?? 0.1, "in", { variable: opts.widthVariable }),
  ];
  if (chamferType === "OFFSET_ANGLE" && opts.angle !== undefined) {
    params.push(pQuantity("angle", opts.angle, "deg"));
  }
  return featureCall("chamfer", opts.name ?? "Chamfer", params);
}

export function buildShell(opts: {
  name?: string;
  thickness?: number;
  faceIds?: string[];
  queryString?: string;
  thicknessVariable?: string;
  inward?: boolean;
}): Feature {
  let entities: Feature;
  if (opts.faceIds?.length) entities = pQuery("entities", { deterministicIds: opts.faceIds });
  else if (opts.queryString) entities = pQuery("entities", { queryString: opts.queryString });
  else entities = pQuery("entities", { deterministicIds: [] });
  return featureCall("shell", opts.name ?? "Shell", [
    entities,
    pQuantity("thickness", opts.thickness ?? 0.125, "in", { variable: opts.thicknessVariable }),
    pBool("oppositeDirection", !(opts.inward ?? true)),
  ]);
}

export function buildDraft(opts: {
  name?: string;
  angle?: number;
  neutralPlaneQuery: string;
  faceQuery: string;
}): Feature {
  return featureCall("draft", opts.name ?? "Draft", [
    pQuery("neutralPlane", { queryString: opts.neutralPlaneQuery }),
    pQuery("draftFaces", { queryString: opts.faceQuery }),
    pQuantity("angle", opts.angle ?? 3, "deg"),
    pBool("oppositeDirection", false),
  ]);
}

export function buildBoolean(opts: {
  name?: string;
  operationType?: string;
  toolsQuery?: string;
  toolIds?: string[];
  targetsQuery?: string;
  keepTools?: boolean;
}): Feature {
  const operationType = opts.operationType ?? "UNION";
  let tools: Feature;
  if (opts.toolIds?.length) tools = pQuery("tools", { deterministicIds: opts.toolIds });
  else if (opts.toolsQuery) tools = pQuery("tools", { queryString: opts.toolsQuery });
  else tools = pQuery("tools", { queryString: qAllBodies() });

  const params: Feature[] = [
    pEnum("operationType", "BooleanOperationType", operationType),
    pBool("defaultScope", false),
    tools,
    pBool("toolsExplicit", true),
  ];
  if (operationType === "SUBTRACTION") {
    params.push(pBool("targetsAndToolsNeedGrouping", false));
    if (opts.targetsQuery) params.push(pQuery("targets", { queryString: opts.targetsQuery }));
  }
  if (opts.keepTools) params.push(pBool("keepTools", true));
  return featureCall("booleanBodies", opts.name ?? "Boolean", params);
}

/** Union every solid body in the Part Studio — the common cleanup step. */
export function buildBooleanUnion(name = "Union bodies"): Feature {
  return buildBoolean({ name, operationType: "UNION", toolsQuery: qAllBodies() });
}

export function buildMirror(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  mirrorPlaneIds?: string[];
  mirrorPlaneQuery?: string;
}): Feature {
  let plane: Feature;
  if (opts.mirrorPlaneIds?.length) plane = pQuery("mirrorPlane", { deterministicIds: opts.mirrorPlaneIds });
  else if (opts.mirrorPlaneQuery) plane = pQuery("mirrorPlane", { queryString: opts.mirrorPlaneQuery });
  else throw new Error("Mirror needs plane_ids or plane_query.");
  return featureCall("mirror", opts.name ?? "Mirror", [
    pEnum("patternType", "MirrorType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    plane,
  ]);
}

export function buildLinearPattern(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  directionQuery?: string;
  directionIds?: string[];
  distance: number;
  instanceCount: number;
  opposite?: boolean;
}): Feature {
  const direction = opts.directionIds?.length
    ? pQuery("directionOne", { deterministicIds: opts.directionIds })
    : pQuery("directionOne", { queryString: opts.directionQuery });
  return featureCall("linearPattern", opts.name ?? "Linear Pattern", [
    pEnum("patternType", "PatternType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    direction,
    pBool("oppositeDirection", opts.opposite ?? false),
    pQuantity("distance", opts.distance),
    pQuantity("instanceCount", opts.instanceCount, "", { isInteger: true }),
    pBool("hasSecondDir", false),
  ]);
}

export function buildCircularPattern(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  axisQuery?: string;
  axisIds?: string[];
  instanceCount: number;
  angle?: number;
  equalSpacing?: boolean;
}): Feature {
  const axis = opts.axisIds?.length
    ? pQuery("axis", { deterministicIds: opts.axisIds })
    : pQuery("axis", { queryString: opts.axisQuery });
  return featureCall("circularPattern", opts.name ?? "Circular Pattern", [
    pEnum("patternType", "PatternType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    axis,
    pQuantity("angle", opts.angle ?? 360, "deg"),
    pQuantity("instanceCount", opts.instanceCount, "", { isInteger: true }),
    pBool("equalSpace", opts.equalSpacing ?? true),
  ]);
}

/** Construction plane offset from a default plane, a face, or a selected plane. */
export function buildOffsetPlane(opts: {
  name?: string;
  basePlane?: string;
  basePlaneIds?: string[];
  basePlaneQuery?: string;
  offset?: number;
}): Feature {
  let base: Feature;
  if (opts.basePlaneIds?.length) base = pQuery("entities", { deterministicIds: opts.basePlaneIds });
  else if (opts.basePlaneQuery) base = pQuery("entities", { queryString: opts.basePlaneQuery });
  else base = pQuery("entities", { deterministicIds: [planeId(opts.basePlane ?? "Front")] });
  return featureCall("cPlane", opts.name ?? "Plane", [
    pEnum("cplaneType", "CPlaneType", "OFFSET"),
    base,
    pQuantity("offset", opts.offset ?? 1),
    pBool("oppositeDirection", false),
  ]);
}
