const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { dashboardCacheHeaders } = require("../src/utils/dashboardCache");

const head = (port, file) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path: file }, (res) => { res.resume(); resolve(res.headers["cache-control"]); }).on("error", reject);
});

test("1.6 hashed dashboard files are cached for a year; index.html is always re-checked", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cache-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "index-AbC123.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "favicon.svg"), "<svg/>");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use(express.static(root, { setHeaders: dashboardCacheHeaders(root) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => server.close());
  const { port } = server.address();

  assert.equal(await head(port, "/assets/index-AbC123.js"), "public, max-age=31536000, immutable");
  assert.equal(await head(port, "/index.html"), "no-cache");
  assert.equal(await head(port, "/favicon.svg"), "no-cache");

  const previous = process.env.OPT_STATIC_ASSET_CACHE;
  process.env.OPT_STATIC_ASSET_CACHE = "false";
  t.after(() => { if (previous === undefined) delete process.env.OPT_STATIC_ASSET_CACHE; else process.env.OPT_STATIC_ASSET_CACHE = previous; });
  assert.equal(await head(port, "/assets/index-AbC123.js"), "public, max-age=0", "switched off: Express default");
});
