/** Offline regression checks for edits that succeed over HTTP but fail regeneration. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OnshapeClient } from "../src/api/client.js";
import { PartStudioManager } from "../src/api/partstudio.js";
import type { ToolContext } from "../src/tools/context.js";
import { partStudioTools } from "../src/tools/partstudio.js";
import { addPartStudioFeature } from "../src/tools/feature-helpers.js";

const state = (featureStatus: string) => ({ featureStatus });
function fixture(featureStates: unknown, response: unknown = { feature: { featureId: "sketch" } }) {
  const calls: string[] = [];
  const manager = new PartStudioManager({
    post: async () => { calls.push("POST"); return response; },
    get: async () => { calls.push("GET"); return { featureStates }; },
  } as unknown as OnshapeClient);
  const ctx = { api: () => ({ partStudios: manager }), maxResponseBytes: 200_000 } as unknown as ToolContext;
  return { manager, ctx, calls };
}
const args = { doc: "d", ws: "w", elem: "e", feature_id: "sketch", feature: {} };
const update = partStudioTools.find(t => t.name === "onshape_update_feature")!;

test("an edit verifies the feature state after the POST", async () => {
  const f = fixture({ sketch: state("OK"), extrude: state("OK") });
  const result = await update.handler(args, f.ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(f.calls, ["POST", "GET"]);
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
    const payload = JSON.parse(String(result.content[0].text));
    assert.equal(payload.detail.updateApplied, true);
    assert.deepEqual(f.calls, ["POST", "GET"]);
  });
}
test("single-feature validation rejects absent states", async () => {
  await assert.rejects(fixture(undefined).manager.validateFeature("d", "w", "e", "sketch"), /Cannot verify/);
});
test("warnings remain visible without being treated as errors", async () => {
  const result = await fixture({ sketch: state("WARNING") }).manager.validateFeature("d", "w", "e", "sketch");
  assert.equal(result.featureStatus, "WARNING");
});
test("a missing id after add cannot silently skip validation", async () => {
  const f = fixture({}, {});
  const result = await addPartStudioFeature(f.ctx, args, () => ({}) as never);
  assert.equal(result.isError, true);
});
