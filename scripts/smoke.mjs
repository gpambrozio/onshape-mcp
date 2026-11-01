#!/usr/bin/env node
/** Live end-to-end check against a real Onshape account.
 *
 *   node scripts/smoke.mjs                     # read-only: auth, documents, elements
 *   node scripts/smoke.mjs --write             # also builds a throwaway part and deletes it
 *   node scripts/smoke.mjs --assembly <doc>    # builds a rack and pinion assembly in <doc>
 *
 * --assembly adds tabs to an existing document you own and leaves them there,
 * for accounts whose key cannot delete documents. Point it at a scratch one.
 *
 * Uses whatever credential the server resolves, so it also exercises the
 * keychain / config lookup. Requires `npm run build` first. */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/server.js";

const WRITE = process.argv.includes("--write");
const ASSEMBLY_DOC = process.argv.includes("--assembly") ? process.argv[process.argv.indexOf("--assembly") + 1] : null;
if (process.argv.includes("--assembly") && !ASSEMBLY_DOC) {
  console.log("--assembly needs a document id.");
  process.exit(1);
}

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

/** A call that must fail, with an error matching `pattern`. */
async function callFails(name, args, pattern) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((part) => part.type === "text")?.text ?? "";
  const payload = text ? JSON.parse(text) : {};
  if (result.isError && pattern.test(payload.error ?? "")) {
    console.log(`✔ ${name} failed as expected: ${String(payload.error).slice(0, 160)}`);
  } else {
    failures += 1;
    console.log(`✖ ${name} should have failed with ${pattern}: ${text.slice(0, 300)}`);
  }
  return payload;
}

function check(condition, message) {
  if (condition) {
    console.log(`✔ ${message}`);
  } else {
    failures += 1;
    console.log(`✖ ${message}`);
  }
}

/** Base, pinion (radius 10 mm about Z) and rack (sliding along X, its pitch
 *  line tangent to the pinion), each with Part Studio mate connectors. */
const RACK_AND_PINION_FS = `FeatureScript 3095;
import(path : "onshape/std/geometry.fs", version : "3095.0");

annotation { "Feature Type Name" : "Smoke rack and pinion" }
export const smokeRackPinion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
    }
    {
        fCuboid(context, id + "base", { "corner1" : vector(-50, -30, -10) * millimeter, "corner2" : vector(50, 30, 0) * millimeter });
        fCylinder(context, id + "pinion", { "bottomCenter" : vector(0, 0, 0) * millimeter, "topCenter" : vector(0, 0, 8) * millimeter, "radius" : 10 * millimeter });
        fCuboid(context, id + "rack", { "corner1" : vector(-40, 10, 0) * millimeter, "corner2" : vector(40, 16, 8) * millimeter });
        part(context, id + "base", "Base");
        part(context, id + "pinion", "Pinion");
        part(context, id + "rack", "Rack");
        connector(context, id + "mcBasePinion", qCreatedBy(id + "base", EntityType.BODY), vector(0, 0, 0), vector(0, 0, 1));
        connector(context, id + "mcPinion", qCreatedBy(id + "pinion", EntityType.BODY), vector(0, 0, 0), vector(0, 0, 1));
        connector(context, id + "mcBaseRack", qCreatedBy(id + "base", EntityType.BODY), vector(0, 13, 0), vector(1, 0, 0));
        connector(context, id + "mcRack", qCreatedBy(id + "rack", EntityType.BODY), vector(0, 13, 0), vector(1, 0, 0));
    });

function connector(context is Context, id is Id, owner is Query, origin is Vector, zAxis is Vector)
{
    const xAxis = zAxis[2] == 0 ? vector(0, 0, 1) : vector(1, 0, 0);
    opMateConnector(context, id, { "coordSystem" : coordSystem(origin * millimeter, xAxis, zAxis), "owner" : owner });
}

function part(context is Context, featureId is Id, name is string)
{
    setProperty(context, { "entities" : qCreatedBy(featureId, EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : name });
}
`;

