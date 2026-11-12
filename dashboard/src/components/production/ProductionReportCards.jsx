import { CalendarDays, FileText } from 'lucide-react';
import { productionReportCell } from '../../utils/productionExport';

export default function ProductionReportCards({ data, rows, offset }) {
  return <div className="prod-report-card-grid" aria-label="Production report cards">{rows.map((row, index) => {
    return <article className="prod-report-record" key={offset + index}>
      <header><span className="prod-report-record-icon">{data.columns[0]?.key === 'date' ? <CalendarDays size={18} /> : <FileText size={18} />}</span><h3>{productionReportCell(row[0], data.columns[0])}</h3></header>
      <dl>{data.columns.slice(1).map((col, columnIndex) => <div key={col.key} className={col.type === 'money' || col.key === 'productionSeconds' ? 'is-highlight' : undefined}><dt>{col.label.replace(/ \(h:mm:ss\)$/, '')}</dt><dd>{productionReportCell(row[columnIndex + 1], col)}</dd></div>)}</dl>
    </article>;
  })}</div>;
}
