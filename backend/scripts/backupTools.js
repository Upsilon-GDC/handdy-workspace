// Shared helpers for backupDatabase.js and restoreDatabase.js. One gzipped
// file per collection, one Extended JSON document per line, so ObjectIds,
// dates and numbers come back exactly as stored.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const mongoose = require("mongoose");

const { EJSON } = mongoose.mongo.BSON;

const serializeDocument = (document) => EJSON.stringify(document, { relaxed: false });
const parseDocument = (line) => EJSON.parse(line, { relaxed: false });

// Database name from a mongodb:// or mongodb+srv:// address ("test" when absent,
// as the driver does).
function databaseNameFromUri(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(uri || ""));
  return decodeURIComponent(match?.[1] || "") || "test";
}

async function writeCollection(cursor, file) {
  const gzip = zlib.createGzip();
  const output = fs.createWriteStream(file);
  gzip.pipe(output);
  let count = 0;
  for await (const document of cursor) {
    if (!gzip.write(`${serializeDocument(document)}\n`)) await new Promise((resolve) => gzip.once("drain", resolve));
    count += 1;
  }
  gzip.end();
  await new Promise((resolve, reject) => { output.on("finish", resolve); output.on("error", reject); });
  return count;
}

async function* readCollection(file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) yield parseDocument(line);
}

// Backup folders are named by time, so sorting names sorts by age.
function oldBackups(root, keep) {
  if (!fs.existsSync(root)) return [];
  const folders = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return folders.slice(0, Math.max(0, folders.length - keep)).map((name) => path.join(root, name));
}

const argument = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || "");
};

module.exports = { argument, databaseNameFromUri, oldBackups, parseDocument, readCollection, serializeDocument, writeCollection };