/** Pitch circumference of the 10 mm pinion, in inches. */
const PINION_TRAVEL_IN = (2 * Math.PI * 10) / 25.4;

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
      const circle = await call("onshape_sketch_circle", { doc, ws, elem, center: [1, 0.5], radius: 0.1 });
      await call("onshape_hole", { doc, ws, elem, sketch: circle?.featureId, end_type: "THROUGH_ALL" });
      // The hole's rim: radius 0.1 centred on sketch (1, 0.5), which the Front
      // plane maps to world x = 1, z = 0.5. Fillet arcs share the radius, so
      // the centre is what identifies it.
      const rims = await call("onshape_find_circular_edges", { doc, ws, elem, radius: 0.1 });
      const near = (a, b) => Math.abs(a - b) < 1e-4;
      if (!rims?.some((edge) => near(edge.center?.[0], 1) && near(edge.center?.[2], 0.5))) {
        failures += 1;
        console.log("✖ onshape_find_circular_edges did not find the hole's rim");
      }
      // A second body 1 in clear of the first, extruded about its sketch plane.
      const block = await call("onshape_sketch_rectangle", { doc, ws, elem, corner1: [3, 0], corner2: [4, 1] });
      const blockSketch = block?.featureId;
      const blockExtrude = await call("onshape_extrude", { doc, ws, elem, sketch: blockSketch, depth: 0.5, end_type: "SYMMETRIC" });
      const sides = { a: { feature: extrude?.featureId }, b: { feature: blockExtrude?.featureId } };
      await call("onshape_clearance", { doc, ws, elem, ...sides });
      await call("onshape_measure", { doc, ws, elem });
      await call("onshape_get_edges", { doc, ws, elem });
      await call("onshape_set_variable", { doc, ws, elem, name: "wall", expression: "0.125 in" });
      // On accounts without the variable table this must rewrite the first
      // Variable feature (result.action "updated"), not append a second.
      await call("onshape_set_variable", { doc, ws, elem, name: "wall", expression: "0.25 in" });
      await call("onshape_get_variables", { doc, ws, elem });
      // The feature list renders a Variable's name from Onshape's template; a
      // spelled-out "#wall = ..." name shows as "? = ...".
      const tree = await call("onshape_get_features", { doc, ws, elem });
      const wall = tree?.features?.find((feature) => feature.featureType === "assignVariable");
      const valueParameter = wall?.parameters?.find((parameter) => parameter.parameterId === "value");
      if (wall?.name !== "###name = #value" || valueParameter?.expression !== "0.25 in") {
        failures += 1;
        console.log(`✖ the wall Variable is named ${JSON.stringify(wall?.name)}, value ${JSON.stringify(valueParameter?.expression)}`);
      }
      await call("onshape_shaded_view", { doc, ws, elem, out: "/tmp/onshape-mcp-smoke.png", return_image: false });
      await call("onshape_export_stl", { doc, ws, elem, out: "/tmp/onshape-mcp-smoke.stl" });
    } finally {
      await call("onshape_delete_document", { doc });
    }
  }
}

if (ASSEMBLY_DOC) {
  console.log("\n-- assembly path --");
  await assemblyPath(ASSEMBLY_DOC);
}

await client.close();
console.log(failures ? `\n${failures} call(s) failed.` : "\nAll smoke calls succeeded.");
process.exit(failures ? 1 : 0);

