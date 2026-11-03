// Main-process only. Never registers the development Electron executable.
function configureLaunchAtLogin({ app, platform = process.platform, executable = process.execPath, logger = console }) {
  if (!app.isPackaged || platform !== 'win32' || typeof app.setLoginItemSettings !== 'function') return false;
  try {
    app.setLoginItemSettings({ openAtLogin: true, path: executable, args: [] });
    return true;
  } catch (error) {
    logger.warn(`[startup] Unable to register CRM at Windows sign-in: ${error.message}`);
    return false;
  }
}
module.exports = { configureLaunchAtLogin };
