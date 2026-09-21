/** Element configurations. Derived from onshape-cli (MIT, see NOTICE). */

import type { OnshapeClient } from "./client.js";

export class ConfigurationManager {
  constructor(private readonly client: OnshapeClient) {}

  async getConfiguration(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/elements/d/${documentId}/w/${workspaceId}/e/${elementId}/configuration`);
  }

  /** [{parameterId, parameterValue}, ...] -> {encodedId, queryParam}. No workspace segment. */
  async encodeConfiguration(
    documentId: string,
    elementId: string,
    parameters: Array<Record<string, string>>,
  ): Promise<unknown> {
    return this.client.post(`/api/v6/elements/d/${documentId}/e/${elementId}/configurationencodings`, { parameters });
  }
}
