/** Turns stored credentials into an Authorization header for the HTTP client,
 *  and knows how to recover when a token has expired. */

import { refreshTokens } from "./oauth.js";
import type { CredentialStore } from "./store.js";
import type { Credentials } from "./types.js";

/** Refresh this long before the token actually expires, so an in-flight request
 *  does not race the expiry. */
const REFRESH_SKEW_MS = 60_000;

export interface AuthProvider {
  readonly baseUrl: string;
  /** The Authorization header value for the next request. */
  header(): Promise<string>;
  /** Called after a 401. Returns true when the caller should retry once. */
  recover(): Promise<boolean>;
}

export function createAuthProvider(creds: Credentials, store: CredentialStore): AuthProvider {
  return creds.kind === "apiKey" ? new ApiKeyAuth(creds) : new OAuthAuth(creds, store);
}

class ApiKeyAuth implements AuthProvider {
  readonly baseUrl: string;
  private readonly value: string;

  constructor(creds: Extract<Credentials, { kind: "apiKey" }>) {
    this.baseUrl = creds.baseUrl;
    this.value = `Basic ${Buffer.from(`${creds.accessKey}:${creds.secretKey}`).toString("base64")}`;
  }

  async header(): Promise<string> {
    return this.value;
  }

  async recover(): Promise<boolean> {
    return false;
  }
}

class OAuthAuth implements AuthProvider {
  private creds: Extract<Credentials, { kind: "oauth" }>;
  private readonly store: CredentialStore;
  private inFlight: Promise<void> | null = null;

  constructor(creds: Extract<Credentials, { kind: "oauth" }>, store: CredentialStore) {
    this.creds = creds;
    this.store = store;
  }

  get baseUrl(): string {
    return this.creds.baseUrl;
  }

  async header(): Promise<string> {
    if (this.isExpiring()) await this.refresh();
    return `Bearer ${this.creds.accessToken}`;
  }

  async recover(): Promise<boolean> {
    if (!this.creds.refreshToken) return false;
    await this.refresh();
    return true;
  }

  private isExpiring(): boolean {
    if (!this.creds.expiresAt) return false;
    return this.creds.expiresAt - REFRESH_SKEW_MS <= Date.now();
  }

  /** Concurrent requests share one refresh; Onshape rotates refresh tokens, so
   *  two parallel refreshes would invalidate each other. */
  private async refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = refreshTokens(this.creds)
        .then((next) => {
          this.creds = next;
          this.store.save(next);
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    await this.inFlight;
  }
}
