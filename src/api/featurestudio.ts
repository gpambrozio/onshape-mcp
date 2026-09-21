/** Feature Studios (FeatureScript source elements).
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";

export class FeatureStudioManager {
  constructor(private readonly client: OnshapeClient) {}

  async create(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}`, { name });
  }

  async getContents(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async setContents(documentId: string, workspaceId: string, elementId: string, contents: string): Promise<unknown> {
    return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`, { contents });
  }

  async getSpecs(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
  }
}
