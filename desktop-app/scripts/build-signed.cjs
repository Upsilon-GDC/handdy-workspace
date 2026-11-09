const path = require('node:path');

function signingConfiguration(env = process.env) {
  const publisher = String(env.CRM_PUBLISHER_NAME || '').trim();
  if (!publisher) throw Error('Set CRM_PUBLISHER_NAME to the exact name on the publisher certificate.');
  if (!env.CSC_LINK || env.CSC_KEY_PASSWORD === undefined) throw Error('Set CSC_LINK and CSC_KEY_PASSWORD in the build environment; never commit signing credentials.');
  return { forceCodeSigning: true, win: { verifyUpdateCodeSignature: true,
    signtoolOptions: { publisherName: [publisher], signingHashAlgorithms: ['sha256'] } } };
}

async function main() {
  const config = signingConfiguration();
  const { build, Platform, Arch } = require('electron-builder');
  await build({ projectDir: path.resolve(__dirname, '..'), targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config, publish: 'never' });
}
if (require.main === module) main().catch(error => { console.error(`Signed build failed: ${error.message}`); process.exitCode = 1; });
module.exports = { signingConfiguration };
