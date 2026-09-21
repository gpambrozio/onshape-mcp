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
import { openBrowser } from "../auth/browser.js";
import { startApiKeyFlow, startOAuthFlow, type LoginFlow } from "../auth/login.js";
import { noPrompter, type AuthPrompter } from "../auth/prompt.js";
import { createAuthProvider } from "../auth/provider.js";
import { CredentialStore } from "../auth/store.js";
import { verifyCredentials } from "../auth/verify.js";
import { CredentialError, DEFAULT_BASE_URL, DEFAULT_OAUTH_URL, type Credentials, type StorageBackend } from "../auth/types.js";

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

/** How long a tool call waits for the user to finish in the browser before
 *  giving up and telling them to resume with onshape_login_status. */
function signInWaitMs(): number {
  const configured = Number(process.env.ONSHAPE_MCP_SIGNIN_WAIT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

/** Opt out of starting a browser sign-in from an ordinary tool call, for
 *  headless or unattended deployments that configure credentials by hand. */
function autoLoginEnabled(): boolean {
  const value = process.env.ONSHAPE_MCP_AUTO_LOGIN;
  return value === undefined || (value !== "0" && value.toLowerCase() !== "false");
}

export interface EnsureAuthResult {
  ok: boolean;
  /** Set when sign-in could not be completed; ready to show to the user. */
  message?: string;
  url?: string;
}

export class ToolContext {
  readonly store = new CredentialStore();
  /** Set by the server once a client is connected. */
  prompter: AuthPrompter = noPrompter;
  private cached: Api | null = null;
  private credentials: Credentials | null = null;
  private signingIn: Promise<EnsureAuthResult> | null = null;

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
    const creds = this.resolveCredentials();
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

  /** Drop the cached client and credential after a login, logout or key change. */
  reset(): void {
    this.cached = null;
    this.credentials = null;
  }

  /** Resolving hits the OS keychain, which is slow and can prompt, so the
   *  answer is held until something invalidates it. */
  private resolveCredentials(): Credentials | null {
    if (!this.credentials) this.credentials = this.store.resolve();
    return this.credentials;
  }

  resolveOutputPath(path: string): string {
    return isAbsolute(path) ? path : resolve(this.outputDir, path);
  }

  hasCredentials(): boolean {
    return this.resolveCredentials() !== null;
  }

  /** Verify a credential, store it, and start using it. Returns the line shown
   *  to the user in the browser. */
  async acceptCredentials(creds: Credentials, mode: StorageBackend = "auto"): Promise<string> {
    const identity = await verifyCredentials(creds, this.store);
    const saved = this.store.save(creds, mode);
    this.reset();
    const where = saved.backend === "keychain" ? "your keychain" : saved.path;
    return `${identity.message} Credentials saved to ${where}.`;
  }

  /** Called before any tool that needs Onshape. When nothing is stored, start a
   *  browser sign-in and ask the client to put the link in front of the user, so
   *  installing the server is all the setup there is. */
  async ensureAuthenticated(): Promise<EnsureAuthResult> {
    if (this.hasCredentials()) return { ok: true };
    if (!this.signingIn) {
      this.signingIn = this.signIn().finally(() => {
        this.signingIn = null;
      });
    }
    return this.signingIn;
  }

  private async signIn(): Promise<EnsureAuthResult> {
    if (!autoLoginEnabled()) return { ok: false, message: LOGIN_HINT };
    const flow = await this.startSignInFlow();

    const outcome = this.prompter.canPrompt()
      ? await this.prompter.prompt({
          message: "Connect this server to your Onshape account to continue.",
          url: flow.url,
          elicitationId: flow.id,
        })
      : "unsupported";

    if (outcome === "unsupported") {
      // The client cannot put a link in front of the user, so open the browser
      // here and hand the URL back for the assistant to pass on.
      await openBrowser(flow.url);
      return {
        ok: false,
        url: flow.url,
        message:
          `Onshape sign-in required. Open ${flow.url} to connect this server ` +
          "(the browser should already be opening), then retry. onshape_login_status reports progress.",
      };
    }

    if (outcome !== "accept") {
      flow.cancel();
      return { ok: false, message: `Onshape sign-in was ${outcome === "decline" ? "declined" : "cancelled"}.` };
    }

    const state = await flow.wait(signInWaitMs());
    await this.prompter.complete(flow.id);

    if (state === "complete" && this.hasCredentials()) return { ok: true };
    if (state === "pending") {
      return {
        ok: false,
        url: flow.url,
        message: `Still waiting for the Onshape sign-in at ${flow.url}. Call onshape_login_status once it is done.`,
      };
    }
    return { ok: false, message: flow.error ?? `Onshape sign-in ${state}.` };
  }

  /** OAuth when an app is configured, otherwise the API-key paste page. */
  private startSignInFlow(): Promise<LoginFlow> {
    const accept = (creds: Credentials) => this.acceptCredentials(creds);
    const baseUrl = process.env.ONSHAPE_BASE_URL ?? DEFAULT_BASE_URL;
    const clientId = process.env.ONSHAPE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.ONSHAPE_OAUTH_CLIENT_SECRET;

    if (clientId && clientSecret) {
      return startOAuthFlow({
        clientId,
        clientSecret,
        baseUrl,
        oauthUrl: process.env.ONSHAPE_OAUTH_URL ?? DEFAULT_OAUTH_URL,
        scope: process.env.ONSHAPE_OAUTH_SCOPE,
        accept,
      });
    }
    return startApiKeyFlow({ baseUrl, accept });
  }
}
