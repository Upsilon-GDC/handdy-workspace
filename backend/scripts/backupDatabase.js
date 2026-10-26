require("dotenv").config();

// Saves every collection of the CRM database to a dated folder (one gzipped
// Extended JSON file per collection + manifest.json with counts and indexes).
// Read-only on the database. Backups contain employee data: keep them private
// and outside the repository.
//
//   node scripts/backupDatabase.js --out D:\CRM-backups [--keep 30]
//
// --keep N deletes the oldest backup folders in --out beyond the newest N.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { argument, databaseNameFromUri, oldBackups, writeCollection } = require("./backupTools");

const main = async () => {
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) throw new Error("MONGODB_URI is required.");
  const root = path.resolve(argument("--out", path.join(__dirname, "..", "backups")));
  const keep = Number(argument("--keep", "0"));
  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  const folder = path.join(root, stamp);
  fs.mkdirSync(folder, { recursive: true });

  await mongoose.connect(uri, { compressors: ["zlib"] });
  const db = mongoose.connection.db;
  const manifest = { createdAt: new Date().toISOString(), database: databaseNameFromUri(uri), collections: {} };
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("system."))
    .sort();
  for (const name of collections) {
    const collection = db.collection(name);
    const count = await writeCollection(collection.find({}), path.join(folder, `${name}.jsonl.gz`));
    manifest.collections[name] = { count, indexes: await collection.indexes() };
    console.log(`${name}: ${count} documents`);
  }
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Backup written to ${folder}`);

  if (keep > 0) {
    for (const old of oldBackups(root, keep)) {
      fs.rmSync(old, { recursive: true, force: true });
      console.log(`Removed old backup ${old}`);
    }
  }
};

main()
  .catch((error) => {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
