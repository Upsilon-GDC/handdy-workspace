const SystemSettings = require('../models/SystemSettings');
// Missing/legacy documents already resolve to safe defaults. A GET does not
// initialize or touch updatedAt; only an administrator's save writes settings.
let settingsCache;
let settingsExpiresAt = 0;
let settingsGeneration = 0;
let settingsRead;
const getSettings = () => {
  if (settingsExpiresAt > Date.now()) return Promise.resolve(settingsCache);
  if (settingsRead?.generation === settingsGeneration) return settingsRead.promise;
  const generation = settingsGeneration;
  const promise = Promise.resolve(SystemSettings.findOne({ key: "global" })).then((settings) => {
    if (settingsGeneration === generation) {
      settingsCache = settings;
      settingsExpiresAt = Date.now() + 5_000;
    }
    return settings;
  }).finally(() => { if (settingsRead?.promise === promise) settingsRead = null; });
  settingsRead = { generation, promise };
  return promise;
};

function invalidateSettings() { settingsGeneration += 1; settingsExpiresAt = 0; }
module.exports = { getSettings, invalidateSettings };
