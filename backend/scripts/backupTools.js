// Shared helpers for backupDatabase.js and restoreDatabase.js. One gzipped
// file per collection, one Extended JSON document per line, so ObjectIds,
// dates and numbers come back exactly as stored.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
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
  let count = 0;
  async function* lines() {
    for await (const document of cursor) {
      count++;
      yield `${serializeDocument(document)}\n`;
    }
  }
  await pipeline(Readable.from(lines()), zlib.createGzip(), fs.createWriteStream(file, { flags: 'wx' }));
  return count;
}

async function* readCollection(file) {
  const input = fs.createReadStream(file);
  const unzip = zlib.createGunzip();
  const complete = pipeline(input, unzip);
  complete.catch(() => {}); // Observe early stream errors before iteration awaits them.
  const lines = readline.createInterface({ input: unzip, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) yield parseDocument(line);
    await complete;
  } finally { lines.close(); input.destroy(); unzip.destroy(); }
}

// Backup folders are named by time, so sorting names sorts by age.
function oldBackups(root, keep) {
  if (!fs.existsSync(root)) return [];
  const folders = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(entry.name))
    .filter(entry => {
      try {
        const manifest = parseDocument(fs.readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8'));
        return Number(manifest.formatVersion) === 2 && manifest.complete === true;
      } catch { return false; }
    })
    .map((entry) => entry.name)
    .sort();
  return folders.slice(0, Math.max(0, folders.length - keep)).map((name) => path.join(root, name));
}

const argument = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || "");
};

module.exports = { argument, databaseNameFromUri, oldBackups, parseDocument, readCollection, serializeDocument, writeCollection };
