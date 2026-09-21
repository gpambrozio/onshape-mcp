/** Mesh/CAD exports, thumbnails and shaded renders.
 *  Derived from onshape-cli (MIT, see NOTICE), with every writer also returning
 *  the bytes so a tool can hand the image straight back to the model. */

import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import type { OnshapeClient } from "./client.js";
import { isRecord } from "./util.js";

/** Isometric camera (3x4 row-major view matrix). */
export const ISO_VIEW = "0.707,0.707,0,0,-0.408,0.408,0.816,0,0.577,-0.577,0.577,0";

export interface WrittenFile {
  path: string;
  bytes: number;
  buffer: Buffer;
}

export class ExportManager {
  constructor(private readonly client: OnshapeClient) {}

  async exportStl(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: { binary?: boolean; units?: string; resolution?: string; scale?: number; configuration?: string } = {},
  ): Promise<WrittenFile> {
    const { buffer } = await this.client.getBinary(
      `/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/stl`,
      {
        mode: opts.binary === false ? "text" : "binary",
        units: opts.units ?? "inch",
        grouping: "true",
        scale: opts.scale ?? 1.0,
        resolution: opts.resolution ?? "medium",
        configuration: opts.configuration,
      },
      "application/vnd.onshape.v1+octet-stream",
    );
    return write(outputPath, buffer);
  }

  /** STEP/IGES/3MF/Parasolid/PDF go through Onshape's async translation queue. */
  async exportTranslation(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: {
      formatName?: string;
      elementKind?: string;
      configuration?: string;
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<WrittenFile> {
    const formatName = opts.formatName ?? "STEP";
    const elementKind = opts.elementKind ?? "partstudios";
    const pollIntervalMs = opts.pollIntervalMs ?? 1500;
    const timeoutMs = opts.timeoutMs ?? 120_000;

    const body: Record<string, unknown> = { formatName, storeInDocument: false, flattenAssemblies: false };
    if (opts.configuration) body.configuration = opts.configuration;

    const job = await this.client.post(
      `/api/v6/${elementKind}/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`,
      body,
    );
    const translationId = isRecord(job) ? job.id : undefined;
    if (!translationId) throw new Error(`Translation not started: ${JSON.stringify(job)}`);

    let elapsed = 0;
    let state = (isRecord(job) && job.requestState) || "ACTIVE";
    let result: unknown = job;
    while (state === "ACTIVE" && elapsed < timeoutMs) {
      await sleep(pollIntervalMs);
      elapsed += pollIntervalMs;
      result = await this.client.get(`/api/v6/translations/${translationId}`);
      state = (isRecord(result) && result.requestState) || "ACTIVE";
    }
    if (state !== "DONE") throw new Error(`Translation failed or timed out (state=${state}): ${JSON.stringify(result)}`);

    const externalIds = isRecord(result) && Array.isArray(result.resultExternalDataIds) ? result.resultExternalDataIds : [];
    if (!externalIds.length) throw new Error(`Translation produced no data: ${JSON.stringify(result)}`);
    const resultDocumentId = (isRecord(result) && result.resultDocumentId) || documentId;
    const { buffer } = await this.client.getBinary(
      `/api/v6/documents/d/${resultDocumentId}/externaldata/${externalIds[0]}`,
    );
    return write(outputPath, buffer);
  }

  async thumbnailInfo(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/thumbnails/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async getThumbnail(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: { size?: string } = {},
  ): Promise<WrittenFile> {
    const info = await this.thumbnailInfo(documentId, workspaceId, elementId);
    const sizes: Array<Record<string, any>> = isRecord(info) && Array.isArray(info.sizes) ? info.sizes : [];
    if (!sizes.length) {
      throw new Error(
        "No thumbnail available yet — Onshape renders thumbnails asynchronously; retry shortly after the element changes.",
      );
    }
    const chosen = sizes.find((entry) => entry.size === (opts.size ?? "600x340")) ?? sizes[0];
    if (!chosen?.href) throw new Error(`Thumbnail entry has no href: ${JSON.stringify(chosen)}`);
    const { buffer } = await this.client.getBinaryUrl(String(chosen.href));
    return write(outputPath, buffer);
  }

  /** Server-side render — unlike a thumbnail this is generated on demand, so it
   *  always reflects the current geometry. */
  async shadedView(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: {
      elementKind?: string;
      width?: number;
      height?: number;
      viewMatrix?: string;
      showEdges?: boolean;
      configuration?: string;
    } = {},
  ): Promise<WrittenFile> {
    const elementKind = opts.elementKind ?? "partstudios";
    const params: Record<string, string | number | boolean | undefined> = {
      viewMatrix: opts.viewMatrix ?? ISO_VIEW,
      outputWidth: opts.width ?? 600,
      outputHeight: opts.height ?? 340,
      pixelSize: 0,
    };
    if (opts.showEdges ?? true) {
      params.edges = "show";
      params.showAllParts = "true";
    }
    if (opts.configuration) params.configuration = opts.configuration;

    const response = await this.client.get(
      `/api/v6/${elementKind}/d/${documentId}/w/${workspaceId}/e/${elementId}/shadedviews`,
      params,
    );
    const images = isRecord(response) && Array.isArray(response.images) ? response.images : [];
    if (!images.length) throw new Error(`No shaded image returned: ${JSON.stringify(response)}`);
    return write(outputPath, Buffer.from(String(images[0]), "base64"));
  }
}

function write(path: string, buffer: Buffer): WrittenFile {
  writeFileSync(path, buffer);
  return { path, bytes: buffer.byteLength, buffer };
}
