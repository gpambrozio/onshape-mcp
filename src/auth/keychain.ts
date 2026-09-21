/** Thin wrapper over the optional @napi-rs/keyring dependency.
 *
 * The dependency is optional so a headless install (no macOS keychain, no
 * libsecret) still works: every helper reports failure instead of throwing, and
 * the credential store falls back to a 0600 file. */

import { createRequire } from "node:module";

const SERVICE = "onshape-mcp";
const require = createRequire(import.meta.url);

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(value: string): void;
  deleteCredential(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

function entry(account: string, service = SERVICE): KeyringEntry {
  // Required lazily: the module is an optional dependency and may be absent.
  const keyring = require("@napi-rs/keyring") as KeyringModule;
  return new keyring.Entry(service, account);
}

export function keychainAvailable(): boolean {
  try {
    require.resolve("@napi-rs/keyring");
    return true;
  } catch {
    return false;
  }
}

export function keychainGet(account: string, service = SERVICE): string | null {
  try {
    return entry(account, service).getPassword();
  } catch {
    return null;
  }
}

export function keychainSet(account: string, value: string): { ok: true } | { ok: false; error: string } {
  try {
    entry(account).setPassword(value);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function keychainDelete(account: string, service = SERVICE): boolean {
  try {
    return entry(account, service).deleteCredential();
  } catch {
    return false;
  }
}
