const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export { MIME_XLSX, safeFilePart, downloadBlob };

const safeFilePart = (value) =>
  String(value || "report")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "report";

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const fitColumnWidths = (worksheet, rows, columnCount) => {
  worksheet.columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const longest = rows.reduce(
      (width, row) => Math.max(width, String(row[columnIndex] ?? "").length),
      0,
    );
    return { width: Math.min(38, Math.max(12, longest + 3)) };
  });
};

export async function exportReportExcel({
  title,
  fromDate,
  toDate,
  columns,
  rows,
  summary = [],
}) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Employee Workspace";
  workbook.created = new Date();

  const sheetName = title.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Report";
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 6 }],
  });

  worksheet.addRow([title]);
  worksheet.mergeCells(1, 1, 1, columns.length);
  worksheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF173E32" } };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 30;

  worksheet.addRow(["Period", `${fromDate} to ${toDate}`]);
  worksheet.addRow(["Generated", new Date().toLocaleString()]);
  worksheet.addRow(summary.flatMap(({ label, value }) => [label, value]));
  worksheet.addRow([]);

  const headerRow = worksheet.addRow(columns);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 23;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176A4D" } };
  });

  rows.forEach((row) => worksheet.addRow(row));
  const lastRow = 6 + rows.length;
  worksheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: lastRow, column: columns.length } };
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 6 && rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F7F5" } };
      });
    }
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });
  fitColumnWidths(worksheet, [columns, ...rows], columns.length);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${safeFilePart(title)}-${fromDate}-${toDate}.xlsx`;
  downloadBlob(new Blob([buffer], { type: MIME_XLSX }), fileName);
}

export async function exportReportPdf({
  title,
  fromDate,
  toDate,
  columns,
  rows,
  summary = [],
}) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default || autoTableModule.autoTable;
  const landscape = columns.length > 6;
  const document = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();

  document.setTextColor(23, 62, 50);
  document.setFont("helvetica", "bold");
  document.setFontSize(18);
  document.text(title, 40, 44);
  document.setFont("helvetica", "normal");
  document.setTextColor(93, 107, 101);
  document.setFontSize(9);
  document.text(`Period: ${fromDate} to ${toDate}`, 40, 62);
  document.text(`Generated: ${new Date().toLocaleString()}`, 40, 76);

  if (summary.length) {
    const summaryText = summary.map(({ label, value }) => `${label}: ${value}`).join("   |   ");
    document.text(summaryText, 40, 92, { maxWidth: pageWidth - 80 });
  }

  autoTable(document, {
    startY: summary.length ? 108 : 92,
    head: [columns],
    body: rows,
    margin: { top: 42, right: 40, bottom: 38, left: 40 },
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: columns.length > 6 ? 7 : 8,
      cellPadding: 5,
      overflow: "linebreak",
      valign: "middle",
      lineColor: [221, 229, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [23, 106, 77],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [246, 249, 247] },
    didDrawPage: () => {
      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      document.setTextColor(115, 128, 122);
      document.text(
        `Page ${document.getNumberOfPages()}`,
        pageWidth - 40,
        pageHeight - 18,
        { align: "right" },
      );
    },
  });

  document.save(`${safeFilePart(title)}-${fromDate}-${toDate}.pdf`);
}
