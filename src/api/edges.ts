/** Edge discovery for selecting fillet/chamfer targets.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";
import { unwrapFeatureScriptResult } from "./fsvalue.js";
import { isRecord } from "./util.js";

const INCH_TO_METER = 0.0254;

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export class EdgeQuery {
  constructor(private readonly client: OnshapeClient) {}

  async getEdges(documentId: string, workspaceId: string, elementId: string): Promise<Record<string, unknown>> {
    const response = await this.client.get(
      `/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`,
      { includeTopology: "true" },
    );
    const bodies = isRecord(response) && Array.isArray(response.bodies) ? response.bodies : [];
    const edges: Array<Record<string, unknown>> = [];
    for (const body of bodies) {
      if (!isRecord(body)) continue;
      for (const edge of Array.isArray(body.edges) ? body.edges : []) {
        if (!isRecord(edge)) continue;
        // bodydetails describes the underlying curve (type, radius, centre) in
        // `curve`; `geometry` only holds the edge's end and sample points.
        const curve = isRecord(edge.curve) ? edge.curve : {};
        const geom = isRecord(edge.geometry) ? edge.geometry : {};
        const info: Record<string, unknown> = {
          id: edge.id,
          body: body.id,
          type: String(geometryTypeOf(edge, curve, geom)).toLowerCase(),
        };
        const radius = typeof curve.radius === "number" ? curve.radius : geom.radius;
        if (typeof radius === "number") info.radius = round6(radius / INCH_TO_METER);
        // The centre tells a hole rim from a fillet arc of the same radius.
        if (typeof radius === "number" && isRecord(curve.origin)) info.center = pointInInches(curve.origin);
        edges.push(info);
      }
    }
    return { edges, count: edges.length, bodyCount: bodies.length };
  }

  async findCircularEdges(
    documentId: string,
    workspaceId: string,
    elementId: string,
    radius?: number,
    tolerance = 0.001,
  ): Promise<unknown[]> {
    const result = await this.getEdges(documentId, workspaceId, elementId);
    const edges = Array.isArray(result.edges) ? result.edges : [];
    return edges.filter((edge: unknown) => {
      if (!isRecord(edge) || typeof edge.radius !== "number") return false;
      return radius === undefined || Math.abs(edge.radius - radius) <= tolerance;
    });
  }

  /** Deterministic ids of the edges a given feature created. */
  async findEdgesByFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
  ): Promise<unknown[]> {
    const script = `
      function(context is Context, queries) {
        const edges = evaluateQuery(context, qCreatedBy(makeId("${featureId}"), EntityType.EDGE));
        var edgeIds = [];
        for (var edge in edges) {
          try { edgeIds = append(edgeIds, toString(qDeterministicIdQuery(edge))); } catch {}
        }
        return edgeIds;
      }`;
    const response = await this.client.post(
      `/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurescript`,
      { script },
    );
    const decoded = unwrapFeatureScriptResult(response);
    return Array.isArray(decoded) ? decoded : [];
  }
}

function pointInInches(point: Record<string, any>): number[] {
  return [point.x, point.y, point.z].map((value) => round6(Number(value) / INCH_TO_METER));
}

/** bodydetails labels the curve in `curve.type`; older payloads may not, so
 *  fall back to inferring it from the geometry. */
function geometryTypeOf(edge: Record<string, any>, curve: Record<string, any>, geom: Record<string, any>): string {
  if (curve.type) return String(curve.type);
  if (geom.type) return String(geom.type);
  if (edge.geometryType) return String(edge.geometryType);
  const btType = String(geom.btType ?? "");
  if (geom.radius !== undefined || btType.includes("Circle") || btType.includes("Arc")) {
    return geom.startPoint !== geom.endPoint && geom.radius !== undefined ? "arc" : "circle";
  }
  if (geom.startPoint !== undefined && geom.endPoint !== undefined) return "line";
  return "unknown";
}
