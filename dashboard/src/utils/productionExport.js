import { downloadBlob, safeFilePart, MIME_XLSX } from './reportExport.js';
import { productionWarnings } from './production.js';
import { billingProjectTable } from './billingReviewGroups.js';

const digits = currency => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
export function productionReportCell(value, column) {
  if (value == null) return column.type === 'money' ? 'Missing Rate' : 'Not applicable';
  if (typeof value !== 'number') return String(value);
  if (column.type === 'duration') {
    const ms = Math.round(value * 1000), seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${ms % 1000 ? `.${String(ms % 1000).padStart(3, '0')}` : ''}`;
  }
  if (column.type === 'percent') return `${value.toFixed(2)}%`;
  if (column.type === 'money') return `${column.currency} ${value.toLocaleString('en-US', { minimumFractionDigits: digits(column.currency), maximumFractionDigits: digits(column.currency) })}`;
  return value.toLocaleString('en-US');
}
export async function reportDataHash(data) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const filename = data => {
  const selection = ['team', 'employee'].filter(key => data.filters?.[key] && data.filters[key] !== 'all').map(key => data.selection?.[key] || key).join('-');
  return `${safeFilePart(data.title)}-${safeFilePart(data.basis)}${selection ? `-${safeFilePart(selection).slice(0, 40)}` : ''}-${data.period.startDate}-${data.period.endDate}`;
};
function excelCell(cell, value, col) {
  cell.value = value == null ? productionReportCell(value, col) : value;
  if (typeof value !== 'number') return;
  if (col.type === 'duration') { cell.value = value / 86400; cell.numFmt = Number.isInteger(value) ? '[h]:mm:ss' : '[h]:mm:ss.000'; }
  else if (col.type === 'percent') { cell.value = value / 100; cell.numFmt = '0.00%'; }
  else if (col.type === 'money') { const decimal = digits(col.currency); cell.numFmt = `"${col.currency} "#,##0${decimal ? `.${'0'.repeat(decimal)}` : ''};[Red]("${col.currency} "#,##0${decimal ? `.${'0'.repeat(decimal)}` : ''})`; }
  else cell.numFmt = '#,##0.########';
}
export async function exportProductionExcel(data) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'CRM'; workbook.created = new Date(data.asOf);
  const summary = workbook.addWorksheet('Summary'); summary.columns = [{ width: 42 }, { width: 34 }, { width: 24 }, { width: 24 }];
  summary.mergeCells('A1:D1'); summary.getCell('A1').value = data.title; summary.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2853DC' } }; summary.getRow(1).height = 34;
  const metadata = [data.basisLabel, `${data.period.startDate} to ${data.period.endDate} (${data.period.timezone})`, `As of ${data.asOf}`, `${data.rows.length} report rows`];
  metadata.forEach((text, index) => { summary.mergeCells(index + 2, 1, index + 2, 4); summary.getCell(index + 2, 1).value = text; });
  summary.addRow([]); summary.addRow(['Metric', 'Value']); summary.getRow(7).font = { bold: true };
  data.summary.forEach(metric => { const row = summary.addRow([metric.label]); excelCell(row.getCell(2), metric.value, metric); });
  const noteStart = summary.rowCount + 2;
  const notes = [...Object.entries(data.selection || {}).map(([key, value]) => `${key[0].toUpperCase()}${key.slice(1)}: ${value}`), ...data.notes,
    ...data.warnings.map(row => `${productionWarnings[row.code] || row.code} (${row.count})`)];
  notes.forEach((text, index) => { const row = noteStart + index; summary.mergeCells(row, 1, row, 4); summary.getCell(row, 1).value = text; summary.getRow(row).height = Math.max(24, Math.ceil(text.length / 105) * 16); });
  const sheet = workbook.addWorksheet('Report data', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = data.columns.map(col => ({ width: col.type === 'text' ? /reason|client|project|task|employee/i.test(col.label) ? 29 : 22 : 20 }));
  sheet.addRow(data.columns.map(col => col.label)); sheet.getRow(1).height = 34;
  sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2853DC' } }; });
  data.rows.forEach((values, index) => {
    const row = sheet.addRow([]);
    values.forEach((value, columnIndex) => { const cell = row.getCell(columnIndex + 1); excelCell(cell, value, data.columns[columnIndex]);
      if (index % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FC' } }; });
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.rows.length + 1, column: data.columns.length } };
  for (const worksheet of [summary, sheet]) worksheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
  if (data.employeeSummary) {
    const employees = workbook.addWorksheet('Employee review', { views: [{ state: 'frozen', ySplit: 1 }] });
    employees.columns = data.employeeSummary.columns.map(col => ({ width: col.key === 'issues' ? 52 : 26 }));
    employees.addRow(data.employeeSummary.columns.map(col => col.label));
    employees.getRow(1).height = 32;
    employees.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2853DC' } }; });
    data.employeeSummary.rows.forEach(values => {
      const row = employees.addRow([]);
      values.forEach((value, index) => excelCell(row.getCell(index + 1), value, data.employeeSummary.columns[index]));
    });
    employees.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.employeeSummary.rows.length + 1, column: data.employeeSummary.columns.length } };
    employees.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
  }
  if (data.workDetails) {
    const projectData = billingProjectTable(data.workDetails);
    const projects = workbook.addWorksheet('Project summary', { views: [{ state: 'frozen', ySplit: 1 }] });
    projects.columns = projectData.columns.map(() => ({ width: 26 }));
    projects.addRow(projectData.columns.map(col => col.label));
    projects.getRow(1).font = { bold: true };
    projectData.rows.forEach(values => { const row = projects.addRow([]); values.forEach((value, index) => excelCell(row.getCell(index + 1), value, projectData.columns[index])); });
    projects.autoFilter = { from: { row: 1, column: 1 }, to: { row: projectData.rows.length + 1, column: projectData.columns.length } };
    projects.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: MIME_XLSX }), `${filename(data)}.xlsx`);
}
export async function exportProductionPdf(data) {
  if (data.rows.length > 1000) throw new Error('PDF exports support up to 1000 rows. Narrow the report or use Excel.');
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
  const text = value => String(value).replace(/[\u2010-\u2015]/g, '-').replace(/\u2192/g, 'to').replace(/\u2019/g, "'");
  const header = subtitle => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(25, 42, 73); doc.text(text(data.title), 36, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 105, 127);
    doc.text(text(`${data.basisLabel} | ${data.period.startDate} to ${data.period.endDate} | ${data.period.timezone}`), 36, 51);
    doc.text(text(subtitle), 36, 66);
  };
  const style = { theme: 'grid', margin: { top: 82, left: 36, right: 36, bottom: 34 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, overflow: 'linebreak', lineColor: [223, 229, 239], lineWidth: 0.4 },
    headStyles: { fillColor: [40, 83, 220], textColor: 255 }, alternateRowStyles: { fillColor: [247, 249, 253] } };
  header(`Summary - as of ${data.asOf}`);
  const metrics = [];
  for (let index = 0; index < data.summary.length; index += 2) {
    const a = data.summary[index], b = data.summary[index + 1];
    metrics.push([text(a.label), text(productionReportCell(a.value, a)), b ? text(b.label) : '', b ? text(productionReportCell(b.value, b)) : '']);
  }
  autoTable(doc, { ...style, startY: 80, head: [['Metric', 'Value', 'Metric', 'Value']], body: metrics,
    didDrawPage: () => header(`Summary - as of ${data.asOf}`) });
  const notes = [...Object.entries(data.selection || {}).map(([key, value]) => `${key}: ${value}`), ...data.notes,
    ...data.warnings.map(row => `${productionWarnings[row.code] || row.code} (${row.count})`)];
  autoTable(doc, { ...style, startY: doc.lastAutoTable.finalY + 15, showHead: false, body: notes.map(note => [text(note)]),
    styles: { ...style.styles, fontSize: 8, cellPadding: 4 }, didDrawPage: () => header(`Summary - as of ${data.asOf}`) });
  // Repeat identifying columns in each horizontal panel instead of shrinking
  // a wide report to unreadable text or dropping columns.
  const firstMetric = data.columns.findIndex(col => col.type !== 'text');
  const identityCount = Math.min(Math.max(firstMetric, 1), 3), identities = data.columns.slice(0, identityCount);
  const remaining = data.columns.slice(identityCount), panels = [];
  for (let index = 0; index < remaining.length; index += 6) panels.push([...identities, ...remaining.slice(index, index + 6)]);
  if (!panels.length) panels.push(identities);
  panels.forEach((columns, panelIndex) => {
    doc.addPage();
    const subtitle = `Report data - section ${panelIndex + 1} of ${panels.length} - ${data.rows.length} rows`;
    header(subtitle);
    const indexes = columns.map(col => data.columns.indexOf(col));
    autoTable(doc, { ...style, startY: 80, head: [['Row', ...columns.map(col => text(col.label))]],
      body: data.rows.map((row, rowIndex) => [String(rowIndex + 1), ...indexes.map((index, position) => text(productionReportCell(row[index], columns[position])))]), didDrawPage: () => header(subtitle) });
  });
  for (let page = 1; page <= doc.getNumberOfPages(); page++) { doc.setPage(page); doc.setFontSize(8); doc.setTextColor(110, 123, 145); doc.text(`Page ${page} of ${doc.getNumberOfPages()}`, width - 36, height - 16, { align: 'right' }); }
  doc.save(`${filename(data)}.pdf`);
}
