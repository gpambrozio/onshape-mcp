import assert from "node:assert/strict";
import { test } from "node:test";

import { buildExtrude, buildFillet, buildBoolean, buildOffsetPlane } from "../src/builders/features.js";
import { buildRectangleSketch, buildSketchFromEntities } from "../src/builders/sketch.js";
import { buildAssemblyMate } from "../src/builders/assembly.js";
import { buildAssignVariable, inferVariableType } from "../src/builders/variables.js";
import { parsePoint2, planeId, resolveEntityQuery } from "../src/builders/params.js";

function parametersOf(feature: Record<string, any>): Array<Record<string, any>> {
  return feature.feature.parameters as Array<Record<string, any>>;
}

function parameter(feature: Record<string, any>, parameterId: string): Record<string, any> {
  const found = parametersOf(feature).find((param) => param.parameterId === parameterId);
  assert.ok(found, `missing parameter ${parameterId}`);
  return found;
}

test("plane names map to Onshape's deterministic ids", () => {
  assert.equal(planeId("Front"), "JCC");
  assert.equal(planeId("top"), "JDC");
  assert.equal(planeId("RIGHT"), "JEC");
  assert.throws(() => planeId("Back"), /Unknown plane/);
});

test("points accept both wire formats", () => {
  assert.deepEqual(parsePoint2("1.5, -2"), [1.5, -2]);
  assert.deepEqual(parsePoint2([0, 3]), [0, 3]);
  assert.throws(() => parsePoint2("1,2,3"), /2D point/);
});

test("a rectangle sketch is four lines in metres", () => {
  const sketch = buildRectangleSketch({ name: "S", plane: "Top", corner1: [0, 0], corner2: [2, 1] }) as any;
  assert.equal(sketch.feature.btType, "BTMSketch-151");
  assert.equal(sketch.feature.parameters[0].queries[0].deterministicIds[0], "JDC");
  assert.equal(sketch.feature.entities.length, 4);

  const first = sketch.feature.entities[0];
  assert.equal(first.btType, "BTMSketchCurveSegment-155");
  // 2 inches along +X, converted to metres.
  assert.ok(Math.abs(first.endParam - 0.0508) < 1e-9, `endParam was ${first.endParam}`);
  assert.equal(first.geometry.dirX, 1);
});

test("degenerate sketch input is rejected before it reaches Onshape", () => {
  assert.throws(() => buildRectangleSketch({ name: "S", plane: "Front", corner1: [0, 0], corner2: [0, 1] }), /differ/);
  assert.throws(
    () => buildSketchFromEntities({ name: "S", plane: "Front", entities: [{ type: "line", start: [0, 0], end: [0, 0] }] }),
    /must be different/,
  );
  assert.throws(
    () => buildSketchFromEntities({ name: "S", plane: "Front", entities: [{ type: "blob" } as never] }),
    /Unknown sketch entity type/,
  );
});

test("extrude carries the sketch region, operation and depth expression", () => {
  const extrude = buildExtrude({ name: "E", sketchFeatureId: "FID", depth: 0.25, operationType: "REMOVE" }) as any;
  assert.equal(extrude.btType, "BTFeatureDefinitionCall-1406");
  assert.equal(extrude.feature.featureType, "extrude");
  assert.equal(parameter(extrude, "entities").queries[0].featureId, "FID");
  assert.equal(parameter(extrude, "operationType").value, "REMOVE");
  assert.equal(parameter(extrude, "depth").expression, "0.25 in");
});

test("a variable reference replaces the literal dimension", () => {
  const extrude = buildExtrude({
    name: "E",
    sketchFeatureId: "FID",
    depth: 0,
    operationType: "NEW",
    depthVariable: "wall",
  }) as any;
  assert.equal(parameter(extrude, "depth").expression, "#wall");
});

