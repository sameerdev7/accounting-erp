import * as XLSX from 'xlsx'
import { toRupees } from '@/lib/money'
import type { ReportResult } from '@/reports/types'

/** Build a rectangular matrix (header + rows + totals) from a report. */
export function reportToMatrix(report: ReportResult): Array<Array<string | number>> {
  const header = report.columns.map((column) => column.label)
  const body = report.rows.map((row) => {
    const cells: Array<string | number> = []
    // The first column carries the indentation so exports stay readable.
    report.columns.forEach((column, index) => {
      const raw = row[column.key]
      if (column.money) {
        const value = Number(raw) || 0
        const cell = toRupees(value)
        cells.push(index === 0 && row.level ? `${'    '.repeat(row.level)}${cell}` : cell)
      } else if (typeof raw === 'number') {
        cells.push(raw)
      } else {
        const text = raw === undefined || raw === null ? '' : String(raw)
        cells.push(index === 0 && row.level ? `${'    '.repeat(row.level)}${text}` : text)
      }
    })
    return cells
  })

  const totalsRow =
    report.totals && Object.keys(report.totals).length > 0
      ? report.columns.map((column, index) => {
          if (index === 0) return 'Total'
          const value = report.totals?.[column.key]
          if (value === undefined) return ''
          return typeof value === 'number' ? value : String(value)
        })
      : []

  return [header, ...body, ...(totalsRow.length ? [totalsRow] : [])]
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function exportReportCSV(report: ReportResult): void {
  const matrix = reportToMatrix(report)
  const csv = matrix
    .map((cells) =>
      cells
        .map((cell) => {
          const text = String(cell ?? '')
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        })
        .join(','),
    )
    .join('\n')
  download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${safeName(report.title)}.csv`)
}

export function exportReportXLSX(report: ReportResult): void {
  const matrix = reportToMatrix(report)
  const sheet = XLSX.utils.aoa_to_sheet(matrix)
  sheet['!cols'] = report.columns.map(() => ({ wch: 18 }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, safeName(report.title).slice(0, 28) || 'Report')
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  download(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeName(report.title)}.xlsx`,
  )
}

/** Generic JSON download used by the backup screen. */
export function downloadJSON(data: unknown, filename: string): void {
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}
