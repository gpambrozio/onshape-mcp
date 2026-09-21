/** Building blocks for Onshape feature payloads (the BTM* JSON the
 *  POST .../features endpoints expect).
 *  Derived from onshape-cli (MIT, see NOTICE).
 *
 * Selection is query-string based wherever possible: a FeatureScript query
 * survives topology changes, while a deterministic id does not. */

export type Feature = Record<string, unknown>;

export const INCH_TO_METER = 0.0254;

/** Onshape's three default planes have fixed deterministic ids. */
const PLANE_IDS: Record<string, string> = {
  front: "JCC",
  top: "JDC",
  right: "JEC",
};

export function planeId(name: string): string {
  const value = PLANE_IDS[name.toLowerCase()];
  if (!value) throw new Error(`Unknown plane '${name}'. Use Front, Top, or Right.`);
  return value;
}

export function toMeters(value: number): number {
  return value * INCH_TO_METER;
}

/** Accepts "1.5,-2" or [1.5, -2]. */
export function parsePoint2(value: unknown): [number, number] {
  const parts = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  const numbers = parts.map((part) => Number(typeof part === "string" ? part.trim() : part));
  if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`Expected a 2D point as "x,y" or [x, y]; got ${JSON.stringify(value)}`);
  }
  return [numbers[0], numbers[1]];
}

export function featureCall(featureType: string, name: string, parameters: Feature[], namespace = ""): Feature {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType,
      name,
      suppressed: false,
      namespace,
      parameters,
    },
  };
}

export function pQuery(
  parameterId: string,
  opts: { deterministicIds?: string[]; queryString?: string; featureId?: string } = {},
): Feature {
  const query: Record<string, unknown> = {
    btType: "BTMIndividualQuery-138",
    deterministicIds: opts.deterministicIds ?? [],
  };
  if (opts.queryString) {
    query.queryStatement = null;
    query.queryString = opts.queryString;
  }
  if (opts.featureId) query.featureId = opts.featureId;
  return {
    btType: "BTMParameterQueryList-148",
    queries: [query],
    parameterId,
    parameterName: "",
  };
}

/** The closed regions of a sketch — what extrude/revolve/sweep consume. */
export function pSketchRegion(parameterId: string, sketchFeatureId: string): Feature {
  return {
    btType: "BTMParameterQueryList-148",
    queries: [
      {
        btType: "BTMIndividualSketchRegionQuery-140",
        queryStatement: null,
        filterInnerLoops: true,
        queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
        featureId: sketchFeatureId,
        deterministicIds: [],
      },
    ],
    parameterId,
    parameterName: "",
  };
}

export function pSketchEdges(parameterId: string, sketchFeatureId: string): Feature {
  return pQuery(parameterId, {
    queryString: `query = qCreatedBy(makeId("${sketchFeatureId}"), EntityType.EDGE);`,
    featureId: sketchFeatureId,
  });
}

/** A dimension. `variable` references a Part Studio variable (#name) instead of
 *  a literal, which keeps the model parametric. */
export function pQuantity(
  parameterId: string,
  value: number,
  units = "in",
  opts: { variable?: string; isInteger?: boolean; expression?: string } = {},
): Feature {
  let expression: string;
  if (opts.expression) expression = opts.expression;
  else if (opts.variable) expression = `#${opts.variable}`;
  else if (opts.isInteger) expression = `${Math.trunc(value)}`;
  else if (units) expression = `${value} ${units}`;
  else expression = `${value}`;
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: opts.isInteger ?? false,
    value,
    units: "",
    expression,
    parameterId,
    parameterName: "",
  };
}

export function pEnum(parameterId: string, enumName: string, value: string): Feature {
  return {
    btType: "BTMParameterEnum-145",
    namespace: "",
    enumName,
    value,
    parameterId,
    parameterName: "",
  };
}

export function pString(parameterId: string, value: string): Feature {
  return {
    btType: "BTMParameterString-149",
    value,
    parameterId,
    parameterName: "",
  };
}

export function pBool(parameterId: string, value: boolean): Feature {
  return {
    btType: "BTMParameterBoolean-144",
    value,
    parameterId,
    parameterName: "",
  };
}

// --- Reusable selection queries --------------------------------------------

export const qAllEdges = (): string => "query = qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE);";
export const qEdgesOfFeature = (featureId: string): string =>
  `query = qCreatedBy(makeId("${featureId}"), EntityType.EDGE);`;
export const qCircularEdges = (): string =>
  "query = qGeometry(qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE), GeometryType.CIRCLE);";
export const qAllBodies = (): string => "query = qAllModifiableSolidBodies();";
export const qBodyOfFeature = (featureId: string): string =>
  `query = qCreatedBy(makeId("${featureId}"), EntityType.BODY);`;

export interface Selection {
  edgeIds?: string[];
  queryString?: string;
  featureId?: string;
  selectAll?: boolean;
  circular?: boolean;
}

/** Turn the five ways a caller can name entities into one query parameter. */
export function resolveEntityQuery(parameterId: string, sel: Selection, entity: "EDGE" | "BODY" = "EDGE"): Feature {
  if (sel.edgeIds?.length) return pQuery(parameterId, { deterministicIds: sel.edgeIds });
  if (sel.queryString) return pQuery(parameterId, { queryString: sel.queryString });
  if (sel.featureId) {
    return pQuery(parameterId, {
      queryString: entity === "EDGE" ? qEdgesOfFeature(sel.featureId) : qBodyOfFeature(sel.featureId),
    });
  }
  if (sel.circular) return pQuery(parameterId, { queryString: qCircularEdges() });
  if (sel.selectAll) return pQuery(parameterId, { queryString: qAllEdges() });
  throw new Error("No selection: pass edges, query, feature, all, or circular.");
}
