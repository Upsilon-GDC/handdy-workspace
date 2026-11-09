const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const { writeSnapshotBackup, verifyBackup, restoreSnapshotBackup } = require('../scripts/snapshotBackup');
const { inspectRecovery } = require('../scripts/verifyRecovery');
const { parseDocument, serializeDocument } = require('../scripts/backupTools');
let replica, client;
const unique = () => `crm_recovery_${crypto.randomUUID().replaceAll('-', '')}`;
before(async context => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  if (context.signal.aborted) { await replica.stop(); throw Error('Startup timeout'); }
  const uri = replica.getUri(unique()); assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri); client = mongoose.connection.getClient();
}, { timeout: 900000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = client.db(unique());
  await db.createCollection('alpha', { validator: { counter: { $type: 'int' } } });
  await db.collection('alpha').createIndex({ code: 1 }, { unique: true });
  await db.collection('alpha').insertOne({ code: 'A', counter: 1, exactLong: mongoose.mongo.Long.fromNumber(7), when: new Date('2026-01-01T00:00:00.123Z') });
  await db.collection('beta').insertOne({ counter: 1 });
  return { db, folder: path.join(root, 'backup') };
}

test('one snapshot preserves cross-collection state despite concurrent writes, BSON types, indexes and validators', async t => {
  const f = await fixture(t);
  const manifest = await writeSnapshotBackup({ ...f, client, onCollection: async name => {
    if (name !== 'alpha') return;
    const writer = client.startSession();
    try { await writer.withTransaction(async () => {
      await f.db.collection('alpha').updateOne({}, { $set: { counter: 2 } }, { session: writer });
      await f.db.collection('beta').updateOne({}, { $set: { counter: 2 } }, { session: writer });
    }); } finally { await writer.endSession(); }
  } });
  assert.ok(manifest.snapshotTime);
  assert.equal((await f.db.collection('beta').findOne()).counter, 2);
  await verifyBackup(f.folder);
  const target = unique(); await restoreSnapshotBackup({ sourceDb: f.db, client, folder: f.folder, target });
  const restored = client.db(target);
  const alpha = await restored.collection('alpha').findOne({}, { promoteValues: false });
  assert.equal(Number(alpha.counter), 1);
  assert.equal(alpha.exactLong._bsontype, 'Long');
  assert.equal(alpha.exactLong.toString(), '7');
  assert.equal(alpha.when.toISOString(), '2026-01-01T00:00:00.123Z');
  assert.equal((await restored.collection('beta').findOne()).counter, 1);
  await assert.rejects(restored.collection('alpha').insertOne({ code: 'A', counter: 1 }), error => error.code === 11000);
  await assert.rejects(restored.collection('alpha').insertOne({ code: 'B', counter: 'invalid' }), error => error.code === 121);
});

test('schema drift or interrupted export cannot publish a completed manifest', async t => {
  const f = await fixture(t);
  await assert.rejects(writeSnapshotBackup({ ...f, client, onCollection: async name => {
    if (name === 'alpha') await f.db.collection('beta').createIndex({ counter: 1 });
  } }), /metadata changed/);
  assert.equal(fs.existsSync(path.join(f.folder, 'manifest.json')), false);
  const g = await fixture(t);
  await assert.rejects(writeSnapshotBackup({ ...g, client, onCollection: async () => { throw Error('export interrupted'); } }), /interrupted/);
  assert.equal(fs.existsSync(path.join(g.folder, 'manifest.json')), false);
});

test('corruption and unsafe manifest paths are rejected before creating target collections', async t => {
  const f = await fixture(t); await writeSnapshotBackup({ ...f, client });
  fs.appendFileSync(path.join(f.folder, 'beta.jsonl.gz'), 'damage');
  const target = unique();
  await assert.rejects(restoreSnapshotBackup({ sourceDb: f.db, client, folder: f.folder, target }), /checksum/);
  assert.deepEqual(await client.db(target).listCollections().toArray(), []);
  const g = await fixture(t); await writeSnapshotBackup({ ...g, client });
  const manifestPath = path.join(g.folder, 'manifest.json');
  const manifest = parseDocument(fs.readFileSync(manifestPath, 'utf8'));
  manifest.collections.alpha.file = '../escape.jsonl.gz';
  fs.writeFileSync(manifestPath, serializeDocument(manifest));
  await assert.rejects(verifyBackup(g.folder), /filename/);
});

test('restore refuses source and occupied targets without dropping or changing existing records', async t => {
  const f = await fixture(t); await writeSnapshotBackup({ ...f, client });
  await assert.rejects(restoreSnapshotBackup({ sourceDb: f.db, client, folder: f.folder, target: f.db.databaseName }), /separate/);
  const occupied = client.db(unique()); await occupied.collection('sentinel').insertOne({ keep: true });
  await assert.rejects(restoreSnapshotBackup({ sourceDb: f.db, client, folder: f.folder, target: occupied.databaseName }), /empty/);
  assert.equal((await occupied.collection('sentinel').findOne()).keep, true);
  await assert.rejects(restoreSnapshotBackup({ sourceDb: occupied, client, folder: f.folder, target: f.db.databaseName }), /backup source/);
});

test('older exports require explicit legacy consent and are never labeled snapshot-consistent', async t => {
  const f = await fixture(t); await writeSnapshotBackup({ ...f, client });
  const file = path.join(f.folder, 'manifest.json');
  const manifest = parseDocument(fs.readFileSync(file, 'utf8'));
  delete manifest.formatVersion; delete manifest.complete; delete manifest.consistency;
  for (const entry of Object.values(manifest.collections)) { delete entry.sha256; delete entry.file; }
  fs.writeFileSync(file, serializeDocument(manifest));
  await assert.rejects(verifyBackup(f.folder), /format-2/);
  const result = await restoreSnapshotBackup({ sourceDb: f.db, client, folder: f.folder, target: unique(), allowLegacy: true });
  assert.equal(result.consistency, 'legacy-unverified');
});

test('read-only recovery checks flag inconsistent attendance, overlapping time and orphaned relationships', async () => {
  const db = client.db(unique()); const id = () => new mongoose.Types.ObjectId();
  const employee = id(), project = id(), task = id(), log = id();
  await db.collection('employees').insertOne({ _id: employee });
  await db.collection('projects').insertOne({ _id: project });
  await db.collection('tasks').insertOne({ _id: task });
  const startedAt = new Date('2026-01-01T09:00Z'), stoppedAt = new Date('2026-01-01T10:00Z');
  await db.collection('task_time_logs').insertOne({ _id: log, employee, project, task, startedAt, stoppedAt, status: 'stopped', isActiveTimer: false });
  await db.collection('attendances').insertOne({ employee, date: '2026-01-01', source: 'timer', status: 'Present', checkIn: startedAt, checkOut: stoppedAt });
  assert.equal((await inspectRecovery(db)).reviewRequired, false);
  await db.collection('attendances').updateOne({}, { $set: { checkOut: null } });
  await db.collection('task_time_logs').insertOne({ employee, project, task: id(), startedAt, stoppedAt, status: 'stopped', isActiveTimer: false });
  await db.collection('time_entry_edits').insertOne({ timeLog: id() });
  const report = await inspectRecovery(db);
  assert.equal(report.attendanceMismatches, 1);
  assert.equal(report.overlappingIntervals, 1);
  assert.equal(report.missingTimeLogTask, 1);
  assert.equal(report.orphanCorrectionAudits, 1);
  assert.equal(report.reviewRequired, true);
});
