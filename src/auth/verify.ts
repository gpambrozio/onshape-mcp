/** Proves a credential works before it is stored, so a typo is caught in the
 *  browser rather than on the first CAD call. */

import { HttpError, OnshapeClient } from "../api/client.js";
import { isRecord } from "../api/util.js";
import { createAuthProvider } from "./provider.js";
import type { CredentialStore } from "./store.js";
import type { Credentials } from "./types.js";

export interface VerifiedIdentity {
  message: string;
  user?: { name?: unknown; email?: unknown; id?: unknown };
}

export async function verifyCredentials(creds: Credentials, store: CredentialStore): Promise<VerifiedIdentity> {
  const client = new OnshapeClient(createAuthProvider(creds, store));

  try {
    const info = await client.get("/api/v6/users/sessioninfo");
    if (isRecord(info) && (info.name || info.email)) {
      return {
        message: `Signed in to ${hostOf(creds.baseUrl)} as ${String(info.name ?? info.email)}.`,
        user: { name: info.name, email: info.email, id: info.id },
      };
    }
  } catch (error) {
    // An OAuth app without the profile scope gets 403 here; that is fine, the
    // API calls we actually make may still work. Anything else is fatal.
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
  }

  await client.get("/api/v6/documents", { limit: 1 });
  return { message: `Credentials verified against ${hostOf(creds.baseUrl)}.` };
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}
