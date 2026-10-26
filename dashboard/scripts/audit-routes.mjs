import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(dashboardRoot, "src");
const routesSource = await readFile(path.join(sourceRoot, "routes", "AppRoutes.jsx"), "utf8");
const routePaths = [...routesSource.matchAll(/\bpath="([^"]+)"/g)].map((match) => match[1]);

const sourceFiles = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(fullPath);
    else if (/\.(?:js|jsx)$/.test(entry.name)) sourceFiles.push(fullPath);
  }
};
await visit(sourceRoot);

const targets = new Set();
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\bto="(\/[^"?#]*)"/g)) targets.add(match[1]);
  for (const match of source.matchAll(/\bnavigate\(\s*["'](\/[^"'?#]*)["']/g)) targets.add(match[1]);
  // Sidebar entries are data, not JSX links.
  if (path.basename(file) === "workspaceNavigation.js") {
    for (const match of source.matchAll(/\bpath:\s*"(\/[^"?#]*)"/g)) targets.add(match[1]);
  }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routeMatches = (target) => routePaths.some((routePath) => {
  const pattern = routePath
    .split("/")
    .map((segment) => segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment))
    .join("/");
  return new RegExp(`^${pattern}$`).test(target);
});

const missing = [...targets].filter((target) => !routeMatches(target)).sort();
if (missing.length > 0) {
  console.error(`Missing registered routes:\n${missing.map((target) => `- ${target}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Route audit passed: ${targets.size} static navigation targets, ${routePaths.length} registered routes.`);
}
