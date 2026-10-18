import { formatINR } from '@/lib/money'
import { exportReportCSV, exportReportXLSX } from '@/lib/export'
import type { ReportResult, ReportRow } from '@/reports/types'
import { Button, Card, EmptyState, Spinner, StatCard } from './ui'

function cellValue(row: ReportRow, key: string, money: boolean): string {
  const raw = row[key]
  if (money) return formatINR(Number(raw) || 0)
  if (raw === undefined || raw === null || raw === '') return '—'
  return String(raw)
}

function rowClass(row: ReportRow): string {
  switch (row.emphasis) {
    case 'heading':
      return 'bg-slate-50 font-semibold text-slate-800'
    case 'section':
      return 'bg-slate-50/60 font-semibold text-slate-700'
    case 'subtotal':
      return 'border-t border-slate-200 font-semibold text-slate-800'
    case 'total':
      return 'border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900'
    default:
      return row.muted ? 'text-slate-400' : ''
  }
}

export function ReportView({
  report,
  loading = false,
  empty,
  actions,
}: {
  report: ReportResult | null
  loading?: boolean
  empty?: string
  /** Extra header actions (date pickers etc.) supplied by the page. */
  actions?: React.ReactNode
}) {
  if (loading) return <Spinner label="Running report…" />
  if (!report) return <EmptyState message={empty ?? 'Run the report to see results.'} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{report.title}</h1>
          {report.subtitle && <p className="mt-0.5 text-sm text-slate-500">{report.subtitle}</p>}
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {actions}
          <Button onClick={() => window.print()}>Print</Button>
          <Button onClick={() => exportReportCSV(report)}>CSV</Button>
          <Button onClick={() => exportReportXLSX(report)}>Excel</Button>
        </div>
      </div>

      {report.highlights && report.highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {report.highlights.map((highlight) => (
            <StatCard
              key={highlight.label}
              label={highlight.label}
              value={highlight.value}
              tone={
                highlight.tone === 'positive'
                  ? 'positive'
                  : highlight.tone === 'negative'
                    ? 'negative'
                    : 'default'
              }
            />
          ))}
        </div>
      )}

      {report.warnings && report.warnings.length > 0 && (
        <div className="space-y-1">
          {report.warnings.map((warning) => (
            <div
              key={warning}
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {warning}
            </div>
          ))}
        </div>
      )}

      <Card className="print-area" bodyClassName="">
        {report.rows.length === 0 ? (
          <EmptyState message="No data for the selected period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      className={`th ${
                        column.align === 'right'
                          ? 'text-right'
                          : column.align === 'center'
                            ? 'text-center'
                            : 'text-left'
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((row, index) => (
                  <tr key={row.id ?? index} className={rowClass(row)}>
                    {report.columns.map((column, columnIndex) => (
                      <td
                        key={column.key}
                        className={`px-3 py-1.5 text-sm ${
                          column.align === 'right'
                            ? 'text-right tabular-nums'
                            : column.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                        }`}
                        style={
                          columnIndex === 0 && row.level
                            ? { paddingLeft: `${row.level * 16 + 12}px` }
                            : undefined
                        }
                      >
                        {cellValue(row, column.key, Boolean(column.money))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {report.notes && report.notes.length > 0 && (
        <div className="space-y-1 text-xs text-slate-500">
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </div>
  )
}
