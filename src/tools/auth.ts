/** Sign-in tools.
 *
 * An MCP server cannot prompt on a terminal, so logging in means opening the
 * user's browser at a page this process serves on loopback and waiting for the
 * browser to post back. The tool call itself never blocks on a human for long:
 * it returns a "pending" status with the URL, and onshape_login_status resumes
 * the wait. */

import { z } from "zod";

import { openBrowser } from "../auth/browser.js";
import { verifyCredentials } from "../auth/verify.js";
import { activeFlow, keyPageFor, redirectUriFor, startApiKeyFlow, startOAuthFlow, type LoginFlow } from "../auth/login.js";
import { DEFAULT_BASE_URL, DEFAULT_OAUTH_URL, type Credentials } from "../auth/types.js";
import type { ToolContext } from "./context.js";
import { fail, ok, toolError } from "./shapes.js";
import type { ToolDef, ToolResult } from "./types.js";

const DEFAULT_WAIT_SECONDS = 20;
const MAX_WAIT_SECONDS = 120;
const DEFAULT_OAUTH_PORT = 8471;

const waitShape = z
  .number()
  .int()
  .min(0)
  .max(MAX_WAIT_SECONDS)
  .optional()
  .describe(`Seconds to wait for the browser before returning (default ${DEFAULT_WAIT_SECONDS}).`);

const storeShape = z
  .enum(["auto", "keychain", "file"])
  .optional()
  .describe("Where to keep the credential: auto (keychain, else file), keychain, or file.");

