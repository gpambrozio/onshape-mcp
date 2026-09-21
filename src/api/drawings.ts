/** Drawings. Export goes through ExportManager.exportTranslation(kind="drawings").
 *  Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";

export class DrawingManager {
  constructor(private readonly client: OnshapeClient) {}

  /** Drawings reference their source by version, so create a version first. */
  async createDrawing(
    documentId: string,
    workspaceId: string,
    opts: { name: string; sourceElementId: string; sourceVersionId: string; sourceDocumentId?: string; partId?: string },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      drawingName: opts.name,
      externalDocumentId: opts.sourceDocumentId ?? documentId,
      externalDocumentVersionId: opts.sourceVersionId,
      elementId: opts.sourceElementId,
    };
    if (opts.partId) body.partId = opts.partId;
    return this.client.post(`/api/v6/drawings/d/${documentId}/w/${workspaceId}/create`, body);
  }

  async getViews(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/drawings/d/${documentId}/w/${workspaceId}/e/${elementId}/views`);
  }
}
