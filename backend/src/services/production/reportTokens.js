const crypto = require('node:crypto');
const { productionAccess, scopedEmployees } = require('./access');
const { getPermissionVersion, userHasPermission } = require('../permissionService');
const { fail } = require('./settingsValidation');
const secret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const digest = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
async function exportScope(user) {
  const access = await productionAccess(user), employees = await scopedEmployees(access);
  return digest({ actor: String(user._id), role: user.role, permissions: getPermissionVersion(user), employees: employees.map(row => String(row._id)).sort(),
    teams: access.teamIds?.slice().sort() || null, money: access.billingTeamIds?.slice().sort() || null });
}
const sign = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');
async function reportExportToken(user, data) {
  const canExport = userHasPermission(user, 'export_reports');
  const dataHash = digest(data);
  if (!canExport) return { canExport: false, dataHash };
  const payload = Buffer.from(JSON.stringify({ user: String(user._id), scope: await exportScope(user), dataHash, expires: Date.now() + 15 * 60000 })).toString('base64url');
  return { canExport: true, dataHash, exportToken: `${payload}.${sign(payload)}` };
}
async function authorizeReportExport(user, token, format) {
  if (!userHasPermission(user, 'export_reports')) throw fail('You do not have permission to export Production reports.', 403);
  if (!['excel', 'pdf'].includes(format) || typeof token !== 'string' || token.length > 2048) throw fail('Choose a valid report export.');
  const parts = token.split('.'), [payload, signature] = parts;
  const expected = sign(payload || '');
  if (parts.length !== 2 || !signature || !/^[A-Za-z0-9_-]+$/.test(signature) || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw fail('Report authorization is invalid. Refresh the report.', 403);
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw fail('Invalid report authorization.', 403); }
  if (decoded.user !== String(user._id) || !Number.isFinite(decoded.expires) || decoded.expires < Date.now()) throw fail('Report authorization expired. Refresh the report.', 403);
  if (decoded.scope !== await exportScope(user)) throw fail('Your Production access changed. Refresh the report before exporting.', 403);
  return { dataHash: decoded.dataHash, format };
}
module.exports = { reportExportToken, authorizeReportExport, digest };
