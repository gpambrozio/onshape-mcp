import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";

import { startApiKeyFlow, keyPageFor, redirectUriFor } from "../src/auth/login.js";
import type { Credentials } from "../src/auth/types.js";

function nonceOf(url: string): string {
  return new URL(url).searchParams.get("nonce") ?? "";
}

test("api key flow accepts a pasted pair and completes", async () => {
  const seen: Credentials[] = [];
  const flow = await startApiKeyFlow({
    accept: async (creds) => {
      seen.push(creds);
      return "saved";
    },
  });

  const form = await fetch(flow.url);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Access key/);

  const response = await fetch(new URL("/submit", flow.url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      nonce: nonceOf(flow.url),
      access_key: "AK",
      secret_key: "SK",
      base_url: "https://cad.onshape.com",
    }).toString(),
  });

  assert.equal(response.status, 200);
  assert.equal(await flow.wait(1000), "complete");
  assert.deepEqual(seen, [{ kind: "apiKey", accessKey: "AK", secretKey: "SK", baseUrl: "https://cad.onshape.com" }]);
  assert.equal(flow.message, "saved");
});

test("the form links to the key page, and follows a retry onto another stack", async (t) => {
  const flow = await startApiKeyFlow({ accept: async () => { throw new Error("HTTP 401"); } });
  t.after(() => flow.cancel());

  const form = await (await fetch(flow.url)).text();
  assert.match(form, /https:\/\/cad\.onshape\.com\/user\/developer\/apiKeys/);

  const retry = await fetch(new URL("/submit", flow.url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      nonce: nonceOf(flow.url),
      access_key: "AK",
      secret_key: "SK",
      base_url: "https://acme.onshape.com",
    }).toString(),
  });
  assert.equal(retry.status, 400);
  assert.match(await retry.text(), /https:\/\/acme\.onshape\.com\/user\/developer\/apiKeys/);
});

test("a rejected credential keeps the flow open for a retry", async () => {
  let attempts = 0;
  const flow = await startApiKeyFlow({
    accept: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("HTTP 401");
      return "saved on retry";
    },
  });
  const nonce = nonceOf(flow.url);
  const submit = (secret: string) =>
    fetch(new URL("/submit", flow.url), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ nonce, access_key: "AK", secret_key: secret }).toString(),
    });

  const first = await submit("wrong");
  assert.equal(first.status, 400);
  assert.match(await first.text(), /HTTP 401/);
  assert.equal(flow.state, "pending");

  const second = await submit("right");
  assert.equal(second.status, 200);
  assert.equal(await flow.wait(1000), "complete");
  assert.equal(attempts, 2);
});

test("a form without the nonce is refused", async (t) => {
  const flow = await startApiKeyFlow({ accept: async () => "saved" });
  t.after(() => flow.cancel());

  const response = await fetch(new URL("/submit", flow.url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nonce: "guessed", access_key: "AK", secret_key: "SK" }).toString(),
  });
  assert.equal(response.status, 403);
  assert.equal(flow.state, "pending");
});

test("a request that did not address loopback is refused", async (t) => {
  const flow = await startApiKeyFlow({ accept: async () => "saved" });
  t.after(() => flow.cancel());

  // fetch() will not let us forge Host, and forging it is the whole point: a
  // DNS-rebound page reaches us under its own hostname.
  const status = await new Promise<number>((resolve, reject) => {
    const url = new URL(flow.url);
    const req = request(
      { host: "127.0.0.1", port: Number(url.port), path: `${url.pathname}${url.search}`, headers: { Host: "onshape.evil.test" } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("key page and redirect URI follow the account host", () => {
  assert.equal(keyPageFor("https://cad.onshape.com"), "https://cad.onshape.com/user/developer/apiKeys");
  assert.equal(keyPageFor("https://acme.onshape.com"), "https://acme.onshape.com/user/developer/apiKeys");
  assert.equal(redirectUriFor(8471), "http://localhost:8471/oauth/callback");
});