export const authTools: ToolDef[] = ([
  {
    name: "onshape_login",
    title: "Sign in to Onshape",
    description:
      "Sign in to Onshape by opening a browser. method='api_key' (default) opens a local page that links to the " +
      "Onshape developer key page and accepts the pasted key pair. method='oauth' runs the OAuth 2.0 " +
      "authorization-code flow against an app you registered in the Onshape developer portal. The credential is " +
      "verified against Onshape and stored in the OS keychain. Returns immediately with status 'pending' if the " +
      "user has not finished yet — poll with onshape_login_status.",
    inputSchema: {
      method: z.enum(["api_key", "oauth"]).optional().describe("Login method (default api_key)."),
      base_url: z.string().optional().describe(`Onshape API base URL (default ${DEFAULT_BASE_URL}).`),
      client_id: z.string().optional().describe("OAuth client id; also read from ONSHAPE_OAUTH_CLIENT_ID."),
      client_secret: z.string().optional().describe("OAuth client secret; also read from ONSHAPE_OAUTH_CLIENT_SECRET."),
      oauth_url: z.string().optional().describe(`OAuth server (default ${DEFAULT_OAUTH_URL}).`),
      scope: z.string().optional().describe("Space-separated OAuth scopes, when the app needs them stated."),
      port: z.number().int().optional().describe(`Loopback port for the callback (OAuth default ${DEFAULT_OAUTH_PORT}).`),
      store: storeShape,
      wait_seconds: waitShape,
    },
    annotations: { openWorldHint: true },
    handler: async (args, ctx) => {
      const method = (args.method ?? "api_key") as "api_key" | "oauth";
      const baseUrl = (args.base_url as string | undefined) ?? DEFAULT_BASE_URL;
      const accept = acceptor(ctx, args.store);

      try {
        const flow =
          method === "oauth"
            ? await startOAuth(args, baseUrl, accept)
            : await startApiKeyFlow({ baseUrl, accept, port: args.port });
        if (typeof flow === "string") return ok(ctx, { status: "setup_required", instructions: flow });

        await openBrowser(flow.url);
        return await report(ctx, flow, waitMs(args.wait_seconds), method, baseUrl);
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_login_status",
    title: "Check the pending Onshape login",
    description:
      "Wait for, and report on, the login started by onshape_login. Call this repeatedly while the user is in the " +
      "browser; each call waits up to wait_seconds before returning.",
    inputSchema: { wait_seconds: waitShape },
    annotations: { readOnlyHint: true },
    handler: async (args, ctx) => {
      const flow = activeFlow();
      if (!flow) return fail("No login is in progress. Call onshape_login first.");
      return report(ctx, flow, waitMs(args.wait_seconds));
    },
  },
  {
    name: "onshape_set_api_key",
    title: "Store an Onshape API key pair",
    description:
      "Store an Onshape access key and secret key directly, without a browser. Use when the user already has a key " +
      "pair from https://cad.onshape.com/user/developer/apiKeys. The pair is verified against Onshape before it is saved.",
    inputSchema: {
      access_key: z.string().min(1).describe("Onshape access key."),
      secret_key: z.string().min(1).describe("Onshape secret key."),
      base_url: z.string().optional().describe(`Onshape API base URL (default ${DEFAULT_BASE_URL}).`),
      store: storeShape,
    },
    handler: async (args, ctx) => {
      try {
        const message = await acceptor(ctx, args.store)({
          kind: "apiKey",
          accessKey: args.access_key,
          secretKey: args.secret_key,
          baseUrl: args.base_url ?? DEFAULT_BASE_URL,
        });
        return ok(ctx, { status: "complete", message, ...ctx.store.describe() });
      } catch (error) {
        return toolError(error);
      }
    },
  },
  {
    name: "onshape_auth_status",
    title: "Show Onshape sign-in status",
    description:
      "Report which Onshape credential is active, where it came from and whether it still works. Secrets are redacted.",
    inputSchema: {
      verify: z.boolean().optional().describe("Also make a live API call to confirm the credential (default true)."),
    },
    annotations: { readOnlyHint: true },
    handler: async (args, ctx) => {
      const described = ctx.store.describe();
      if (!described.configured || args.verify === false) return ok(ctx, described);
      const creds = ctx.store.resolve();
      if (!creds) return ok(ctx, described);
      try {
        const identity = await verifyCredentials(creds, ctx.store);
        return ok(ctx, { ...described, valid: true, message: identity.message, user: identity.user ?? null });
      } catch (error) {
        return ok(ctx, {
          ...described,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  },
  {
    name: "onshape_logout",
    title: "Forget stored Onshape credentials",
    description:
      "Delete the credential this server stored (keychain entry and config file). Credentials coming from " +
      "environment variables or from an existing onshape-cli install are not touched.",
    inputSchema: {},
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: async (_args, ctx) => {
      const result = ctx.store.clear();
      ctx.reset();
      return ok(ctx, result);
    },
  },
  // Signing in cannot itself require being signed in.
] as ToolDef[]).map((tool) => ({ ...tool, requiresAuth: false }));

/** Verify, persist, and refresh the cached client. Returns the browser message. */
function acceptor(ctx: ToolContext, store?: "auto" | "keychain" | "file") {
  return (creds: Credentials): Promise<string> => ctx.acceptCredentials(creds, store ?? "auto");
}

async function startOAuth(
  args: Record<string, any>,
  baseUrl: string,
  accept: (creds: Credentials) => Promise<string>,
): Promise<LoginFlow | string> {
  const clientId = args.client_id ?? process.env.ONSHAPE_OAUTH_CLIENT_ID;
  const clientSecret = args.client_secret ?? process.env.ONSHAPE_OAUTH_CLIENT_SECRET;
  const port = (args.port as number | undefined) ?? DEFAULT_OAUTH_PORT;

  if (!clientId || !clientSecret) {
    return [
      "OAuth needs an app registered in the Onshape developer portal first:",
      "  1. Open https://cad.onshape.com/appstore/dev-portal and create an OAuth application.",
      `  2. Set its redirect URL to exactly ${redirectUriFor(port)}`,
      "  3. Copy the OAuth client id and secret (the secret is shown only once).",
      "  4. Call onshape_login again with method='oauth', client_id and client_secret.",
      "",
      "If a browser paste flow is enough, method='api_key' needs no app registration.",
    ].join("\n");
  }

  return startOAuthFlow({
    clientId,
    clientSecret,
    baseUrl,
    oauthUrl: args.oauth_url ?? DEFAULT_OAUTH_URL,
    scope: args.scope,
    port,
    accept,
  });
}

async function report(
  ctx: ToolContext,
  flow: LoginFlow,
  ms: number,
  method?: string,
  baseUrl?: string,
): Promise<ToolResult> {
  const state = await flow.wait(ms);
  if (state === "complete") {
    return ok(ctx, { status: "complete", message: flow.message, ...ctx.store.describe() });
  }
  if (state === "error" || state === "cancelled") {
    return fail(flow.error ?? `Login ${state}.`);
  }
  return ok(ctx, {
    status: "pending",
    open_this_url: flow.url,
    expires_at: new Date(flow.expiresAt).toISOString(),
    next_step: "Ask the user to finish in the browser, then call onshape_login_status.",
    ...(method === "api_key" && baseUrl
      ? {
          onshape_key_page: keyPageFor(baseUrl),
          key_permissions: "The key needs Read, Write and Delete ticked for every tool here to work.",
        }
      : {}),
    ...(flow.redirectUri ? { registered_redirect_url: flow.redirectUri } : {}),
  });
}

function waitMs(seconds: unknown): number {
  const value = typeof seconds === "number" ? seconds : DEFAULT_WAIT_SECONDS;
  return Math.min(Math.max(value, 0), MAX_WAIT_SECONDS) * 1000;
}
