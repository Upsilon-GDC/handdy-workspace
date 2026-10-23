const test = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");
const { validateRelease } = require("../scripts/publish-release.cjs");

function requestFor({ publicRepo = true, existing = false, latest = "1.2.22", fail = false } = {}) {
  return async (url, options) => {
    assert.equal(options.signal.aborted, false);
    if (url.includes("/tags/")) {
      assert.ok(options.headers.Authorization);
      return { ok: existing, status: existing ? 200 : 404 };
    }
    assert.equal(options.headers.Authorization, undefined, "Public update access must not need publishing credentials");
    if (url.endsWith("/latest")) return { ok: !fail, status: fail ? 503 : 200, json: async () => ({ tag_name: `v${latest}` }) };
    return { ok: publicRepo, status: publicRepo ? 200 : 404, json: async () => ({ private: !publicRepo }) };
  };
}

test("identity and NSIS install scope remain unchanged; builds never publish", () => {
  assert.equal(pkg.build.appId, "com.handdy.timetracker");
  assert.equal(pkg.build.productName, "CRM");
  assert.equal(pkg.name, "handdy-desktop-app");
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
  assert.ok(pkg.build.files.includes("app-updater.js"));
  assert.ok(pkg.build.files.includes("timer-lock.js"));
  assert.ok(pkg.build.files.includes("lock-overlay.html"));
  assert.match(pkg.scripts.build, /--publish never/);
  assert.equal(pkg.build.publish[0].releaseType, "draft");
  assert.equal(pkg.build.publish[0].private, false);
  assert.equal(pkg.build.publish[0].token, undefined);
});

test("release preflight accepts a new version in a public repository", async () => {
  await validateRelease({ token: "test-only", request: requestFor() });
});

test("release preflight refuses missing credentials, private repositories, reused versions and outages", async () => {
  await assert.rejects(validateRelease({ token: "", request: requestFor() }), /GH_TOKEN/);
  await assert.rejects(validateRelease({ token: "test-only", request: requestFor({ publicRepo: false }) }), /publicly accessible/);
  await assert.rejects(validateRelease({ token: "test-only", request: requestFor({ existing: true }) }), /already exists/);
  await assert.rejects(validateRelease({ token: "test-only", request: requestFor({ latest: pkg.version }) }), /greater/);
  await assert.rejects(validateRelease({ token: "test-only", request: requestFor({ fail: true }) }), /HTTP 503/);
  const packageInfo = { ...pkg, version: "1.2.24-beta.1" };
  await assert.rejects(validateRelease({ packageInfo, token: "test-only", request: requestFor() }), /stable semantic version/);
});
