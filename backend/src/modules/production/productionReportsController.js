const { productionReport } = require('../../services/production/reportsService');
const { authorizeReportExport } = require('../../services/production/reportTokens');
function errorResponse(res, error) {
  return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to prepare the Production report.' });
}
async function read(req, res) {
  try { return res.json({ success: true, ...await productionReport(req.user, req.query) }); }
  catch (error) { return errorResponse(res, error); }
}
async function authorize(req, res) {
  try { return res.json({ success: true, ...await authorizeReportExport(req.user, req.body?.token, req.body?.format) }); }
  catch (error) { return errorResponse(res, error); }
}
module.exports = { read, authorize };
