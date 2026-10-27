import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { HttpError, type OnshapeClient } from "../src/api/client.js";
import { ExportManager } from "../src/api/export.js";
import { PartStudioManager } from "../src/api/partstudio.js";
import { VariableManager } from "../src/api/variables.js";
import { buildAssignVariable } from "../src/builders/variables.js";

interface Call {
  method: "GET" | "POST";
  path: string;
  body?: any;
  params?: Record<string, unknown>;
}

/** Stands in for OnshapeClient: records every request and answers from
 *  `respond`, so the API layer is tested without a network. */
function fakeClient(respond: (call: Call) => unknown): { client: OnshapeClient; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (call: Call) => {
    calls.push(call);
    const result = respond(call);
    if (result instanceof Error) throw result;
    return result;
  };
  const client = {
    get: async (path: string, params?: Record<string, unknown>) => answer({ method: "GET", path, params }),
    post: async (path: string, body?: unknown) => answer({ method: "POST", path, body }),
    getBinary: async (path: string, params?: Record<string, unknown>) => {
      answer({ method: "GET", path, params });
      return { buffer: Buffer.from("solid"), contentType: "application/octet-stream", status: 200 };
    },
  };
  return { client: client as unknown as OnshapeClient, calls };
}

/** A Part Studio whose variable table 404s, holding these Variable features. */
function featureRouteStudio(features: unknown[]) {
  return fakeClient((call) => {
    if (call.path.endsWith("/variables")) return new HttpError(404, "not found");
    if (call.method === "GET" && call.path.endsWith("/features")) return { features };
    if (call.method === "POST" && call.path.endsWith("/features")) return { feature: { featureId: "FNEW" } };
    return { feature: { featureId: call.path.split("/").pop() } };
  });
}

function variableFeature(featureId: string, name: string, expression: string, description?: string) {
  const { feature } = buildAssignVariable({ name, expression, description }) as any;
  return { ...feature, featureId };
}

function fsMap(entries: Record<string, unknown>): unknown {
  const wrap = (value: unknown): unknown =>
    Array.isArray(value)
      ? { btType: "BTFSValueArray", value: value.map(wrap) }
      : { btType: typeof value === "string" ? "BTFSValueString" : "BTFSValueNumber", value };
  return {
    btType: "BTFSValueMap",
    value: Object.entries(entries).map(([key, value]) => ({ key: wrap(key), value: wrap(value) })),
  };
}

test("set_variable appends a Variable feature for a new name", async () => {
  const { client, calls } = featureRouteStudio([variableFeature("FOTHER", "other", "1 in")]);
  const write = await new VariableManager(client).setVariable("D", "W", "E", "wall", "0.125 in");

  assert.equal(write.route, "assign-variable-feature");
  assert.equal(write.action, "created");
  assert.equal(write.featureId, "FNEW");
  const post = calls.find((call) => call.method === "POST" && call.path.endsWith("/features"));
  assert.ok(post, "expected a new feature to be posted");
  assert.equal(post.body.feature.featureType, "assignVariable");
});

test("set_variable rewrites an existing Variable feature in place", async () => {
  // Appending a second #wall at the end of the tree would leave every feature
  // built after the first one on the old value.
  const { client, calls } = featureRouteStudio([
    variableFeature("FWALL", "wall", "0.1 in", "wall thickness"),
    { featureType: "extrude", featureId: "FEXT", parameters: [] },
  ]);
  const write = await new VariableManager(client).setVariable("D", "W", "E", "wall", "0.2 in");

  assert.equal(write.action, "updated");
  assert.equal(write.featureId, "FWALL");
  assert.equal(write.featureIds, undefined);
  const posts = calls.filter((call) => call.method === "POST" && !call.path.endsWith("/variables"));
  assert.deepEqual(
    posts.map((call) => call.path),
    ["/api/v9/partstudios/d/D/w/W/e/E/features/featureid/FWALL"],
  );
  const feature = posts[0].body.feature;
  assert.equal(feature.featureId, "FWALL");
  const parameter = (id: string) => feature.parameters.find((param: any) => param.parameterId === id);
  assert.equal(parameter("lengthValue").expression, "0.2 in");
  assert.equal(parameter("description").value, "wall thickness", "the existing description is kept");
});

