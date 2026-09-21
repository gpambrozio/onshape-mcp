import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { activeFlow } from "../src/auth/login.js";
import { createServer } from "../src/server.js";

// No test may launch a browser, reach the network, or wait on a human.
process.env.ONSHAPE_MCP_NO_BROWSER = "1";
process.env.ONSHAPE_MCP_SIGNIN_WAIT_MS = "500";

async function connect(options: { elicitation?: boolean } = {}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test", version: "0" },
    options.elicitation ? { capabilities: { elicitation: { url: {} } } } : undefined,
  );
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Supply a credential from the environment so the auth gate passes without
 *  touching the developer's keychain. The key is never used: these tests make
 *  no network calls. */
function withCredentials<T>(run: () => Promise<T>): Promise<T> {
  const saved = { key: process.env.ONSHAPE_ACCESS_KEY, secret: process.env.ONSHAPE_SECRET_KEY };
  process.env.ONSHAPE_ACCESS_KEY = "test-access-key";
  process.env.ONSHAPE_SECRET_KEY = "test-secret-key";
  return run().finally(() => {
    restore("ONSHAPE_ACCESS_KEY", saved.key);
    restore("ONSHAPE_SECRET_KEY", saved.secret);
  });
}

/** Point the credential lookup at paths that cannot exist, so a test never
 *  picks up the developer's own Onshape credentials. */
function withoutCredentials<T>(run: () => Promise<T>): Promise<T> {
  const saved = {
    config: process.env.ONSHAPE_MCP_CONFIG,
    legacy: process.env.ONSHAPE_CONFIG,
    key: process.env.ONSHAPE_ACCESS_KEY,
    secret: process.env.ONSHAPE_SECRET_KEY,
  };
  process.env.ONSHAPE_MCP_CONFIG = "/nonexistent/onshape-mcp/credentials.json";
  process.env.ONSHAPE_CONFIG = "/nonexistent/onshape/credentials.json";
  delete process.env.ONSHAPE_ACCESS_KEY;
  delete process.env.ONSHAPE_SECRET_KEY;
  return run().finally(() => {
    // A sign-in started by the gate keeps a loopback server listening.
    activeFlow()?.cancel();
    restore("ONSHAPE_MCP_CONFIG", saved.config);
    restore("ONSHAPE_CONFIG", saved.legacy);
    restore("ONSHAPE_ACCESS_KEY", saved.key);
    restore("ONSHAPE_SECRET_KEY", saved.secret);
  });
}

test("every tool is registered with a unique name and a description", async () => {
  const client = await connect();
  const { tools } = await client.listTools();

  assert.ok(tools.length > 80, `expected the full command surface, got ${tools.length}`);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^onshape_[a-z0-9_]+$/, `bad tool name ${tool.name}`);
    assert.ok((tool.description ?? "").length > 20, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, "object");
  }
  await client.close();
});

test("the login tools are present and self-describing", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const expected of ["onshape_login", "onshape_login_status", "onshape_set_api_key", "onshape_auth_status", "onshape_logout"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  await client.close();
});

test("a tool call without credentials offers a sign-in URL", async () => {
  await withoutCredentials(async () => {
    const client = await connect();
    const result: any = await client.callTool({ name: "onshape_list_documents", arguments: {} });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(result.isError, true);
    // The client here cannot show a URL elicitation, so the URL comes back in
    // the result for the assistant to relay.
    assert.match(payload.sign_in_url, /^http:\/\/127\.0\.0\.1:\d+\/\?nonce=/);
    assert.match(payload.error, /sign-in/i);
    await client.close();
  });
});

test("auto sign-in can be switched off for unattended installs", async () => {
  await withoutCredentials(async () => {
    process.env.ONSHAPE_MCP_AUTO_LOGIN = "0";
    try {
      const client = await connect();
      const result: any = await client.callTool({ name: "onshape_list_documents", arguments: {} });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      assert.equal(payload.sign_in_url, null);
      assert.match(payload.error, /onshape_login/);
      await client.close();
    } finally {
      delete process.env.ONSHAPE_MCP_AUTO_LOGIN;
    }
  });
});

test("a client with URL elicitation is asked to show the sign-in link", async () => {
  await withoutCredentials(async () => {
    const client = await connect({ elicitation: true });
    const shown: Array<{ url: string; message: string }> = [];

    // Stand in for a user who dismisses the prompt: the sign-in must end
    // promptly and say so, rather than hanging the tool call.
    client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
      shown.push({ url: request.params.url, message: request.params.message });
      return { action: "decline" };
    });

    const result: any = await client.callTool({ name: "onshape_list_documents", arguments: {} });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(shown.length, 1, "the client should have been asked to show a URL");
    assert.match(shown[0].url, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.match(shown[0].message, /Onshape/);
    assert.equal(result.isError, true);
    assert.match(payload.error, /declined/);
    await client.close();
  });
});

test("login_status without a login in progress is a clean failure", async () => {
  const client = await connect();
  const result: any = await client.callTool({ name: "onshape_login_status", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No login is in progress/);
  await client.close();
});

test("the generic request tool refuses paths outside /api/", async () => {
  await withCredentials(async () => {
    const client = await connect();
    const result: any = await client.callTool({
      name: "onshape_request",
      arguments: { method: "GET", path: "https://evil.test/steal" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /must begin with \/api\//);
    await client.close();
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("every tool module is actually registered", async () => {
  // Guards the obvious slip: a new tools/*.ts file imported into tools/index.ts
  // but never spread into allTools, which loses the whole module silently.
  const { readdirSync } = await import("node:fs");
  const { allTools } = await import("../src/tools/index.js");
  const registered = new Set(allTools.map((tool) => tool.name));
  const directory = new URL("../src/tools/", import.meta.url);

  for (const file of readdirSync(directory).filter((name) => name.endsWith(".js") && name !== "index.js")) {
    const module: Record<string, unknown> = await import(new URL(file, directory).href);
    for (const [exportName, value] of Object.entries(module)) {
      if (!Array.isArray(value) || !value.length) continue;
      if (!value.every((item) => item && typeof item === "object" && "name" in item && "handler" in item)) continue;
      for (const tool of value as Array<{ name: string }>) {
        assert.ok(registered.has(tool.name), `${file} exports ${exportName} with unregistered tool ${tool.name}`);
      }
    }
  }
});

test("the advertised version matches the package", async () => {
  // A mismatch ships a server that misreports itself, and the release workflow
  // checks the tag against package.json, not against this constant.
  const { readFileSync } = await import("node:fs");
  const { VERSION } = await import("../src/server.js");
  // Tests run compiled, from .build-test/test/, so the repo root is two up.
  const root = new URL("../../", import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(VERSION, pkg.version);
  assert.equal(pkg.mcpName, "io.github.gpambrozio/onshape");

  const server = JSON.parse(readFileSync(new URL("server.json", root), "utf8"));
  assert.equal(server.name, pkg.mcpName, "server.json name must match package.json mcpName");
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
});
