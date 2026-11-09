// Read-only checks against a restored database. Findings require review;
// historical orphans/overlaps are not silently repaired or called data loss.
async function inspectRecovery(db, timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata') {
  const count = async (name, stages) => (await db.collection(name).aggregate([...stages, { $count: 'count' }]).toArray())[0]?.count || 0;
  const match = { 'manualEntry.deletedAt': null };
  const checks = {};
  checks.duplicateActiveTimers = await count('task_time_logs', [
    { $match: { isActiveTimer: true } }, { $group: { _id: '$employee', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } },
  ]);
  checks.invalidTimerIntervals = await count('task_time_logs', [{ $match: { $or: [
    { status: 'stopped', stoppedAt: null }, { isActiveTimer: true, stoppedAt: { $ne: null } },
    { $expr: { $lt: ['$stoppedAt', '$startedAt'] }, stoppedAt: { $type: 'date' } },
  ] } }]);
  checks.overlappingIntervals = await count('task_time_logs', [
    { $match: match }, { $setWindowFields: { partitionBy: '$employee', sortBy: { startedAt: 1 }, output: {
      previousEnd: { $max: { $ifNull: ['$stoppedAt', new Date('9999-01-01')] }, window: { documents: ['unbounded', -1] } },
    } } }, { $match: { $expr: { $and: [{ $ne: ['$previousEnd', null] }, { $lt: ['$startedAt', '$previousEnd'] }] } } },
  ]);
  for (const [field, foreign] of [['employee', 'employees'], ['project', 'projects'], ['task', 'tasks']]) {
    checks[`missingTimeLog${field[0].toUpperCase() + field.slice(1)}`] = await count('task_time_logs', [
      { $lookup: { from: foreign, localField: field, foreignField: '_id', as: 'reference' } }, { $match: { reference: { $size: 0 } } },
    ]);
  }
  checks.orphanCorrectionAudits = await count('time_entry_edits', [
    { $lookup: { from: 'task_time_logs', localField: 'timeLog', foreignField: '_id', as: 'reference' } }, { $match: { reference: { $size: 0 } } },
  ]);
  checks.attendanceMismatches = await count('task_time_logs', [
    { $match: match }, { $group: { _id: { employee: '$employee', date: { $dateToString: { date: '$startedAt', format: '%Y-%m-%d', timezone } } },
      first: { $min: '$startedAt' }, last: { $max: '$stoppedAt' }, open: { $max: { $cond: [{ $or: [{ $ne: ['$status', 'stopped'] }, { $eq: ['$stoppedAt', null] }] }, 1, 0] } } } },
    { $lookup: { from: 'attendances', let: { employee: '$_id.employee', date: '$_id.date' }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$employee', '$$employee'] }, { $eq: ['$date', '$$date'] }] } } },
    ], as: 'attendance' } },
    { $set: { day: { $arrayElemAt: ['$attendance', 0] }, expectedEnd: { $cond: ['$open', null, '$last'] } } },
    { $match: { $expr: { $or: [{ $ne: [{ $size: '$attendance' }, 1] }, { $ne: ['$day.source', 'timer'] },
      { $ne: ['$day.status', 'Present'] }, { $ne: ['$day.checkIn', '$first'] }, { $ne: ['$day.checkOut', '$expectedEnd'] }] } } },
  ]);
  return { ...checks, reviewRequired: Object.values(checks).some(value => value > 0) };
}
module.exports = { inspectRecovery };

if (require.main === module) {
  (async () => {
    require('dotenv').config();
    const mongoose = require('mongoose');
    const { argument } = require('./backupTools');
    const target = argument('--db');
    if (!/^[A-Za-z0-9_-]+$/.test(target)) throw Error('--db must name a separate recovery database.');
    try {
      await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false });
      if (['admin', 'local', 'config', mongoose.connection.db.databaseName.toLowerCase()].includes(target.toLowerCase())) throw Error('Refusing recovery verification against the configured source/system database.');
      const db = mongoose.connection.getClient().db(target);
      if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) throw Error('Recovery database has no collections.');
      const report = await inspectRecovery(db);
      console.log(JSON.stringify(report));
      if (report.reviewRequired) process.exitCode = 1;
    } finally { await mongoose.disconnect(); }
  })().catch(error => { console.error(`Recovery verification failed: ${error.message}`); process.exitCode = 1; });
}
