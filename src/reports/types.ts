/**
 * Every report in the application returns a `ReportResult`. Screens render it
 * generically and the export functions turn it into CSV/XLSX, so a new report
 * is a pure function plus nothing else.
 */

export interface ReportColumn {
  /** Key into each row object */
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Render with the rupee formatter */
  money?: boolean
  /** Decimal places for non-money numeric columns */
  decimals?: number
  /** Numeric column that contributes to the totals row */
  total?: boolean
}

export type RowEmphasis = 'heading' | 'subtotal' | 'total' | 'section'

export interface ReportRow {
  /** Stable React key; falls back to the array index */
  id?: string
  /** Indentation level for hierarchical reports (P&L, Balance Sheet) */
  level?: number
  /** Styling hint */
  emphasis?: RowEmphasis
  /** De-emphasise (e.g. contra accounts, memo lines) */
  muted?: boolean
  /** Optional per-row drill-down: the account this row came from */
  accountId?: string
  [key: string]: unknown
}

export interface ReportHighlight {
  label: string
  value: string
  tone?: 'default' | 'positive' | 'negative'
}

export interface ReportResult {
  title: string
  subtitle?: string
  columns: ReportColumn[]
  rows: ReportRow[]
  /** Rendered as a bold summary bar */
  totals?: Record<string, string | number>
  /** Footnote paragraphs, e.g. accounting policy notes */
  notes?: string[]
  /** Headline figures shown above the table */
  highlights?: ReportHighlight[]
  /** Anything the report could not compute — surfaced to the user */
  warnings?: string[]
}

export const EMPTY_REPORT: ReportResult = {
  title: 'No report',
  columns: [],
  rows: [],
}

/** Money column shorthand. */
export function moneyColumn(key: string, label: string, total = false): ReportColumn {
  return { key, label, align: 'right', money: true, total }
}

export function textColumn(key: string, label: string): ReportColumn {
  return { key, label, align: 'left' }
}

export function numberColumn(key: string, label: string, decimals = 2): ReportColumn {
  return { key, label, align: 'right', decimals }
}
