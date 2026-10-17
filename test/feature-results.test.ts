/** Offline write-outcome tests; all API calls are fake and files stay in a temporary directory. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolContext } from "../src/tools/context.js";
import { addPartStudioFeature } from "../src/tools/feature-helpers.js";
import { partStudioTools } from "../src/tools/partstudio.js";

const update = partStudioTools.find(t => t.name === "onshape_update_feature")!;
const args = { doc: "d", ws: "w", elem: "e", feature_id: "f", feature: {} };
const response = { feature: { featureId: "f" }, payload: "é".repeat(2000) };
const validation = { featureId: "f", featureStatus: "OK" };

for (const operation of ["create", "update"] as const) {
  const marker = operation === "create" ? "creationApplied" : "updateApplied";
  const run = (ctx: ToolContext, extra = {}) => operation === "create"
    ? addPartStudioFeature(ctx, { ...args, ...extra }, () => ({}))
    : update.handler({ ...args, ...extra }, ctx);
  for (const validationFails of [false, true]) {
    for (const storage of ["inline", "file", "write-failure", "path-failure"] as const) {
      test(`${operation}: ${validationFails ? "failed" : "successful"} verification with ${storage}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), "onshape-results-"));
        const calls: string[] = [];
        const post = async () => { calls.push("POST"); return response; };
        const ctx = {
          maxResponseBytes: storage === "inline" ? 100000 : 100,
          resolveOutputPath: (name: string) => {
            if (storage === "path-failure") throw new Error("output path unavailable");
            return storage === "write-failure" ? dir : join(dir, name);
          },
          api: () => ({ partStudios: {
            addFeature: post, updateFeature: post,
            validateFeature: async () => {
              calls.push("GET");
              if (validationFails) throw new Error("validation read failed");
              return validation;
            },
          } }),
        } as unknown as ToolContext;
        try {
          const result = await run(ctx);
          const payload = JSON.parse(String(result.content[0].text));
          assert.equal(result.isError, validationFails ? true : undefined);
          assert.equal(payload.ok, !validationFails);
          const summary = validationFails ? payload.detail : payload.result;
          assert.equal(summary[marker], true);
          assert.equal(summary.featureId, "f");
          if (validationFails) assert.equal(payload.error, "validation read failed");
          else assert.deepEqual(summary.validation, validation);
          assert.deepEqual(calls, ["POST", "GET"]);
          if (storage === "inline") assert.deepEqual(summary.response, response);
          else {
            assert.equal(payload.truncated, true);
            assert.equal(summary.response, undefined);
            if (storage === "file") {
              const full = readFileSync(payload.saved_to, "utf8");
              assert.equal(payload.bytes, Buffer.byteLength(full));
              const saved = JSON.parse(full);
              assert.deepEqual((validationFails ? saved.detail : saved.result).response, response);
              const second = JSON.parse(String((await run(ctx)).content[0].text));
              assert.notEqual(second.saved_to, payload.saved_to);
            } else {
              assert.equal(typeof payload.responseStorageError, "string");
              assert.equal(payload.saved_to, undefined);
            }
          }
        } finally { rmSync(dir, { recursive: true, force: true }); }
      });
    }
  }
  test(`${operation}: a rejected POST never claims an acknowledged write`, async () => {
    let verified = false;
    const post = async () => { throw new Error("POST failed"); };
    const ctx = { api: () => ({ partStudios: {
      addFeature: post, updateFeature: post,
      validateFeature: async () => { verified = true; return validation; },
    } }) } as unknown as ToolContext;
    const result = await run(ctx);
    assert.equal(result.isError, true);
    assert.equal(verified, false);
    assert.equal(JSON.stringify(result).includes(marker), false);
  });
}

test("skipping add validation remains explicit in the compact response", async () => {
  const ctx = {
    maxResponseBytes: 100,
    resolveOutputPath: () => { throw new Error("no output directory"); },
    api: () => ({ partStudios: {
      addFeature: async () => response,
      validateFeature: async () => { throw new Error("must not validate"); },
    } }),
  } as unknown as ToolContext;
  const result = await addPartStudioFeature(ctx, { ...args, validate: false }, () => ({}));
  const payload = JSON.parse(String(result.content[0].text));
  assert.equal(payload.ok, true);
  assert.equal(payload.result.creationApplied, true);
  assert.equal(payload.result.validationSkipped, true);
  assert.equal(payload.result.validation, undefined);
});
