#!/usr/bin/env node
/** Live end-to-end check against a real Onshape account.
 *
 *   node scripts/smoke.mjs            # read-only: auth, documents, elements
 *   node scripts/smoke.mjs --write    # also builds a throwaway part and deletes it
 *
 * Uses whatever credential the server resolves, so it also exercises the
 * keychain / config lookup. Requires `npm run build` first. */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/server.js";

const WRITE = process.argv.includes("--write");

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "smoke", version: "0" });
await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);

let failures = 0;

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((part) => part.type === "text")?.text ?? "";
  const payload = text ? JSON.parse(text) : {};
  const images = result.content.filter((part) => part.type === "image").length;
  if (result.isError) {
    failures += 1;
    console.log(`✖ ${name}: ${payload.error ?? text}`);
    if (payload.detail) console.log(`   detail: ${JSON.stringify(payload.detail).slice(0, 300)}`);
  } else {
    const preview = JSON.stringify(payload.result).slice(0, 160);
    console.log(`✔ ${name}${images ? ` (+${images} image)` : ""}: ${preview}`);
  }
  return payload.result;
}

const status = await call("onshape_auth_status");
if (!status?.configured) {
  console.log("\nNo credentials resolved — run onshape_login first.");
  process.exit(1);
}

const documents = await call("onshape_list_documents", { limit: 3 });
if (documents?.[0]) {
  const doc = documents[0].id;
  const workspaces = await call("onshape_get_workspaces", { doc });
  if (workspaces?.[0]) await call("onshape_get_elements", { doc, ws: workspaces[0].id });
}

if (WRITE) {
  console.log("\n-- write path --");
  // Free Onshape accounts can only create public documents; try private first.
  const name = `onshape-mcp smoke ${new Date().toISOString()}`;
  const description = "Temporary document created by scripts/smoke.mjs; safe to delete.";
  const created =
    (await call("onshape_create_document", { name, description })) ??
    (await call("onshape_create_document", { name, description, public: true }));
  const doc = created?.id;
  const ws = created?.defaultWorkspace?.id;
  if (doc && ws) {
    try {
      const studio = await call("onshape_create_part_studio", { doc, ws, name: "Part" });
      const elem = studio?.response?.id ?? studio?.id;
      const sketch = await call("onshape_sketch_rectangle", { doc, ws, elem, corner1: [0, 0], corner2: [2, 1] });
      const extrude = await call("onshape_extrude", { doc, ws, elem, sketch: sketch?.featureId, depth: 0.5 });
      await call("onshape_fillet", { doc, ws, elem, feature: extrude?.featureId, radius: 0.1 });
      await call("onshape_measure", { doc, ws, elem });
      await call("onshape_get_edges", { doc, ws, elem });
      await call("onshape_set_variable", { doc, ws, elem, name: "wall", expression: "0.125 in" });
      await call("onshape_get_variables", { doc, ws, elem });
      await call("onshape_shaded_view", { doc, ws, elem, out: "/tmp/onshape-mcp-smoke.png", return_image: false });
      await call("onshape_export_stl", { doc, ws, elem, out: "/tmp/onshape-mcp-smoke.stl" });
    } finally {
      await call("onshape_delete_document", { doc });
    }
  }
}

await client.close();
console.log(failures ? `\n${failures} call(s) failed.` : "\nAll smoke calls succeeded.");
process.exit(failures ? 1 : 0);
