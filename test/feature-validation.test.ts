/** Offline regression checks for edits that succeed over HTTP but fail regeneration. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OnshapeClient } from "../src/api/client.js";
import { PartStudioManager } from "../src/api/partstudio.js";
import type { ToolContext } from "../src/tools/context.js";
import { partStudioTools } from "../src/tools/partstudio.js";
import { addPartStudioFeature } from "../src/tools/feature-helpers.js";
import type { ToolResult } from "../src/tools/types.js";

const state = (featureStatus: string) => ({ featureStatus });
/** A Part Studio whose feature states read as `before` until the POST and as
 *  `after` once it has landed. */
function fixture(after: unknown, response: unknown = { feature: { featureId: "sketch" } }, before: unknown = {}) {
  const calls: string[] = [];
  let posted = false;
  const manager = new PartStudioManager({
    post: async () => { calls.push("POST"); posted = true; return response; },
    get: async () => { calls.push("GET"); return { featureStates: posted ? after : before }; },
  } as unknown as OnshapeClient);
  const ctx = { api: () => ({ partStudios: manager }), maxResponseBytes: 200_000 } as unknown as ToolContext;
  return { manager, ctx, calls };
}
const args = { doc: "d", ws: "w", elem: "e", feature_id: "sketch", feature: {} };
const update = partStudioTools.find(t => t.name === "onshape_update_feature")!;
const payloadOf = (result: ToolResult) => JSON.parse(String(result.content[0].text));

test("an edit reads the feature states before and after the POST", async () => {
  const f = fixture({ sketch: state("OK"), extrude: state("OK") });
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(f.calls, ["GET", "POST", "GET"]);
  assert.equal(payloadOf(result).result.validation.preexistingErrors, undefined);
});
for (const [name, states] of Object.entries({
  "edited feature failed": { sketch: state("ERROR") },
  "downstream feature failed": { sketch: state("OK"), extrude: state("ERROR") },
  "feature state missing": {},
  "feature status missing": { sketch: {} },
  "feature status empty": { sketch: state("") },
})) {
  test(`an edit reports applied but unverified when ${name}`, async () => {
    const f = fixture(states);
    const result = await update.handler(args, f.ctx);
    assert.equal(result.isError, true);
    assert.equal(payloadOf(result).detail.updateApplied, true);
    assert.deepEqual(f.calls, ["GET", "POST", "GET"]);
  });
}
test("an error that was there before the edit is reported, not failed on", async () => {
  const before = { sketch: state("OK"), fillet: state("ERROR") };
  const f = fixture({ sketch: state("OK"), fillet: state("ERROR"), extrude: state("OK") }, undefined, before);
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, undefined);
  const payload = payloadOf(result);
  assert.equal(payload.result.updateApplied, true);
  assert.deepEqual(payload.result.validation.preexistingErrors, ["fillet"]);
});
test("a new error fails the edit even when another error was already there", async () => {
  const before = { sketch: state("OK"), fillet: state("ERROR"), extrude: state("OK") };
  const f = fixture({ sketch: state("OK"), fillet: state("ERROR"), extrude: state("ERROR") }, undefined, before);
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, true);
  const payload = payloadOf(result);
  assert.match(payload.error, /new regeneration errors: extrude\./);
  assert.equal(payload.detail.updateApplied, true);
});
test("an edited feature still in ERROR fails even if it was broken before", async () => {
  const f = fixture({ sketch: state("ERROR") }, undefined, { sketch: state("ERROR") });
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, true);
  assert.match(payloadOf(result).error, /sketch regenerated with status ERROR/);
});
test("an edit that clears an earlier error passes without listing it", async () => {
  const f = fixture({ sketch: state("OK"), extrude: state("OK") }, undefined, { sketch: state("OK"), extrude: state("ERROR") });
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, undefined);
  assert.equal(payloadOf(result).result.validation.preexistingErrors, undefined);
});
test("validate: false skips both reads", async () => {
  const f = fixture({ sketch: state("ERROR") });
  const result = await update.handler({ ...args, validate: false }, f.ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(f.calls, ["POST"]);
  assert.equal(payloadOf(result).result.validationSkipped, true);
});
test("a failed baseline read stops the edit before anything is written", async () => {
  const manager = new PartStudioManager({
    post: async () => { throw new Error("must not post"); },
    get: async () => { throw new Error("HTTP 429"); },
  } as unknown as OnshapeClient);
  const ctx = { api: () => ({ partStudios: manager }), maxResponseBytes: 200_000 } as unknown as ToolContext;
  const result = await update.handler(args, ctx);
  assert.equal(result.isError, true);
  assert.equal(JSON.stringify(result).includes("updateApplied"), false);
});
test("single-feature validation rejects absent states", async () => {
  await assert.rejects(fixture(undefined).manager.validateFeature("d", "w", "e", "sketch"), /Cannot verify/);
});
test("warnings remain visible without being treated as errors", async () => {
  const states = { sketch: state("WARNING") };
  const result = await fixture(states, undefined, states).manager.validateFeature("d", "w", "e", "sketch");
  assert.equal(result.featureStatus, "WARNING");
});
test("a missing id after add cannot silently skip validation", async () => {
  const f = fixture({}, {});
  const result = await addPartStudioFeature(f.ctx, args, () => ({}) as never);
  assert.equal(result.isError, true);
  const payload = payloadOf(result);
  assert.equal(payload.detail.creationApplied, true);
  assert.equal(payload.detail.featureId, null);
});
