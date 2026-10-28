import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { HttpError, type OnshapeClient } from "../src/api/client.js";
import { EdgeQuery } from "../src/api/edges.js";
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
  // The rewrite also repairs a feature named by the old "#wall = ..." form.
  assert.equal(feature.name, "###name = #value");
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

/** A parameter of a Variable feature as `get_features` returns it. */
function quantity(parameterId: string, expression: string) {
  return { btType: "BTMParameterQuantity-147", parameterId, value: 0, expression };
}

function enumParameter(parameterId: string, value: string) {
  return { btType: "BTMParameterEnum-145", parameterId, value };
}

function stringParameter(parameterId: string, value: string) {
  return { btType: "BTMParameterString-149", parameterId, value };
}

/** A Variable feature confirmed in the Onshape dialog, trimmed from the talk
 *  document's `#wall`: every typed slot is present, the unused ones at their
 *  defaults, interleaved with the measure and lookup-table fields. */
function dialogVariableFeature(featureId: string, variableType: string, slots: Record<string, string>) {
  return {
    btType: "BTMFeature-134",
    featureType: "assignVariable",
    featureId,
    name: "###name = #value",
    parameters: [
      enumParameter("mode", "ASSIGNED"),
      enumParameter("variableType", variableType),
      enumParameter("measurementMode", "DISTANCE"),
      stringParameter("name", "wall"),
      quantity("lengthValue", slots.lengthValue ?? "0.0*mm"),
      quantity("customOffset", "0.0*mm"),
      quantity("distance", "0.0*mm"),
      quantity("conversionFactor", "0"),
      quantity("rowIndex", "0"),
      quantity("value", slots.value ?? "0"),
      quantity("anyValue", slots.anyValue ?? "0"),
      quantity("numberValue", slots.numberValue ?? "0.0"),
      quantity("angleValue", slots.angleValue ?? "0.0*deg"),
      stringParameter("description", "Wall thickness of the upright and the base"),
    ],
  };
}

async function readVariables(features: unknown[]) {
  const { client } = featureRouteStudio(features);
  const listing = await new VariableManager(client).getVariables("D", "W", "E");
  assert.equal(listing.source, "assign-variable-feature");
  return listing.variables;
}

test("get_variables reads a dialog-written Variable from the slot its type names", async () => {
  // The talk document's #wall read as "0.0*deg": angleValue, an unused slot,
  // comes after lengthValue and its default slipped past the zero check.
  const [wall] = await readVariables([
    dialogVariableFeature("FLlNNn5eSgDIuUK_0", "LENGTH", { lengthValue: "2.5 mm", value: "2.5 mm" }),
  ]);
  assert.equal(wall.name, "wall");
  assert.equal(wall.expression, "2.5 mm");
  assert.equal(wall.description, "Wall thickness of the upright and the base");
  assert.equal(wall.featureId, "FLlNNn5eSgDIuUK_0");
});

test("get_variables trusts the typed slot over a stale value parameter", async () => {
  // Before the talk document was repaired, #wall's value parameter said 0
  // while Onshape evaluated lengthValue, 2.5 mm.
  const [wall] = await readVariables([
    dialogVariableFeature("FWALL", "LENGTH", { lengthValue: "2.5 mm", value: "0" }),
  ]);
  assert.equal(wall.expression, "2.5 mm");
});

test("get_variables reads each variable type from its own slot", async () => {
  const cases: { variableType: string; slots: Record<string, string>; expected: string }[] = [
    { variableType: "LENGTH", slots: { lengthValue: "0.125 in" }, expected: "0.125 in" },
    { variableType: "ANGLE", slots: { angleValue: "30 deg" }, expected: "30 deg" },
    { variableType: "NUMBER", slots: { numberValue: "36" }, expected: "36" },
    { variableType: "ANY", slots: { anyValue: "true" }, expected: "true" },
    // A variable really set to zero reads as zero, not as another slot.
    { variableType: "ANGLE", slots: { angleValue: "0 deg", lengthValue: "1 mm" }, expected: "0 deg" },
  ];
  for (const { variableType, slots, expected } of cases) {
    const [variable] = await readVariables([dialogVariableFeature("F", variableType, slots)]);
    assert.equal(variable.expression, expected, `${variableType} ${JSON.stringify(slots)}`);
  }
});

