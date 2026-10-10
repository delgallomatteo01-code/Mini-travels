// Port of the original tests/logo-upload.test.mjs against the real API router.
import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createTestEnv } from "./helpers";

// Transparent one-pixel PNG: the persisted logo must be byte-for-byte identical.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

test("logo uploads preserve PNG transparency, serve both formats and retain legacy SVGs", async () => {
  const env = createTestEnv();
  const client = createClient(env);
  await client.login();
  const send = (file: File) => {
    const form = new FormData();
    form.set("kind", "logo");
    form.set("file", file);
    form.set("icon192", new File([png], "192.png", { type: "image/png" }));
    form.set("icon512", new File([png], "512.png", { type: "image/png" }));
    return client.call("/api/site-settings", { method: "POST", body: form });
  };
  const logo = () => client.call("/api/site-assets?kind=logo");

  // No upload yet: redirect to the bundled fallback.
  const fallback = await logo();
  assert.equal(fallback.status, 307);
  assert.match(fallback.headers.get("Location") ?? "", /\/brand-logo\.svg$/);

  // Legacy installations stored the logo as site/logo.svg.
  await env.BUCKET.put("site/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', { httpMetadata: { contentType: "image/svg+xml" } });
  assert.equal((await logo()).headers.get("Content-Type"), "image/svg+xml");

  const uploaded = await send(new File([png], "logo.png", { type: "image/png" }));
  assert.equal(uploaded.status, 200);
  const settings = (await uploaded.json() as { settings: { logoVersion: number } }).settings;
  assert.ok(settings.logoVersion > 0, "the version changes so the preview refreshes at once");
  const served = await logo();
  assert.equal(served.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><text y="60">Logo</text></svg>';
  assert.equal((await send(new File([svg], "logo.svg", { type: "image/svg+xml" }))).status, 200);
  const servedSvg = await logo();
  assert.equal(await servedSvg.text(), svg);
  assert.match(servedSvg.headers.get("Content-Security-Policy") ?? "", /default-src 'none'/);

  assert.equal((await send(new File(["not PNG"], "fake.png", { type: "image/png" }))).status, 400);
  assert.equal(await (await logo()).text(), svg, "a rejected upload leaves the previous logo");
  for (const unsafe of [
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><image href="https://tracker.example/x.png"/></svg>',
  ]) {
    assert.equal((await send(new File([unsafe], "unsafe.svg", { type: "image/svg+xml" }))).status, 400, unsafe);
  }
  const bigSvg = `<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(1024 * 1024)}</svg>`;
  assert.equal((await send(new File([bigSvg], "big.svg", { type: "image/svg+xml" }))).status, 400);
});

test("photos must really be JPEG, PNG or WebP within 8 MB", async () => {
  const env = createTestEnv();
  const client = createClient(env);
  await client.login();
  const send = (file: File) => {
    const form = new FormData();
    form.set("kind", "memory-one");
    form.set("file", file);
    return client.call("/api/site-settings", { method: "POST", body: form });
  };
  assert.equal((await send(new File([png], "a.png", { type: "image/png" }))).status, 200);
  assert.equal((await send(new File(["<html>"], "a.jpg", { type: "image/jpeg" }))).status, 400);
  assert.equal((await send(new File([png], "a.gif", { type: "image/gif" }))).status, 400);
  const asset = await client.call("/api/site-assets?kind=memory-one");
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("Content-Type"), "image/png");
});