test("fillet selection prefers explicit ids, then queries, then a feature", () => {
  const byId = buildFillet({ edgeIds: ["EDGE1"], radius: 0.1 }) as any;
  assert.deepEqual(parameter(byId, "entities").queries[0].deterministicIds, ["EDGE1"]);

  const byFeature = buildFillet({ featureId: "FID" }) as any;
  assert.match(parameter(byFeature, "entities").queries[0].queryString, /qCreatedBy\(makeId\("FID"\), EntityType.EDGE\)/);

  const circular = buildFillet({ circular: true }) as any;
  assert.match(parameter(circular, "entities").queries[0].queryString, /GeometryType.CIRCLE/);

  assert.throws(() => resolveEntityQuery("entities", {}), /No selection/);
});

test("subtraction adds the target query, union does not", () => {
  const subtraction = buildBoolean({ operationType: "SUBTRACTION", targetsQuery: "query = qAll();" }) as any;
  assert.equal(parameter(subtraction, "operationType").value, "SUBTRACTION");
  assert.equal(parameter(subtraction, "targets").queries[0].queryString, "query = qAll();");

  const union = buildBoolean({ operationType: "UNION" }) as any;
  assert.equal(parametersOf(union).some((param) => param.parameterId === "targets"), false);
});

test("an offset plane defaults to the Front plane", () => {
  const plane = buildOffsetPlane({ offset: 2 }) as any;
  assert.equal(plane.feature.featureType, "cPlane");
  assert.deepEqual(parameter(plane, "entities").queries[0].deterministicIds, ["JCC"]);
  assert.equal(parameter(plane, "offset").expression, "2 in");
});

test("a mate needs two connectors", () => {
  assert.throws(() => buildAssemblyMate({ mateConnectorIds: ["one"] }), /at least two/);
  const mate = buildAssemblyMate({ mateType: "REVOLUTE", mateConnectorIds: ["a", "b"] }) as any;
  assert.equal(mate.feature.btType, "BTMMate-64");
  assert.equal(mate.feature.parameters[0].value, "REVOLUTE");
  assert.equal(mate.feature.parameters[1].queries.length, 2);
});

test("no parameter carries libraryRelationType", () => {
  // Onshape rejects the whole feature with BTWeirdStringValueException when a
  // parameter carries libraryRelationType: "NONE"; its own features use
  // "DEFAULT". Omitting it is accepted, so nothing here may emit it.
  const payloads = [
    buildExtrude({ name: "E", sketchFeatureId: "F", depth: 1, operationType: "NEW" }),
    buildFillet({ selectAll: true }),
    buildBoolean({ operationType: "UNION" }),
    buildOffsetPlane({}),
    buildRectangleSketch({ name: "S", plane: "Front", corner1: [0, 0], corner2: [1, 1] }),
    buildAssignVariable({ name: "wall", expression: "0.125 in" }),
  ];
  assert.equal(JSON.stringify(payloads).includes("libraryRelationType"), false);
});

test("variable types are inferred from the expression's units", () => {
  assert.equal(inferVariableType("0.125 in"), "LENGTH");
  assert.equal(inferVariableType("30 deg"), "ANGLE");
  assert.equal(inferVariableType("6"), "NUMBER");
  assert.equal(inferVariableType("#a + #b"), "ANY");
});

test("assignVariable writes the expression into the parameter for its type", () => {
  const length = buildAssignVariable({ name: "wall", expression: "0.125 in", description: "wall thickness" }) as any;
  assert.equal(length.feature.featureType, "assignVariable");
  assert.equal(parameter(length, "mode").value, "ASSIGNED");
  assert.equal(parameter(length, "variableType").value, "LENGTH");
  assert.equal(parameter(length, "name").value, "wall");
  assert.equal(parameter(length, "lengthValue").expression, "0.125 in");
  assert.equal(parameter(length, "description").value, "wall thickness");

  const count = buildAssignVariable({ name: "turns", expression: "6" }) as any;
  assert.equal(parameter(count, "variableType").value, "NUMBER");
  assert.equal(parameter(count, "numberValue").expression, "6");
});
