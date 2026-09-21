import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CredentialStore } from "../src/auth/store.js";

function withTempStore<T>(run: (store: CredentialStore, path: string) => T): T {
  const path = join(mkdtempSync(join(tmpdir(), "onshape-mcp-")), "credentials.json");
  const previous = process.env.ONSHAPE_MCP_CONFIG;
  const previousKey = process.env.ONSHAPE_ACCESS_KEY;
  const previousSecret = process.env.ONSHAPE_SECRET_KEY;
  process.env.ONSHAPE_MCP_CONFIG = path;
  delete process.env.ONSHAPE_ACCESS_KEY;
  delete process.env.ONSHAPE_SECRET_KEY;
  try {
    return run(new CredentialStore(), path);
  } finally {
    if (previous === undefined) delete process.env.ONSHAPE_MCP_CONFIG;
    else process.env.ONSHAPE_MCP_CONFIG = previous;
    if (previousKey !== undefined) process.env.ONSHAPE_ACCESS_KEY = previousKey;
    if (previousSecret !== undefined) process.env.ONSHAPE_SECRET_KEY = previousSecret;
  }
}

test("api keys round-trip through the file backend", () => {
  withTempStore((store, path) => {
    const saved = store.save(
      { kind: "apiKey", accessKey: "AK", secretKey: "SK", baseUrl: "https://cad.onshape.com" },
      "file",
    );
    assert.equal(saved.backend, "file");
    assert.equal(saved.path, path);
    // Windows has no POSIX mode bits; chmod there is a no-op by design.
    if (platform() !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

    const loaded = store.resolve();
    assert.deepEqual(loaded, { kind: "apiKey", accessKey: "AK", secretKey: "SK", baseUrl: "https://cad.onshape.com" });
  });
});

test("oauth tokens round-trip and describe themselves without leaking", () => {
  withTempStore((store) => {
    const expiresAt = Date.now() + 3_600_000;
    store.save(
      {
        kind: "oauth",
        clientId: "client",
        clientSecret: "shhh",
        accessToken: "access-token-value",
        refreshToken: "refresh-token-value",
        expiresAt,
        baseUrl: "https://cad.onshape.com",
        oauthUrl: "https://oauth.onshape.com",
      },
      "file",
    );

    const loaded = store.resolve();
    assert.equal(loaded?.kind, "oauth");
    assert.equal(loaded && "refreshToken" in loaded ? loaded.refreshToken : null, "refresh-token-value");

    const described = store.describe();
    assert.equal(described.kind, "oauth");
    assert.equal(described.has_refresh_token, true);
    assert.equal(described.expired, false);
    assert.equal(JSON.stringify(described).includes("access-token-value"), false);
    assert.equal(JSON.stringify(described).includes("shhh"), false);
  });
});

test("environment variables win over a stored credential", () => {
  withTempStore((store) => {
    store.save({ kind: "apiKey", accessKey: "file", secretKey: "file", baseUrl: "https://cad.onshape.com" }, "file");
    process.env.ONSHAPE_ACCESS_KEY = "env";
    process.env.ONSHAPE_SECRET_KEY = "env-secret";
    try {
      const resolved = store.resolve();
      assert.equal(resolved?.kind === "apiKey" ? resolved.accessKey : null, "env");
      assert.equal(store.describe().source, "environment");
    } finally {
      delete process.env.ONSHAPE_ACCESS_KEY;
      delete process.env.ONSHAPE_SECRET_KEY;
    }
  });
});

test("clear removes the stored file", () => {
  withTempStore((store, path) => {
    store.save({ kind: "apiKey", accessKey: "AK", secretKey: "SK", baseUrl: "https://cad.onshape.com" }, "file");
    assert.ok(readFileSync(path, "utf8").includes("AK"));
    const cleared = store.clear();
    assert.equal(cleared.cleared, true);
    assert.equal(store.fromOwnStore(), null);
  });
});
