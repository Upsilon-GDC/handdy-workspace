// Import-safe recovery operations: no .env, application URI, or connection is
// loaded here. Callers supply an already connected native driver database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { serializeDocument, writeCollection, readCollection } = require('./backupTools');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function catalog(db) {
  const collections = (await db.listCollections().toArray()).filter(row => !row.name.startsWith('system.')).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  for (const row of collections) {
    if (row.type !== 'collection' || row.options?.timeseries || row.options?.capped || row.options?.encryptedFields) {
      throw new Error(`Unsupported collection type/options: ${row.name}. Use a database-native backup.`);
    }
    rows.push({ name: row.name, uuid: row.info?.uuid, options: row.options || {},
      indexes: (await db.collection(row.name).indexes()).sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return rows;
}

async function writeSnapshotBackup({ db, client, folder, onCollection = async () => {} }) {
  // mkdir without recursive/overwrite: a failed or existing backup is never replaced.
  fs.mkdirSync(folder);
  const before = await catalog(db);
  const session = client.startSession({ snapshot: true, causalConsistency: false });
  const manifest = { formatVersion: 2, complete: true, createdAt: new Date().toISOString(), database: db.databaseName,
    consistency: 'snapshot-session', collections: Object.create(null) };
  try {
    for (const row of before) {
      const file = `${encodeURIComponent(row.name)}.jsonl.gz`;
      const count = await writeCollection(db.collection(row.name).find({}, { session, promoteValues: false }), path.join(folder, file));
      manifest.collections[row.name] = { file, count, sha256: await hashFile(path.join(folder, file)), options: row.options, indexes: row.indexes };
      await onCollection(row.name, count);
    }
    if (serializeDocument(before) !== serializeDocument(await catalog(db))) throw new Error('Collection/index metadata changed during backup. Freeze schema changes and retry.');
    manifest.snapshotTime = session.snapshotTime || null;
    // Completion marker is published only after every cursor, file, and metadata check succeeds.
    fs.writeFileSync(path.join(folder, 'manifest.json.tmp'), serializeDocument(manifest), { flag: 'wx' });
    fs.renameSync(path.join(folder, 'manifest.json.tmp'), path.join(folder, 'manifest.json'));
    return manifest;
  } finally { await session.endSession(); }
}

function backupFile(folder, filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.jsonl.gz') || filename.includes('/') || filename.includes('\\')) throw new Error('Invalid backup filename.');
  const root = fs.realpathSync(folder);
  const file = fs.realpathSync(path.join(root, filename));
  const relative = path.relative(root, file);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Backup file escapes its folder.');
  return file;
}

async function verifyBackup(folder, { allowLegacy = false } = {}) {
  const { parseDocument } = require('./backupTools');
  const manifest = parseDocument(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const legacy = allowLegacy && manifest.formatVersion === undefined && typeof manifest.createdAt === 'string';
  if ((!legacy && (Number(manifest.formatVersion) !== 2 || manifest.complete !== true || manifest.consistency !== 'snapshot-session'))
    || typeof manifest.database !== 'string' || !manifest.database || !manifest.collections || typeof manifest.collections !== 'object' || Array.isArray(manifest.collections)) {
    throw new Error('A completed format-2 snapshot backup is required. Legacy exports require --allow-legacy and independent review.');
  }
  const files = new Set();
  for (const [name, entry] of Object.entries(manifest.collections)) {
    if (legacy && entry) { entry.file = `${name}.jsonl.gz`; entry.indexes ||= []; }
    if (!name || name.includes('\0') || name.startsWith('system.') || !entry || !Array.isArray(entry.indexes)
      || !Number.isSafeInteger(Number(entry.count)) || Number(entry.count) < 0 || (!legacy && !/^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('Invalid collection manifest.');
    const file = backupFile(folder, entry.file);
    if (files.has(file)) throw new Error('Duplicate collection file.');
    files.add(file);
    const actualHash = await hashFile(file);
    if (legacy) entry.sha256 = actualHash; // Baseline for this restore, not proof of original integrity.
    if (actualHash !== entry.sha256) throw new Error(`Backup checksum mismatch: ${name}`);
    let count = 0;
    for await (const _document of readCollection(file)) count++;
    if (count !== Number(entry.count)) throw new Error(`Backup record count mismatch: ${name}`);
  }
  if (legacy) manifest.consistency = 'legacy-unverified';
  return manifest;
}

async function restoreSnapshotBackup({ sourceDb, client, folder, target, allowLegacy = false }) {
  if (typeof target !== 'string' || !/^[A-Za-z0-9_-]+$/.test(target) || ['admin', 'local', 'config', sourceDb.databaseName.toLowerCase()].includes(target.toLowerCase())) throw new Error('Choose a separate recovery database name.');
  const manifest = await verifyBackup(folder, { allowLegacy }); // Every file is checked before any database writes.
  if (target.toLowerCase() === manifest.database.toLowerCase()) throw new Error('Refusing to restore into the backup source database.');
  const db = client.db(target);
  if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('Recovery target must be empty; existing collections are never replaced.');
  for (const [name, entry] of Object.entries(manifest.collections)) {
    const collection = await db.createCollection(name, entry.options || {});
    let batch = [];
    // Verify again immediately before consuming this file; keep backup storage read-only during restore.
    const file = backupFile(folder, entry.file);
    if (await hashFile(file) !== entry.sha256) throw new Error(`Backup changed during restore: ${name}`);
    for await (const document of readCollection(file)) {
      batch.push(document);
      if (batch.length === 500) { await collection.insertMany(batch, { ordered: true }); batch = []; }
    }
    if (batch.length) await collection.insertMany(batch, { ordered: true });
    for (const { key, name: indexName, v: _v, ns: _ns, ...options } of entry.indexes) {
      if (indexName !== '_id_') await collection.createIndex(key, { name: indexName, ...options });
    }
    if (await collection.countDocuments() !== Number(entry.count)) throw new Error(`Restored count mismatch: ${name}`);
  }
  return { database: target, collections: Object.keys(manifest.collections).length, consistency: manifest.consistency };
}

module.exports = { hashFile, writeSnapshotBackup, verifyBackup, restoreSnapshotBackup };
