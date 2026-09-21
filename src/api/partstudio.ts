/** Part Studio features, sketches, parts, measurement and validation.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";
import { decodeFsValue, featurescriptMessages, FeatureScriptError } from "./fsvalue.js";
import { isRecord } from "./util.js";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface FeatureValidation {
  featureId: string;
  featureStatus: string | null;
}

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

  async evaluateFeatureScript(documentId: string, workspaceId: string, elementId: string, script: string): Promise<unknown> {
    return this.client.post(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurescript`, {
      script,
    });
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
