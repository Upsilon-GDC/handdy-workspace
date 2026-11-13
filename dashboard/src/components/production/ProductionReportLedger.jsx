import { productionReportCell } from '../../utils/productionExport';

export default function ProductionReportLedger({ data, rows, offset }) {
  return <div className="prod-report-ledger" aria-label="Production report data">{rows.map((row, index) => <section className="prod-ledger-record" key={offset + index}>
    <h3><span>{data.columns[0]?.label}</span>{productionReportCell(row[0], data.columns[0])}</h3>
    <dl>{data.columns.slice(1).map((col, columnIndex) => <div key={col.key} className={col.type === 'money' || col.key === 'productionSeconds' ? 'is-highlight' : undefined}><dt>{col.label.replace(/ \(h:mm:ss\)$/, '')}</dt><dd>{productionReportCell(row[columnIndex + 1], col)}</dd></div>)}</dl>
  </section>)}</div>;
}
