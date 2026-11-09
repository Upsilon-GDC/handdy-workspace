const path = require("node:path");
const semver = require("semver");
const { build, Platform, Arch } = require("electron-builder");
const pkg = require("../package.json");
const { signingConfiguration } = require('./build-signed.cjs');

async function validateRelease({ packageInfo = pkg, token = process.env.GH_TOKEN, request = fetch } = {}) {
  if (!token) throw new Error("Set GH_TOKEN in this build terminal only. Never place it in application files.");
  const version = packageInfo.version;
  if (!semver.valid(version) || semver.prerelease(version)) {
    throw new Error("Use a stable semantic version (for example 1.2.23) before publishing.");
  }
  const provider = packageInfo.build.publish[0];
  if (provider.provider !== "github" || provider.private !== false || provider.releaseType !== "draft") {
    throw new Error("Publishing requires a public GitHub provider with releaseType draft.");
  }
  const base = `https://api.github.com/repos/${encodeURIComponent(provider.owner)}/${encodeURIComponent(provider.repo)}`;
  const publicHeaders = { Accept: "application/vnd.github+json", "User-Agent": "CRM-release-preflight" };
  const get = (url, authenticated = false) => request(url, {
    headers: authenticated ? { ...publicHeaders, Authorization: `Bearer ${token}` } : publicHeaders,
    signal: AbortSignal.timeout(30_000),
  });
  const repository = await get(base);
  if (!repository.ok || (await repository.json()).private !== false) {
    throw new Error("The release repository must be publicly accessible without authentication. Verify owner/repo and visibility.");
  }
  const existing = await get(`${base}/releases/tags/v${version}`, true);
  if (existing.status !== 404) {
    if (existing.ok) throw new Error(`Release v${version} already exists. Increase the version; published assets must never be replaced.`);
    throw new Error(`Could not validate release uniqueness (HTTP ${existing.status}). Check GH_TOKEN permissions.`);
  }
  const latest = await get(`${base}/releases/latest`);
  if (latest.ok) {
    const latestVersion = semver.valid((await latest.json()).tag_name?.replace(/^v/, ""));
    if (!latestVersion || !semver.gt(version, latestVersion)) {
      throw new Error("The new version must be greater than the latest public stable release.");
    }
  } else if (latest.status !== 404) {
    throw new Error(`Could not check the latest release (HTTP ${latest.status}). Try again later.`);
  }
}

async function publish() {
  const config = signingConfiguration();
  await validateRelease();
  // Environment overrides must not turn the requested draft into a live release.
  process.env.EP_DRAFT = "true";
  process.env.EP_PRE_RELEASE = "false";
  process.env.EP_PRELEASE = "false";
  await build({
    projectDir: path.resolve(__dirname, ".."),
    targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
    config,
    publish: "always",
  });
  console.log(`Draft v${pkg.version} uploaded. Review installer, blockmap and latest.yml before publishing the draft on GitHub.`);
}

if (require.main === module) {
  publish().catch((error) => {
    console.error(`Release preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { validateRelease };
