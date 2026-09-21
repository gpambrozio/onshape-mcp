/** Credential shapes shared by the store, the auth providers, and the login flows. */

export const DEFAULT_BASE_URL = "https://cad.onshape.com";
export const DEFAULT_OAUTH_URL = "https://oauth.onshape.com";

/** Onshape API key pair, sent as HTTP Basic auth. Created at https://dev.onshape.com/keys. */
export interface ApiKeyCredentials {
  kind: "apiKey";
  accessKey: string;
  secretKey: string;
  baseUrl: string;
}

/** OAuth 2.0 tokens for an app registered in the Onshape developer portal. */
export interface OAuthCredentials {
  kind: "oauth";
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires, when the server told us. */
  expiresAt?: number;
  baseUrl: string;
  oauthUrl: string;
}

export type Credentials = ApiKeyCredentials | OAuthCredentials;

export type StorageBackend = "auto" | "keychain" | "file";

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

/** Never log or return a secret in full. */
export function redactSecret(secret: string): string {
  return secret.length > 8 ? `${secret.slice(0, 3)}...${secret.slice(-3)}` : "***";
}

/** Keychain account name: the API host, so cad.onshape.com and an enterprise host coexist. */
export function accountForBaseUrl(baseUrl: string): string {
  for (const candidate of [baseUrl, `https://${baseUrl}`]) {
    try {
      return new URL(candidate).hostname;
    } catch {
      // try the next form
    }
  }
  return baseUrl;
}
