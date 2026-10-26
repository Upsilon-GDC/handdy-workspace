const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");

const root = path.resolve(__dirname, "..");

// The installer contains only package.json -> build.files. Walk what the app
// actually loads, starting at `main`: local require() calls, loadFile() and
// __dirname paths in scripts, pages the renderer navigates to, and the
// scripts/styles each page references. Any file found must be packaged.
function collectRuntimeFiles(entry = pkg.main) {
  const found = new Set();
  const add = (fromFile, reference) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), reference));
    const withExtension = path.extname(resolved) ? resolved : `${resolved}.js`;
    visit(withExtension);
  };
  const visit = (file) => {
    if (found.has(file)) return;
    found.add(file);
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) return; // Reported by the test below.
    const source = fs.readFileSync(fullPath, "utf8");
    if (file.endsWith(".js")) {
      for (const [, reference] of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) add(file, reference);
      for (const [, reference] of source.matchAll(/\.loadFile\(\s*["']([^"']+)["']/g)) add(file, reference);
      for (const [, reference] of source.matchAll(/path\.join\(\s*__dirname\s*,\s*["']([^"']+)["']\s*\)/g)) add(file, reference);
      for (const [, reference] of source.matchAll(/["'](\.\/[\w.-]+\.html)["']/g)) add(file, reference);
    } else if (file.endsWith(".html")) {
      for (const [, reference] of source.matchAll(/\b(?:src|href)=["'](?![a-z]+:|#|\/\/)([^"']+)["']/gi)) add(file, reference);
    }
  };
  visit(path.posix.normalize(entry));
  return [...found].sort();
}

const globToRegExp = (pattern) => new RegExp(`^${pattern
  .split("**").map((part) => part.split("*").map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
  .join(".*")}$`);
const isPackaged = (file) => pkg.build.files.some((pattern) => !pattern.startsWith("!") && globToRegExp(pattern).test(file));

test("the runtime walk finds the app's main, page and lock files", () => {
  const files = collectRuntimeFiles();
  for (const expected of ["main.js", "preload.js", "renderer.js", "timer-lock.js", "app-updater.js", "api-config.js",
    "idle-policy-defaults.json", "index.html", "dashboard.html", "lock-overlay.html", "style.css"]) {
    assert.ok(files.includes(expected), `${expected} should be reached from ${pkg.main}`);
  }
});

test("every file the app loads at runtime exists and is listed in build.files", () => {
  const files = collectRuntimeFiles();
  const missingOnDisk = files.filter((file) => !fs.existsSync(path.join(root, file)));
  assert.deepEqual(missingOnDisk, [], "referenced files must exist");
  const unpackaged = files.filter((file) => !isPackaged(file));
  assert.deepEqual(unpackaged, [], `add these to package.json -> build.files or the installed app will fail to start`);
});

test("every build.files entry matches a real file", () => {
  for (const pattern of pkg.build.files.filter((entry) => !entry.startsWith("!"))) {
    const matcher = globToRegExp(pattern);
    const exists = pattern.includes("*")
      ? fs.readdirSync(root, { recursive: true }).some((file) => matcher.test(String(file).replaceAll("\\", "/")))
      : fs.existsSync(path.join(root, pattern));
    assert.ok(exists, `build.files lists ${pattern}, which does not exist`);
  }
});

test("a new top-level file that is not packaged is detected", () => {
  assert.equal(isPackaged("renderer.js"), true);
  assert.equal(isPackaged("new-helper.js"), false);
});