test("get_variables reads the minimal Variable features the API writes", async () => {
  const variables = await readVariables([
    variableFeature("F1", "bracket_width", "50 mm", "Bracket width along X"),
    variableFeature("F2", "pivot", "15 deg"),
    variableFeature("F3", "gear_teeth", "36"),
    variableFeature("F4", "label", '"left"'),
    { featureType: "extrude", featureId: "FEXT", parameters: [] },
  ]);
  assert.deepEqual(
    variables.map(({ name, expression, description }) => ({ name, expression, description })),
    [
      { name: "bracket_width", expression: "50 mm", description: "Bracket width along X" },
      { name: "pivot", expression: "15 deg", description: null },
      { name: "gear_teeth", expression: "36", description: null },
      { name: "label", expression: '"left"', description: null },
    ],
  );
});

test("get_variables falls back to value, then a set slot, when the type is missing", async () => {
  const [byValue] = await readVariables([
    { featureType: "assignVariable", featureId: "F1", parameters: [stringParameter("name", "a"), quantity("value", "3 mm")] },
  ]);
  assert.equal(byValue.expression, "3 mm");
  const [bySlot] = await readVariables([
    {
      featureType: "assignVariable",
      featureId: "F2",
      parameters: [stringParameter("name", "b"), quantity("lengthValue", "0 mm"), quantity("numberValue", "4")],
    },
  ]);
  assert.equal(bySlot.expression, "4");
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
  // A map from key to ids: Onshape answers 400 to a list of {key, value} pairs.
  assert.deepEqual(body.queries, { a: ["JHD"] });
  assert.match(body.script, /var sideA = qBodyType\(queries\.a, BodyType\.SOLID\)/);
  assert.match(body.script, /qCreatedBy\(makeId\("FServo"\), EntityType\.BODY\)/);
  assert.match(body.script, /evDistance\(context, \{ "side0": sideA, "side1": sideB \}\)/);
  // Onshape rejected bare keys that shadow a variable ("Cannot use a as map key").
  assert.doesNotMatch(body.script, /[{,]\s*(a|b|distance|missing):/);
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

/** One edge as /bodydetails returns it (trimmed from a live response): the
 *  curve's type, radius and centre are under `curve`, in metres. */
function bodyDetailsEdge(id: string, curve: Record<string, unknown>) {
  const vector = (x: number, y: number, z: number) => ({ btType: "BTVector3d-389", x, y, z });
  return {
    btType: "BTExportModelEdge-1782",
    id,
    vertices: [],
    geometry: {
      btType: "BTExportModelArcEdgeGeometry-1257",
      startPoint: vector(0.0279, 0, 0.0127),
      endPoint: vector(0.0279, 0, 0.0127),
      arcSweep: 2 * Math.PI,
    },
    curve: { ...curve, origin: vector(...(curve.origin as [number, number, number])) },
  };
}

test("circular edges are found from the curve bodydetails describes", async () => {
  // Regression: the radius was read from `geometry`, which never carries it,
  // so find_circular_edges returned [] on a part with a hole and fillets.
  const { client } = fakeClient(() => ({
    bodies: [
      {
        id: "JHD",
        edges: [
          bodyDetailsEdge("JMB", { btType: "BTCircleDescription-1145", type: "CIRCLE", radius: 0.00254, origin: [0.0254, 0, 0.0127] }),
          bodyDetailsEdge("JFL", { btType: "BTCircleDescription-1145", type: "CIRCLE", radius: 0.00508, origin: [0, 0, 0] }),
          bodyDetailsEdge("JPB", { btType: "BTLineDescription-1559", type: "LINE", origin: [0.04826, -0.0127, 0] }),
        ],
      },
    ],
  }));
  const edges = new EdgeQuery(client);

  const listing = await edges.getEdges("D", "W", "E");
  assert.deepEqual(
    (listing.edges as Array<Record<string, unknown>>).map((edge) => edge.type),
    ["circle", "circle", "line"],
  );

  const all = await edges.findCircularEdges("D", "W", "E");
  assert.deepEqual(
    all.map((edge: any) => edge.id),
    ["JMB", "JFL"],
  );
  const holes = await edges.findCircularEdges("D", "W", "E", 0.1);
  assert.deepEqual(holes, [{ id: "JMB", body: "JHD", type: "circle", radius: 0.1, center: [1, 0, 0.5] }]);
});
