/** Browser login flows driven from an MCP tool call.
 *
 * An MCP server has no terminal to prompt on, so both flows work the same way:
 * start a one-shot HTTP server on the loopback interface, open the user's
 * browser at it, and resolve when the browser posts back. The tool call returns
 * as soon as the browser is open, so the client never blocks on a human. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";

import { apiKeyForm, errorPage, successPage } from "./pages.js";
import { authorizeUrl, exchangeCode, type OAuthAppConfig } from "./oauth.js";
import { DEFAULT_BASE_URL, DEFAULT_OAUTH_URL, type Credentials } from "./types.js";

export type FlowKind = "api_key" | "oauth";
export type FlowState = "pending" | "complete" | "error" | "cancelled";

/** Accepting the credentials: verify them against Onshape and persist them.
 *  Throwing here surfaces the message in the browser so the user can retry. */
export type AcceptCredentials = (creds: Credentials) => Promise<string>;

const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;

export interface LoginFlow {
  readonly id: string;
  readonly kind: FlowKind;
  /** Where the user needs to go. Already opened in their browser when possible. */
  readonly url: string;
  readonly redirectUri?: string;
  readonly expiresAt: number;
  readonly state: FlowState;
  readonly error?: string;
  readonly message?: string;
  /** Resolves with the state once it settles, or on timeout while still pending. */
  wait(ms: number): Promise<FlowState>;
  cancel(): void;
}

class Flow implements LoginFlow {
  readonly id = randomUUID();
  state: FlowState = "pending";
  error?: string;
  message?: string;
  private settle!: () => void;
  private readonly settled: Promise<void>;
  private timer: NodeJS.Timeout;

  constructor(
    readonly kind: FlowKind,
    readonly url: string,
    readonly expiresAt: number,
    private readonly server: Server,
    readonly redirectUri?: string,
  ) {
    this.settled = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
    this.timer = setTimeout(() => this.finish("error", undefined, "Login timed out."), expiresAt - Date.now());
    this.timer.unref?.();
  }

  async wait(ms: number): Promise<FlowState> {
    if (this.state !== "pending") return this.state;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, ms));
    });
    await Promise.race([this.settled, deadline]);
    if (timer) clearTimeout(timer);
    return this.state;
  }

  cancel(): void {
    this.finish("cancelled", undefined, "Login cancelled.");
  }

  finish(state: FlowState, message?: string, error?: string): void {
    if (this.state !== "pending") return;
    this.state = state;
    this.message = message;
    this.error = error;
    clearTimeout(this.timer);
    this.server.close();
    this.server.closeAllConnections?.();
    // An abandoned sign-in is not something to report on later; a completed or
    // failed one is, so onshape_login_status can still explain what happened.
    if (state === "cancelled" && current === this) current = null;
    this.settle();
  }
}

let current: Flow | null = null;

export function activeFlow(): LoginFlow | null {
  return current;
}

export interface ApiKeyFlowOptions {
  baseUrl?: string;
  /** 0 picks a free port; the browser is opened for us so the port can float. */
  port?: number;
  ttlMs?: number;
  accept: AcceptCredentials;
}

/** Serve a local page that links to the Onshape key page and takes the pasted pair. */
export async function startApiKeyFlow(options: ApiKeyFlowOptions): Promise<LoginFlow> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const nonce = randomUUID();
  const keysUrl = keyPageFor(baseUrl);

  let flow: Flow;
  const server = createServer((req, res) => {
    void handleApiKeyRequest(req, res, { nonce, baseUrl, keysUrl, accept: options.accept, flow: () => flow });
  });

  const { port } = await listen(server, options.port ?? 0);
  const url = `http://127.0.0.1:${port}/?nonce=${nonce}`;
  flow = new Flow("api_key", url, Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS), server);
  current = flow;
  return flow;
}

export interface OAuthFlowOptions extends OAuthAppConfig {
  /** Must match the redirect URL registered for the app in the dev portal. */
  port?: number;
  ttlMs?: number;
  accept: AcceptCredentials;
}

