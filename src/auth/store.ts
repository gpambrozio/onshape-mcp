/** Where credentials live, and in what order they are trusted.
 *
 * Resolution order:
 *   1. ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY environment variables
 *   2. this server's own store (keychain entry, or ~/.onshape-mcp/credentials.json)
 *   3. an existing onshape-cli install (~/.onshape/credentials.json, keychain
 *      service "onshape-cli"), so anyone already using the CLI needs no login
 *
 * Secrets go to the OS keychain when it is available; the JSON file then holds
 * only non-secret metadata. Without a keychain the file holds the secret and is
 * written 0600 in a 0700 directory. */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { keychainAvailable, keychainDelete, keychainGet, keychainSet } from "./keychain.js";
import {
  accountForBaseUrl,
  DEFAULT_BASE_URL,
  DEFAULT_OAUTH_URL,
  redactSecret,
  type Credentials,
  type StorageBackend,
} from "./types.js";

const LEGACY_CLI_SERVICE = "onshape-cli";

export interface SaveResult {
  saved: true;
  backend: "keychain" | "file";
  path: string;
  account?: string;
  keychainError?: string;
}

interface StoredFile {
  backend?: "keychain" | "file";
  kind?: "apiKey" | "oauth";
  account?: string;
  base_url?: string;
  oauth_url?: string;
  access_key?: string;
  secret_key?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeSecureJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    // Best effort: some filesystems reject chmod.
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort, as above.
  }
}

export class CredentialStore {
  configPath(): string {
    const override = process.env.ONSHAPE_MCP_CONFIG;
    if (override) return expandHome(override);
    return join(homedir(), ".onshape-mcp", "credentials.json");
  }

  legacyConfigPath(): string {
    const override = process.env.ONSHAPE_CONFIG;
    if (override) return expandHome(override);
    return join(homedir(), ".onshape", "credentials.json");
  }

  /** Credentials to use, or null when the user has not logged in anywhere. */
  resolve(): Credentials | null {
    return this.fromEnv() ?? this.fromOwnStore() ?? this.fromLegacyCli();
  }

  fromEnv(): Credentials | null {
    const accessKey = process.env.ONSHAPE_ACCESS_KEY;
    const secretKey = process.env.ONSHAPE_SECRET_KEY;
    if (!accessKey || !secretKey) return null;
    return {
      kind: "apiKey",
      accessKey,
      secretKey,
      baseUrl: process.env.ONSHAPE_BASE_URL ?? DEFAULT_BASE_URL,
    };
  }

  fromOwnStore(): Credentials | null {
    return this.credentialsFromFile(this.configPath(), "onshape-mcp");
  }

  fromLegacyCli(): Credentials | null {
    return this.credentialsFromFile(this.legacyConfigPath(), LEGACY_CLI_SERVICE);
  }

  save(creds: Credentials, mode: StorageBackend = "auto"): SaveResult {
    const path = this.configPath();
    const account = accountForBaseUrl(creds.baseUrl);
    let keychainError: string | undefined;

    if (mode === "auto" || mode === "keychain") {
      const result = keychainSet(account, JSON.stringify(creds));
      if (result.ok) {
        writeSecureJson(path, this.publicFields(creds, "keychain", account));
        return { saved: true, backend: "keychain", path, account };
      }
      keychainError = result.error;
      if (mode === "keychain") {
        throw new Error(`Keychain storage failed: ${result.error}`);
      }
    }

    writeSecureJson(path, { ...this.publicFields(creds, "file", account), ...this.secretFields(creds) });
    return { saved: true, backend: "file", path, keychainError };
  }

  clear(): { cleared: boolean; path: string; keychain_deleted: boolean } {
    const path = this.configPath();
    const data = readJson(path) as StoredFile;
    const existed = existsSync(path);
    if (existed) rmSync(path);
    const account = data.account ?? accountForBaseUrl(data.base_url ?? DEFAULT_BASE_URL);
    const keychainDeleted = keychainDelete(account);
    return { cleared: existed || keychainDeleted, path, keychain_deleted: keychainDeleted };
  }

