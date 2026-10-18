import type { ReactNode } from 'react'
import { formatINR } from '@/lib/money'
import { EmptyState, Spinner } from './ui'

export interface Column<T> {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  /** Render with the rupee formatter. */
  money?: boolean
  /** Raw numeric total for the footer (sums the column). */
  total?: boolean
  width?: string
  className?: string
  /** Custom cell renderer; wins over `money`. */
  render?: (row: T, index: number) => ReactNode
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  getRowId?: (row: T, index: number) => string
  loading?: boolean
  empty?: string
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  /** Label shown in the footer's first cell, e.g. 'Total'. */
  totalLabel?: string
  dense?: boolean
  footer?: ReactNode
}

function alignClass(align: Column<unknown>['align']): string {
  if (align === 'right') return 'text-right tabular-nums'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  empty = 'Nothing to show.',
  onRowClick,
  rowClassName,
  totalLabel = 'Total',
  dense = false,
  footer,
}: DataTableProps<T>) {
  if (loading) return <Spinner />
  if (rows.length === 0) return <EmptyState message={empty} />

  const totalColumns = columns.filter((column) => column.total)
  const pad = dense ? 'px-3 py-1.5' : 'px-3 py-2'

  const cell = (row: T, key: string): unknown => (row as Record<string, unknown>)[key]
  const totalFor = (column: Column<T>): number =>
    rows.reduce((sum, row) => sum + (Number(cell(row, column.key)) || 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-800/50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`th ${alignClass(column.align)} ${column.className ?? ''}`}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-transparent">
          {rows.map((row, index) => (
            <tr
              key={getRowId ? getRowId(row, index) : ((cell(row, 'id') as string) ?? index)}
              className={`${onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''} ${
                rowClassName?.(row) ?? ''
              }`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${pad} text-slate-700 dark:text-slate-300 ${alignClass(column.align)} ${column.className ?? ''}`}
                >
                  {column.render
                    ? column.render(row, index)
                    : column.money
                      ? formatINR(Number(cell(row, column.key)) || 0)
                      : ((cell(row, column.key) as ReactNode) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalColumns.length > 0 && (
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800/50">
            <tr>
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={`${pad} ${alignClass(column.align)} text-slate-800 dark:text-slate-100`}
                >
                  {index === 0
                    ? totalLabel
                    : column.total
                      ? formatINR(totalFor(column))
                      : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {footer}
    </div>
  )
}
