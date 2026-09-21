/** Assemblies: instances, mates, BOM, transforms.
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";

export class AssemblyManager {
  constructor(private readonly client: OnshapeClient) {}

  async createAssembly(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}`, { name });
  }

  async getFeatures(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features`);
  }

  async getBom(
    documentId: string,
    workspaceId: string,
    elementId: string,
    opts: { indented?: boolean; multiLevel?: boolean; generateIfAbsent?: boolean } = {},
  ): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/bom`, {
      indented: String(opts.indented ?? true),
      multiLevel: String(opts.multiLevel ?? false),
      generateIfAbsent: String(opts.generateIfAbsent ?? true),
    });
  }

  async massProperties(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/massproperties`);
  }

  async insertInstance(
    documentId: string,
    workspaceId: string,
    elementId: string,
    opts: {
      sourceDocumentId: string;
      sourceElementId: string;
      partId?: string;
      sourceVersionId?: string;
      isAssembly?: boolean;
      isWholePartStudio?: boolean;
      configuration?: string;
    },
  ): Promise<unknown> {
    const body: Record<string, unknown> = { documentId: opts.sourceDocumentId, elementId: opts.sourceElementId };
    if (opts.sourceVersionId) body.versionId = opts.sourceVersionId;
    if (opts.partId) {
      body.partId = opts.partId;
      body.includePartTypes = ["PARTS"];
    }
    if (opts.isAssembly) body.isAssembly = true;
    if (opts.isWholePartStudio) body.isWholePartStudio = true;
    if (opts.configuration) body.configuration = opts.configuration;
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/instances`, body);
  }

  async addFeature(documentId: string, workspaceId: string, elementId: string, feature: unknown): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, feature);
  }

  async deleteInstance(documentId: string, workspaceId: string, elementId: string, nodeId: string): Promise<unknown> {
    return this.client.delete(
      `/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/instance/nodeid/${nodeId}`,
    );
  }

  /** Apply a 16-float row-major 4x4 transform to occurrence paths (POST, not PATCH). */
  async transformOccurrences(
    documentId: string,
    workspaceId: string,
    elementId: string,
    occurrencePaths: string[][],
    transform: number[],
    opts: { isRelative?: boolean } = {},
  ): Promise<unknown> {
    return this.client.post(`/api/v6/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/occurrencetransforms`, {
      isRelative: opts.isRelative ?? true,
      occurrences: occurrencePaths.map((path) => ({ path })),
      transform,
    });
  }
}
