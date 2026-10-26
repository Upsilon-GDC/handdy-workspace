require("dotenv").config();

// Restores a backup made by backupDatabase.js into a SEPARATE database, for a
// restore drill or to recover records. It never writes to the database named in
// MONGODB_URI (the live CRM), replaces only the collections in the backup, and
// recreates their indexes, then checks every count against the manifest.
//
//   node scripts/restoreDatabase.js --from D:\CRM-backups\2026-10-26T18-00-00Z --to-db crm_restore_test
//
// Going live with a restored database is a deliberate, separate step: point
// MONGODB_URI at it (see docs/BACKUP_AND_RESTORE.md).
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { argument, databaseNameFromUri, readCollection } = require("./backupTools");

const BATCH = 500;

const main = async () => {
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) throw new Error("MONGODB_URI is required.");
  const folder = path.resolve(argument("--from"));
  const target = argument("--to-db");
  if (!fs.existsSync(path.join(folder, "manifest.json"))) throw new Error("--from must be a backup folder containing manifest.json.");
  if (!target) throw new Error("--to-db is required (a separate database, for example crm_restore_test).");
  if (target === databaseNameFromUri(uri)) {
    throw new Error(`Refusing to restore into "${target}", the live CRM database. Choose another --to-db.`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));

  await mongoose.connect(uri, { compressors: ["zlib"] });
  const db = mongoose.connection.getClient().db(target);
  let mismatches = 0;
  for (const [name, { count, indexes = [] }] of Object.entries(manifest.collections)) {
    const collection = db.collection(name);
    await collection.drop().catch(() => {});
    let batch = [];
    for await (const document of readCollection(path.join(folder, `${name}.jsonl.gz`))) {
      batch.push(document);
      if (batch.length >= BATCH) { await collection.insertMany(batch, { ordered: true }); batch = []; }
    }
    if (batch.length) await collection.insertMany(batch, { ordered: true });
    for (const { key, name: indexName, v: _v, ns: _ns, ...options } of indexes) {
      if (indexName !== "_id_") await collection.createIndex(key, { name: indexName, ...options });
    }
    const restored = await collection.countDocuments();
    const ok = restored === count;
    if (!ok) mismatches += 1;
    console.log(`${ok ? "OK  " : "DIFF"} ${name}: ${restored} of ${count} documents, ${indexes.length} indexes`);
  }
  if (mismatches) throw new Error(`${mismatches} collection(s) do not match the backup.`);
  console.log(`Restore into "${target}" complete and verified.`);
};

main()
  .catch((error) => {
    console.error(`Restore failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