async function assemblyPath(doc) {
  const workspaces = await call("onshape_get_workspaces", { doc });
  const ws = workspaces?.[0]?.id;
  if (!ws) return;
  const stamp = new Date().toISOString().slice(0, 19);

  const studio = await call("onshape_create_feature_studio", { doc, ws, name: `Smoke features ${stamp}` });
  const fsElem = studio?.response?.id ?? studio?.id;
  await call("onshape_set_feature_studio", { doc, ws, elem: fsElem, contents: RACK_AND_PINION_FS });
  const specs = await call("onshape_get_feature_studio_specs", { doc, ws, elem: fsElem });
  const namespace = specs?.featureSpecs?.find((spec) => spec.featureType === "smokeRackPinion")?.namespace;
  const partStudio = await call("onshape_create_part_studio", { doc, ws, name: `Smoke rack and pinion ${stamp}` });
  const psElem = partStudio?.response?.id ?? partStudio?.id;
  const custom = await call("onshape_add_feature", {
    doc,
    ws,
    elem: psElem,
    feature: {
      btType: "BTFeatureDefinitionCall-1406",
      feature: { btType: "BTMFeature-134", featureType: "smokeRackPinion", name: "Rack and pinion", namespace, suppressed: false, parameters: [] },
    },
  });
  const fid = custom?.featureId;
  const parts = await call("onshape_get_parts", { doc, ws, elem: psElem });
  const partId = (name) => parts?.find((part) => part.name === name)?.partId;

  const assembly = await call("onshape_create_assembly", { doc, ws, name: `Smoke assembly ${stamp}` });
  const elem = assembly?.response?.id ?? assembly?.id;
  const target = { doc, ws, elem };
  await call("onshape_insert_instance", { ...target, src_elem: psElem, part: partId("Base"), fixed: true });
  for (const name of ["Pinion", "Rack", "Pinion"]) {
    await call("onshape_insert_instance", { ...target, src_elem: psElem, part: partId(name) });
  }
  const structure = await call("onshape_get_assembly", target);
  const instances = structure?.rootAssembly?.instances ?? [];
  const occurrences = structure?.rootAssembly?.occurrences ?? [];
  const instance = (name) => instances.find((item) => item.name === name)?.id;
  const [base, pinion, rack, pinion2] = ["Base <1>", "Pinion <1>", "Rack <1>", "Pinion <2>"].map(instance);
  const fixed = (id) => occurrences.find((occurrence) => occurrence.path[0] === id)?.fixed;
  check(fixed(base) === true && fixed(pinion) === false, "insert_instance fixed: the base is fixed, the pinion is not");
  const listed = structure?.parts?.flatMap((part) => part.mateConnectors ?? []).map((mc) => mc.featureId) ?? [];
  check(listed.includes(`${fid}.mcPinion`), "get_assembly lists the Part Studio mate connectors");

  // Mates on Part Studio mate connectors, moving part first.
  const connector = (path, name) => ({ path: [path], connector: `${fid}.${name}` });
  const revolute = await call("onshape_assembly_mate", {
    ...target,
    name: "Pinion revolute",
    type: "REVOLUTE",
    connectors: [connector(pinion, "mcPinion"), connector(base, "mcBasePinion")],
  });
  const slider = await call("onshape_assembly_mate", {
    ...target,
    name: "Rack slider",
    type: "SLIDER",
    connectors: [connector(rack, "mcRack"), connector(base, "mcBaseRack")],
  });

  // A hand-written mate without secondaryAxisAlignment, as earlier versions of
  // onshape_assembly_mate wrote them: a relation on it regenerates with ERROR,
  // which onshape_assembly_add_feature must now report.
  const rawMate = await call("onshape_assembly_add_feature", {
    ...target,
    feature: {
      btType: "BTFeatureDefinitionCall-1406",
      feature: {
        btType: "BTMMate-64",
        featureType: "mate",
        name: "Pinion 2 revolute (hand-written)",
        parameters: [
          { btType: "BTMParameterEnum-145", enumName: "Mate type", value: "REVOLUTE", parameterId: "mateType", namespace: "" },
          {
            btType: "BTMParameterQueryWithOccurrenceList-67",
            parameterId: "mateConnectorsQuery",
            queries: [
              { btType: "BTMPartStudioMateConnectorQuery-1324", featureId: `${fid}.mcPinion`, path: [pinion2] },
              { btType: "BTMPartStudioMateConnectorQuery-1324", featureId: `${fid}.mcBasePinion`, path: [base] },
            ],
          },
        ],
      },
    },
  });
  const broken = await callFails(
    "onshape_assembly_add_feature",
    {
      ...target,
      feature: {
        btType: "BTFeatureDefinitionCall-1406",
        feature: {
          btType: "BTMMateRelation-1412",
          featureType: "mateRelation",
          name: "Gear on an incomplete mate",
          parameters: [
            { btType: "BTMParameterEnum-145", enumName: "Relation type", value: "GEAR", parameterId: "relationType", namespace: "" },
            {
              btType: "BTMParameterQueryWithOccurrenceList-67",
              parameterId: "matesQuery",
              queries: [revolute?.featureId, rawMate?.featureId].map((featureId) => ({
                btType: "BTMFeatureQueryWithOccurrence-157",
                featureId,
                path: [],
                queryData: "Rz",
              })),
            },
            { btType: "BTMParameterQuantity-147", parameterId: "relationRatio", expression: "2" },
          ],
        },
      },
    },
    /status ERROR/,
  );
  // Assembly feature ids carry "/" and "+"; the delete must escape them.
  if (broken?.detail?.featureId) {
    await call("onshape_delete_assembly_feature", { ...target, feature_id: broken.detail.featureId });
  }

  const rackAndPinion = await call("onshape_assembly_relation", {
    ...target,
    type: "RACK_AND_PINION",
    mates: [revolute?.featureId, slider?.featureId],
    distance_per_revolution: PINION_TRAVEL_IN,
    name: "Rack and pinion",
  });
  check(rackAndPinion?.dofs?.join() === "Rz,Tz", "the relation couples the revolute's Rz to the slider's Tz");

  const driven = await call("onshape_set_mate_values", {
    ...target,
    values: [{ mate: revolute?.featureId, rotationZ_deg: 90 }],
  });
  const travel = driven?.find((value) => value.featureId === slider?.featureId)?.translationZ_in;
  check(
    Math.abs(Math.abs(travel) - PINION_TRAVEL_IN / 4) < 1e-3,
    `a quarter turn of the pinion moves the rack a quarter of its pitch circumference (${travel} in)`,
  );

  // The gear relation completes the hand-written mate before relating it.
  const gear = await call("onshape_assembly_relation", {
    ...target,
    type: "GEAR",
    mates: [revolute?.featureId, rawMate?.featureId],
    ratio: 2,
    name: "Gear",
  });
  check(
    gear?.completedMates?.length === 1 && gear.completedMates[0] === rawMate?.featureId,
    "assembly_relation completed the hand-written mate",
  );
  await call("onshape_get_mate_values", target);

  // Limits on the slider through update_assembly_feature; a mate with limits
  // refuses API writes, and set_mate_values must say so.
  const listing = await call("onshape_get_assembly_features", target);
  const sliderFeature = listing?.features?.find((feature) => feature.featureId === slider?.featureId);
  if (sliderFeature) {
    const limit = (parameterId, expression) => ({
      btType: "BTMParameterNullableQuantity-807",
      parameterId,
      isNull: false,
      expression,
      nullValue: parameterId.endsWith("Min") ? "No minimum" : "No maximum",
    });
    const limited = {
      ...sliderFeature,
      parameters: [
        ...sliderFeature.parameters.filter((param) => !/^limit/.test(param.parameterId)),
        { btType: "BTMParameterBoolean-144", parameterId: "limitsEnabled", value: true },
        limit("limitZMin", "-30 mm"),
        limit("limitZMax", "30 mm"),
      ],
    };
    await call("onshape_update_assembly_feature", {
      ...target,
      feature_id: slider?.featureId,
      feature: { btType: "BTFeatureDefinitionCall-1406", feature: limited },
    });
    await callFails(
      "onshape_set_mate_values",
      { ...target, values: [{ mate: slider?.featureId, translationZ_in: 0.5 }] },
      /did not apply/,
    );
  }
  await call("onshape_delete_assembly_feature", { ...target, feature_id: gear?.featureId });
  await callFails(
    "onshape_assembly_relation",
    { ...target, type: "LINEAR", mates: [revolute?.featureId, slider?.featureId] },
    /two SLIDER or CYLINDRICAL/,
  );
  console.log(`assembly: ${doc} / ${ws} / ${elem}`);
}
