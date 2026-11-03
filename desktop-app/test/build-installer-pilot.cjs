const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('../package.json');
const projectDir = path.resolve(__dirname, '..');
async function main() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const output = path.resolve(projectDir, `../backend/.local-repairs/phase2-installer/${suffix}`);
  fs.mkdirSync(output, { recursive: true });
  const settings = { output, name: `CRM Phase2 Test ${suffix}`, nextVersion: pkg.version };
  const settingsPath = path.join(output, 'pilot-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  const versions = ['2.0.1', pkg.version];
  const installers = [];
  for (const version of versions) {
    const artifacts = await build({ projectDir, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never',
      config: {
        appId: `com.handdy.timetracker.phase2test.${suffix}`, productName: settings.name, executableName: 'CRMPhase2Pilot',
        extraMetadata: { name: `crm-phase2-test-${suffix}`, version, main: 'installed-pilot-main.cjs' },
        directories: { output: path.join(output, version) },
        files: [...pkg.build.files,
          { from: __dirname, to: '.', filter: ['installed-pilot-main.cjs'] },
          { from: output, to: '.', filter: ['pilot-settings.json'] }],
        nsis: { shortcutName: settings.name, runAfterFinish: false },
      } });
    const installer = artifacts.find(file => file.endsWith('.exe') && !file.includes('__uninstaller'));
    if (!installer) throw new Error('Pilot installer was not generated');
    installers.push(installer);
  }
  const manifest = { ...settings, versions, installers, installDirectory: path.join(output, 'installed'),
    productionInstaller: path.join(projectDir, `dist/CRM-${pkg.version}-Windows-x64.exe`) };
  const manifestPath = path.join(output, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const pointer = path.resolve(projectDir, '../artifacts/phase2-installer-manifest.txt');
  fs.writeFileSync(pointer, manifestPath);
  console.log(`Pilot manifest: ${manifestPath}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
