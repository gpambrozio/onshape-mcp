/** Everything a tool handler needs: an authenticated client, the API managers,
 *  and where to put files it writes. */

import { isAbsolute, resolve } from "node:path";

import { OnshapeClient } from "../api/client.js";
import { AssemblyManager } from "../api/assemblies.js";
import { ConfigurationManager } from "../api/configurations.js";
import { DocumentManager } from "../api/documents.js";
import { DrawingManager } from "../api/drawings.js";
import { EdgeQuery } from "../api/edges.js";
import { ExportManager } from "../api/export.js";
import { FeatureStudioManager } from "../api/featurestudio.js";
import { MetadataManager } from "../api/metadata.js";
import { PartStudioManager } from "../api/partstudio.js";
import { VariableManager } from "../api/variables.js";
import { createAuthProvider } from "../auth/provider.js";
import { CredentialStore } from "../auth/store.js";
import { CredentialError } from "../auth/types.js";

export interface Api {
  client: OnshapeClient;
  documents: DocumentManager;
  partStudios: PartStudioManager;
  featureStudios: FeatureStudioManager;
  edges: EdgeQuery;
  exports: ExportManager;
  variables: VariableManager;
  configurations: ConfigurationManager;
  assemblies: AssemblyManager;
  drawings: DrawingManager;
  metadata: MetadataManager;
}

const LOGIN_HINT =
  "Not signed in to Onshape. Call onshape_login (opens a browser) or onshape_set_api_key if you already have a key pair.";

export class ToolContext {
  readonly store = new CredentialStore();
  private cached: Api | null = null;

  /** The directory exports and renders are written to when a relative path is given. */
  get outputDir(): string {
    return process.env.ONSHAPE_MCP_OUTPUT_DIR ?? process.cwd();
  }

  /** Responses bigger than this are spilled to a file instead of the transcript. */
  get maxResponseBytes(): number {
    const configured = Number(process.env.ONSHAPE_MCP_MAX_RESPONSE_BYTES);
    return Number.isFinite(configured) && configured > 0 ? configured : 200_000;
  }

  api(): Api {
    if (this.cached) return this.cached;
    const creds = this.store.resolve();
    if (!creds) throw new CredentialError(LOGIN_HINT);
    const client = new OnshapeClient(createAuthProvider(creds, this.store));
    this.cached = {
      client,
      documents: new DocumentManager(client),
      partStudios: new PartStudioManager(client),
      featureStudios: new FeatureStudioManager(client),
      edges: new EdgeQuery(client),
      exports: new ExportManager(client),
      variables: new VariableManager(client),
      configurations: new ConfigurationManager(client),
      assemblies: new AssemblyManager(client),
      drawings: new DrawingManager(client),
      metadata: new MetadataManager(client),
    };
    return this.cached;
  }

  /** Drop the cached client after a login, logout or key change. */
  reset(): void {
    this.cached = null;
  }

  resolveOutputPath(path: string): string {
    return isAbsolute(path) ? path : resolve(this.outputDir, path);
  }
}
