import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/server.js";

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
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

test("a tool call without credentials explains how to sign in", async () => {
  const previous = {
    config: process.env.ONSHAPE_MCP_CONFIG,
    legacy: process.env.ONSHAPE_CONFIG,
    key: process.env.ONSHAPE_ACCESS_KEY,
    secret: process.env.ONSHAPE_SECRET_KEY,
  };
  process.env.ONSHAPE_MCP_CONFIG = "/nonexistent/onshape-mcp/credentials.json";
  process.env.ONSHAPE_CONFIG = "/nonexistent/onshape/credentials.json";
  delete process.env.ONSHAPE_ACCESS_KEY;
  delete process.env.ONSHAPE_SECRET_KEY;

  try {
    const client = await connect();
    const result: any = await client.callTool({ name: "onshape_list_documents", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /onshape_login/);
    await client.close();
  } finally {
    restore("ONSHAPE_MCP_CONFIG", previous.config);
    restore("ONSHAPE_CONFIG", previous.legacy);
    restore("ONSHAPE_ACCESS_KEY", previous.key);
    restore("ONSHAPE_SECRET_KEY", previous.secret);
  }
});

test("login_status without a login in progress is a clean failure", async () => {
  const client = await connect();
  const result: any = await client.callTool({ name: "onshape_login_status", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No login is in progress/);
  await client.close();
});

test("the generic request tool refuses paths outside /api/", async () => {
  const client = await connect();
  const result: any = await client.callTool({
    name: "onshape_request",
    arguments: { method: "GET", path: "https://evil.test/steal" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /must begin with \/api\//);
  await client.close();
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
