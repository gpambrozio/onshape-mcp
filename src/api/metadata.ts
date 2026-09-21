/** Element and part properties. Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";

export class MetadataManager {
  constructor(private readonly client: OnshapeClient) {}

  async getElementMetadata(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async getPartMetadata(documentId: string, workspaceId: string, elementId: string, partId: string): Promise<unknown> {
    return this.client.get(`/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${partId}`);
  }

  /** `properties` is [{propertyId, value}, ...]. POST, not PATCH (PATCH is 405),
   *  and Onshape only accepts editable, non-null properties. */
  async setElementMetadata(
    documentId: string,
    workspaceId: string,
    elementId: string,
    properties: Array<Record<string, unknown>>,
    partId?: string,
  ): Promise<unknown> {
    const path = partId
      ? `/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${partId}`
      : `/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`;
    return this.client.post(path, { properties });
  }
}
