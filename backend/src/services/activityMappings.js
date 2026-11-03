const ActivityMapping = require('../models/ActivityMapping');

async function ensureActivityMappingIndexes() {
  // Explicit initialization: no model import can modify the database.
  await ActivityMapping.createCollection();
  await ActivityMapping.createIndexes();
}

module.exports = { ensureActivityMappingIndexes };
