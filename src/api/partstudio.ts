/** Part Studio features, sketches, parts, measurement and validation.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";
import { decodeFsValue, featurescriptMessages, FeatureScriptError } from "./fsvalue.js";
import { isRecord } from "./util.js";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export interface FeatureValidation {
  featureId: string;
  featureStatus: string | null;
}

/** A body named by its part id, or by the feature that created it. */
export interface BodyRef {
  partId?: string;
  featureId?: string;
}

/** Deterministic ids passed alongside a FeatureScript call, by key; the
 *  script reads each entry as the query `queries.<key>`. Onshape wants a map
 *  here and rejects a list of key/value pairs with a 400. */
export type FeatureScriptQueries = Record<string, string[]>;

export class PartStudioManager {
  constructor(private readonly client: OnshapeClient) {}

  async getFeatures(documentId: string, workspaceId: string, elementId: string, configuration?: string): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, {
      configuration,
    });
  }

  async getFeatureSpecs(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
  }

  async getSketchInfo(documentId: string, workspaceId: string, elementId: string, sketchId?: string): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/sketches`, {
      includeGeometry: "true",
      sketchId,
    });
  }

  async getBodyDetails(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`, {
      includeTopology: "true",
    });
  }

  async getParts(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v9/parts/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async createPartStudio(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}`, { name });
  }

  async deleteFeature(documentId: string, workspaceId: string, elementId: string, featureId: string): Promise<unknown> {
    return this.client.delete(
      `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`,
    );
  }

  async deleteElement(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.delete(`/api/v9/elements/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async addFeature(documentId: string, workspaceId: string, elementId: string, feature: unknown): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, feature);
  }

  async updateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
    feature: unknown,
  ): Promise<unknown> {
    return this.client.post(
      `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`,
      feature,
    );
  }

  async rollback(documentId: string, workspaceId: string, elementId: string, index: number): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/rollback`, {
      rollbackIndex: index,
    });
  }

  async massProperties(documentId: string, workspaceId: string, elementId: string, configuration?: string): Promise<unknown> {
    return this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/massproperties`, {
      configuration,
    });
  }

  async evaluateFeatureScript(
    documentId: string,
    workspaceId: string,
    elementId: string,
    script: string,
    queries?: FeatureScriptQueries,
  ): Promise<unknown> {
    return this.client.post(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurescript`, {
      script,
      ...(queries && Object.keys(queries).length ? { queries } : {}),
    });
  }

  /** Minimum distance between two solid bodies — 0 when they touch or overlap,
   *  which makes it the interference check as well as the clearance one. */
  async clearance(
    documentId: string,
    workspaceId: string,
    elementId: string,
    a: BodyRef,
    b: BodyRef,
  ): Promise<Record<string, unknown>> {
    const sideA = bodyQuery("a", a);
    const sideB = bodyQuery("b", b);
    // Map keys are quoted: FeatureScript rejects a bare key that shares its
    // name with a variable in scope.
    const script =
      "function(context is Context, queries){" +
      ` var sideA = ${sideA.expression}; var sideB = ${sideB.expression};` +
      ' if (size(evaluateQuery(context, sideA)) == 0) { return { "missing": "a" }; }' +
      ' if (size(evaluateQuery(context, sideB)) == 0) { return { "missing": "b" }; }' +
      ' var r = evDistance(context, { "side0": sideA, "side1": sideB });' +
      " var p = r.sides[0].point; var q = r.sides[1].point;" +
      ' return { "distance": r.distance/inch,' +
      '   "a": [p[0]/inch, p[1]/inch, p[2]/inch], "b": [q[0]/inch, q[1]/inch, q[2]/inch] }; }';
    const queries: FeatureScriptQueries = { ...sideA.query, ...sideB.query };
    const response = await this.evaluateFeatureScript(documentId, workspaceId, elementId, script, queries);
    if (!isRecord(response) || response.result === null || response.result === undefined) {
      throw new FeatureScriptError(featurescriptMessages(response));
    }
    const d = (decodeFsValue(response.result) as Record<string, any>) || {};
    if (d.missing) {
      const ref = d.missing === "a" ? a : b;
      throw new Error(`Body ${d.missing} (${describeBodyRef(ref)}) matched no solid body in this Part Studio.`);
    }
    const distance = Number(d.distance);
    if (!Number.isFinite(distance)) throw new Error(`Unexpected evDistance result: ${JSON.stringify(d)}`);
    return {
      distance_in: round6(distance),
      distance_mm: round4(distance * 25.4),
      // Exactly zero when the bodies touch or interpenetrate; evDistance cannot
      // tell those apart.
      clear: distance > 0,
      closest_points_in: {
        a: (d.a as number[]).map(round4),
        b: (d.b as number[]).map(round4),
      },
    };
  }

  /** Bounding box in inches, volume and body count for every solid body. */
  async measure(documentId: string, workspaceId: string, elementId: string): Promise<Record<string, unknown>> {
    const script =
      "function(context is Context, queries){" +
      " var bs = evaluateQuery(context, qAllModifiableSolidBodies());" +
      " if (size(bs) == 0) { return { bodies: 0 }; }" +
      " var b = evBox3d(context, { topology: qAllModifiableSolidBodies(), tight: true });" +
      " var vol = evVolume(context, { entities: qAllModifiableSolidBodies() });" +
      " return { bodies: size(bs)," +
      "   minx: b.minCorner[0]/inch, miny: b.minCorner[1]/inch, minz: b.minCorner[2]/inch," +
      "   maxx: b.maxCorner[0]/inch, maxy: b.maxCorner[1]/inch, maxz: b.maxCorner[2]/inch," +
      "   vol_in3: vol/(inch*inch*inch) }; }";
    const response = await this.evaluateFeatureScript(documentId, workspaceId, elementId, script);
    if (!isRecord(response) || response.result === null || response.result === undefined) {
      throw new FeatureScriptError(featurescriptMessages(response));
    }
    const d = (decodeFsValue(response.result) as Record<string, any>) || {};
    const bodies = Number(d.bodies ?? 0) || 0;
    if (bodies === 0) {
      return { bodies: 0, bbox: { x: 0, y: 0, z: 0, min: [0, 0, 0], max: [0, 0, 0] }, volume_in3: 0 };
    }
    return {
      bodies,
      bbox: {
        x: round4(d.maxx - d.minx),
        y: round4(d.maxy - d.miny),
        z: round4(d.maxz - d.minz),
        min: [round4(d.minx), round4(d.miny), round4(d.minz)],
        max: [round4(d.maxx), round4(d.maxy), round4(d.maxz)],
      },
      volume_in3: round4(Number(d.vol_in3 ?? 0)),
    };
  }

  /** A feature that regenerates with status ERROR is a failure, even though the
   *  POST that created it returned 200. */
  async validateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
  ): Promise<FeatureValidation> {
    const features = await this.getFeatures(documentId, workspaceId, elementId);
    const states = isRecord(features) && isRecord(features.featureStates) ? features.featureStates : {};
    const state = isRecord(states[featureId]) ? states[featureId] : {};
    const status = typeof state.featureStatus === "string" ? state.featureStatus : null;
    if (status === "ERROR") throw new Error(`Feature ${featureId} regenerated with status ERROR.`);
    return { featureId, featureStatus: status };
  }

  async validatePartStudio(
    documentId: string,
    workspaceId: string,
    elementId: string,
    expectations: { parts?: number; bodies?: number } = {},
  ): Promise<Record<string, unknown>> {
    const partsRaw = await this.getParts(documentId, workspaceId, elementId);
    const parts = Array.isArray(partsRaw) ? partsRaw : [];
    // Body count comes from a FeatureScript query: the mass-properties response
    // aggregates the studio and would report 1 however many bodies there are.
    const measured = await this.measure(documentId, workspaceId, elementId);
    const bodyCount = Number(measured.bodies ?? 0);

    if (expectations.parts !== undefined && parts.length !== expectations.parts) {
      throw new Error(`Expected ${expectations.parts} part(s), found ${parts.length}.`);
    }
    if (expectations.bodies !== undefined && bodyCount !== expectations.bodies) {
      throw new Error(`Expected ${expectations.bodies} bod(y/ies), found ${bodyCount}.`);
    }
    return {
      parts: parts.length,
      bodies: bodyCount,
      partIds: parts.map((part) => (isRecord(part) ? part.partId : undefined)).filter(Boolean),
    };
  }
}

/** The FeatureScript expression for one side of a body comparison. A part id
 *  travels in the request's `queries`, which Onshape resolves for the script;
 *  a feature id becomes a query for the solid bodies that feature created. */
function bodyQuery(key: string, ref: BodyRef): { expression: string; query?: FeatureScriptQueries } {
  if (Boolean(ref.partId) === Boolean(ref.featureId)) {
    throw new Error(`Body ${key} needs exactly one of a part id or a feature id.`);
  }
  if (ref.partId) {
    return { expression: `qBodyType(queries.${key}, BodyType.SOLID)`, query: { [key]: [ref.partId] } };
  }
  return {
    expression: `qBodyType(qCreatedBy(makeId(${JSON.stringify(ref.featureId)}), EntityType.BODY), BodyType.SOLID)`,
  };
}

function describeBodyRef(ref: BodyRef): string {
  return ref.partId ? `part ${ref.partId}` : `feature ${ref.featureId}`;
}
