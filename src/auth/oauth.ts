/** Onshape OAuth 2.0 (authorization code grant).
 *
 * Register an app at https://cad.onshape.com/appstore/dev-portal with the
 * redirect URL this server listens on. Onshape allows http://localhost:<port>
 * redirects for installed applications; every other redirect must be https. */

import { DEFAULT_BASE_URL, DEFAULT_OAUTH_URL, type OAuthCredentials } from "./types.js";

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  oauthUrl?: string;
  scope?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export function authorizeUrl(config: OAuthAppConfig, redirectUri: string, state: string): string {
  const url = new URL("/oauth/authorize", config.oauthUrl ?? DEFAULT_OAUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (config.scope) url.searchParams.set("scope", config.scope);
  return url.toString();
}

export async function exchangeCode(
  config: OAuthAppConfig,
  code: string,
  redirectUri: string,
): Promise<OAuthCredentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const token = await postToken(config.oauthUrl ?? DEFAULT_OAUTH_URL, body);
  return toCredentials(config, token);
}

/** Trade the refresh token for a fresh access token. Onshape rotates refresh
 *  tokens, so the caller must persist the result. */
export async function refreshTokens(creds: OAuthCredentials): Promise<OAuthCredentials> {
  if (!creds.refreshToken) {
    throw new Error("No refresh token stored; run onshape_login again.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const token = await postToken(creds.oauthUrl, body);
  return {
    ...creds,
    accessToken: token.access_token as string,
    refreshToken: token.refresh_token ?? creds.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  };
}

async function postToken(oauthUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(new URL("/oauth/token", oauthUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload: TokenResponse;
  try {
    payload = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Token endpoint returned HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  if (!response.ok || payload.error || !payload.access_token) {
    const detail = payload.error_description ?? payload.error ?? text.slice(0, 400);
    throw new Error(`Token endpoint returned HTTP ${response.status}: ${detail}`);
  }
  return payload;
}

function toCredentials(config: OAuthAppConfig, token: TokenResponse): OAuthCredentials {
  return {
    kind: "oauth",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: token.access_token as string,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    oauthUrl: config.oauthUrl ?? DEFAULT_OAUTH_URL,
  };
}