export async function startOAuthFlow(options: OAuthFlowOptions): Promise<LoginFlow> {
  const nonce = randomUUID();
  const config: OAuthAppConfig = {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    oauthUrl: options.oauthUrl ?? DEFAULT_OAUTH_URL,
    scope: options.scope,
  };

  let flow: Flow;
  let redirectUri = "";
  const server = createServer((req, res) => {
    void handleOAuthRequest(req, res, {
      nonce,
      config,
      redirectUri,
      accept: options.accept,
      flow: () => flow,
    });
  });

  const { port } = await listen(server, options.port ?? 8471);
  redirectUri = redirectUriFor(port);
  const url = authorizeUrl(config, redirectUri, nonce);
  flow = new Flow("oauth", url, Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS), server, redirectUri);
  current = flow;
  return flow;
}

export function redirectUriFor(port: number): string {
  return `http://localhost:${port}/oauth/callback`;
}

/** Onshape hosts developer keys on the dev subdomain of the account's stack. */
export function keyPageFor(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "cad.onshape.com") return "https://dev.onshape.com/keys";
    return `https://${host}/appstore/dev-portal/keys`;
  } catch {
    return "https://dev.onshape.com/keys";
  }
}

interface ApiKeyContext {
  nonce: string;
  baseUrl: string;
  keysUrl: string;
  accept: AcceptCredentials;
  flow: () => Flow;
}

async function handleApiKeyRequest(req: IncomingMessage, res: ServerResponse, ctx: ApiKeyContext): Promise<void> {
  if (!isLocalRequest(req)) return send(res, 403, errorPage("Refused a non-local request."));
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/") {
    if (url.searchParams.get("nonce") !== ctx.nonce) {
      return send(res, 403, errorPage("This login link is no longer valid. Start the login again."));
    }
    return send(res, 200, apiKeyForm({ nonce: ctx.nonce, baseUrl: ctx.baseUrl, keysUrl: ctx.keysUrl }));
  }

  if (req.method === "POST" && url.pathname === "/submit") {
    const form = await readForm(req);
    if (form.get("nonce") !== ctx.nonce) {
      return send(res, 403, errorPage("This form is no longer valid. Start the login again."));
    }
    const accessKey = (form.get("access_key") ?? "").trim();
    const secretKey = (form.get("secret_key") ?? "").trim();
    const baseUrl = (form.get("base_url") ?? "").trim() || ctx.baseUrl;
    if (!accessKey || !secretKey) {
      return send(
        res,
        400,
        apiKeyForm({ nonce: ctx.nonce, baseUrl, keysUrl: ctx.keysUrl, error: "Both keys are required." }),
      );
    }

    try {
      const message = await ctx.accept({ kind: "apiKey", accessKey, secretKey, baseUrl });
      send(res, 200, successPage(message));
      ctx.flow().finish("complete", message);
    } catch (error) {
      // Keep the flow open so the user can correct a typo without restarting.
      const detail = error instanceof Error ? error.message : String(error);
      send(res, 400, apiKeyForm({ nonce: ctx.nonce, baseUrl, keysUrl: ctx.keysUrl, error: detail }));
    }
    return;
  }

  send(res, 404, errorPage("Not found."));
}

interface OAuthContext {
  nonce: string;
  config: OAuthAppConfig;
  redirectUri: string;
  accept: AcceptCredentials;
  flow: () => Flow;
}

async function handleOAuthRequest(req: IncomingMessage, res: ServerResponse, ctx: OAuthContext): Promise<void> {
  if (!isLocalRequest(req)) return send(res, 403, errorPage("Refused a non-local request."));
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/oauth/callback") return send(res, 404, errorPage("Not found."));

  const fail = (message: string): void => {
    send(res, 400, errorPage(message));
    ctx.flow().finish("error", undefined, message);
  };

  const error = url.searchParams.get("error");
  if (error) {
    return fail(`Onshape refused the authorization: ${url.searchParams.get("error_description") ?? error}`);
  }
  if (url.searchParams.get("state") !== ctx.nonce) {
    return fail("State mismatch — the callback did not come from the login that was started.");
  }
  const code = url.searchParams.get("code");
  if (!code) return fail("Onshape did not return an authorization code.");

  try {
    const creds = await exchangeCode(ctx.config, code, ctx.redirectUri);
    const message = await ctx.accept(creds);
    send(res, 200, successPage(message));
    ctx.flow().finish("complete", message);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Reject anything that did not address us as loopback: a browser following a
 *  rebound DNS name would arrive with a different Host header. */
function isLocalRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function listen(server: Server, port: number): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ port: address.port });
    });
  });
}