  /** A redacted description of the active credentials, safe to hand to a model. */
  describe(): Record<string, unknown> {
    const env = this.fromEnv();
    if (env) return { configured: true, source: "environment", ...this.summary(env) };

    const own = this.fromOwnStore();
    if (own) {
      const stored = readJson(this.configPath()) as StoredFile;
      return {
        configured: true,
        source: "onshape-mcp",
        path: this.configPath(),
        backend: stored.backend ?? "file",
        ...this.summary(own),
      };
    }

    const legacy = this.fromLegacyCli();
    if (legacy) {
      return {
        configured: true,
        source: "onshape-cli",
        path: this.legacyConfigPath(),
        ...this.summary(legacy),
      };
    }

    return {
      configured: false,
      path: this.configPath(),
      base_url: DEFAULT_BASE_URL,
      keychain_available: keychainAvailable(),
    };
  }

  private summary(creds: Credentials): Record<string, unknown> {
    if (creds.kind === "apiKey") {
      return {
        kind: "apiKey",
        base_url: creds.baseUrl,
        access_key: creds.accessKey,
        secret_key: redactSecret(creds.secretKey),
      };
    }
    return {
      kind: "oauth",
      base_url: creds.baseUrl,
      oauth_url: creds.oauthUrl,
      client_id: creds.clientId,
      access_token: redactSecret(creds.accessToken),
      has_refresh_token: Boolean(creds.refreshToken),
      expires_at: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
      expired: creds.expiresAt ? creds.expiresAt <= Date.now() : null,
    };
  }

  private publicFields(creds: Credentials, backend: "keychain" | "file", account: string): StoredFile {
    const common: StoredFile = { backend, kind: creds.kind, account, base_url: creds.baseUrl };
    if (creds.kind === "apiKey") return { ...common, access_key: creds.accessKey };
    return {
      ...common,
      oauth_url: creds.oauthUrl,
      client_id: creds.clientId,
      expires_at: creds.expiresAt,
    };
  }

  private secretFields(creds: Credentials): StoredFile {
    if (creds.kind === "apiKey") return { secret_key: creds.secretKey };
    return {
      client_secret: creds.clientSecret,
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
    };
  }

  private credentialsFromFile(path: string, keychainService: string): Credentials | null {
    const data = readJson(path) as StoredFile;
    if (!data.backend && !data.access_key && !data.access_token) return null;
    const baseUrl = data.base_url ?? DEFAULT_BASE_URL;

    if (data.backend === "keychain") {
      const account = data.account ?? accountForBaseUrl(baseUrl);
      const raw = keychainGet(account, keychainService);
      if (!raw) return null;
      return this.parseKeychainPayload(raw, data, baseUrl);
    }

    if (data.kind === "oauth" || data.access_token) {
      if (!data.access_token || !data.client_id) return null;
      return {
        kind: "oauth",
        clientId: data.client_id,
        clientSecret: data.client_secret ?? "",
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at,
        baseUrl,
        oauthUrl: data.oauth_url ?? DEFAULT_OAUTH_URL,
      };
    }

    if (data.access_key && data.secret_key) {
      return { kind: "apiKey", accessKey: data.access_key, secretKey: data.secret_key, baseUrl };
    }
    return null;
  }

  /** Keychain payloads come from this server (a full Credentials object) or from
   *  onshape-cli (snake_case api keys). Accept both. */
  private parseKeychainPayload(raw: string, file: StoredFile, baseUrl: string): Credentials | null {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (parsed.kind === "apiKey" || parsed.kind === "oauth") return parsed as unknown as Credentials;

    const accessKey = typeof parsed.access_key === "string" ? parsed.access_key : file.access_key;
    const secretKey = typeof parsed.secret_key === "string" ? parsed.secret_key : undefined;
    if (!accessKey || !secretKey) return null;
    const storedBase = typeof parsed.base_url === "string" ? parsed.base_url : baseUrl;
    return { kind: "apiKey", accessKey, secretKey, baseUrl: storedBase };
  }
}
