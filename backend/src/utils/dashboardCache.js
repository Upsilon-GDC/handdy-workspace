const path = require("path");
const { isOn } = require("../config/optimizations");

const YEAR_SECONDS = 365 * 24 * 60 * 60;

// Vite names every file under dashboard/dist/assets with a content hash, so a
// changed file always has a new URL: browsers may keep those for a year.
// index.html and other files are re-checked on each load, so a deploy shows
// at once. With OPT_STATIC_ASSET_CACHE=false Express's defaults apply.
function dashboardCacheHeaders(root) {
  return (res, filePath) => {
    if (!isOn("staticAssetCache")) return;
    const hashed = path.relative(root, filePath).split(path.sep)[0] === "assets";
    res.setHeader("Cache-Control", hashed ? `public, max-age=${YEAR_SECONDS}, immutable` : "no-cache");
  };
}

module.exports = { dashboardCacheHeaders };