test("set_variable rewrites every assignment of a name", async () => {
  const { client, calls } = featureRouteStudio([
    variableFeature("F1", "wall", "0.1 in"),
    variableFeature("F2", "wall", "0.15 in"),
  ]);
  const write = await new VariableManager(client).setVariable("D", "W", "E", "wall", "0.2 in", "new text");

  assert.deepEqual(write.featureIds, ["F1", "F2"]);
  const updated = calls.filter((call) => call.path.includes("/featureid/"));
  assert.equal(updated.length, 2);
  for (const call of updated) {
    const description = call.body.feature.parameters.find((param: any) => param.parameterId === "description");
    assert.equal(description.value, "new text");
  }
});

test("set_variable still uses the variable table where it exists", async () => {
  const { client, calls } = fakeClient(() => ({ ok: true }));
  const write = await new VariableManager(client).setVariable("D", "W", "E", "wall", "0.2 in");
  assert.equal(write.route, "variable-table");
  assert.equal(calls.length, 1);
});

test("clearance passes part ids as queries and reports the gap", async () => {
  const { client, calls } = fakeClient(() => ({
    result: fsMap({ distance: 0.05, a: [1, 0, 0.25], b: [1, 0, 0.3] }),
  }));
  const result = await new PartStudioManager(client).clearance("D", "W", "E", { partId: "JHD" }, { featureId: "FServo" });

  assert.equal(result.distance_in, 0.05);
  assert.equal(result.distance_mm, 1.27);
  assert.equal(result.clear, true);
  assert.deepEqual(result.closest_points_in, { a: [1, 0, 0.25], b: [1, 0, 0.3] });

  const body = calls[0].body;
  assert.equal(calls[0].path, "/api/v6/partstudios/d/D/w/W/e/E/featurescript");
  assert.deepEqual(body.queries, [{ key: "a", value: ["JHD"] }]);
  assert.match(body.script, /var a = qBodyType\(queries\.a, BodyType\.SOLID\)/);
  assert.match(body.script, /qCreatedBy\(makeId\("FServo"\), EntityType\.BODY\)/);
  assert.match(body.script, /evDistance\(context, \{ side0: a, side1: b \}\)/);
});

test("clearance of zero means touching or overlapping", async () => {
  const { client } = fakeClient(() => ({ result: fsMap({ distance: 0, a: [0, 0, 0], b: [0, 0, 0] }) }));
  const result = await new PartStudioManager(client).clearance("D", "W", "E", { featureId: "F1" }, { featureId: "F2" });
  assert.equal(result.clear, false);
  assert.equal(result.distance_mm, 0);
});

test("clearance fails loudly on a side with no body or an ambiguous reference", async () => {
  const { client } = fakeClient(() => ({ result: fsMap({ missing: "b" }) }));
  const studio = new PartStudioManager(client);
  await assert.rejects(
    studio.clearance("D", "W", "E", { partId: "JHD" }, { featureId: "FCut" }),
    /Body b \(feature FCut\) matched no solid body/,
  );
  await assert.rejects(studio.clearance("D", "W", "E", {}, { partId: "JHD" }), /exactly one/);
  await assert.rejects(
    studio.clearance("D", "W", "E", { partId: "JHD", featureId: "F" }, { partId: "JHE" }),
    /exactly one/,
  );
});

test("STL exports default to millimetres", async () => {
  const { client, calls } = fakeClient(() => undefined);
  const out = join(mkdtempSync(join(tmpdir(), "onshape-mcp-")), "part.stl");
  const exports = new ExportManager(client);

  await exports.exportStl("D", "W", "E", out);
  assert.equal(calls[0].params?.units, "millimeter");

  await exports.exportStl("D", "W", "E", out, { units: "inch" });
  assert.equal(calls[1].params?.units, "inch");
});
