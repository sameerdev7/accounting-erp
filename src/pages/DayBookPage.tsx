import { useState } from 'react'
import { useAsync } from '@/hooks/async'
import { Button, Field, PageHeader } from '@/components/ui'
import { ReportView } from '@/components/ReportView'
import { bankBook, cashBook, dayBook, type ReportResult } from '@/reports'
import { currentFinancialYear } from '@/lib/dates'
import { todayISO } from '@/lib/format'

type BookMode = 'DAY' | 'CASH' | 'BANK'

const RUNNERS: Record<BookMode, (opts: { from: string; to: string }) => Promise<ReportResult>> = {
  DAY: dayBook,
  CASH: cashBook,
  BANK: bankBook,
}

const BOOKS: Array<{ mode: BookMode; label: string }> = [
  { mode: 'DAY', label: 'Day Book' },
  { mode: 'CASH', label: 'Cash Book' },
  { mode: 'BANK', label: 'Bank Book' },
]

/**
 * The day book, cash book and bank book are the same period filter over three
 * different report runners, so the screen is a toggle plus a date range.
 */
export function DayBookPage() {
  const fy = currentFinancialYear()
  const [mode, setMode] = useState<BookMode>('DAY')
  const [from, setFrom] = useState(fy.start)
  const [to, setTo] = useState(todayISO())

  const { data, loading } = useAsync(() => RUNNERS[mode]({ from, to }), [mode, from, to])

  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex items-center gap-1">
        {BOOKS.map((book) => (
          <Button
            key={book.mode}
            variant={mode === book.mode ? 'primary' : 'secondary'}
            onClick={() => setMode(book.mode)}
          >
            {book.label}
          </Button>
        ))}
      </div>
      <Field label="From">
        <input
          type="date"
          className="input"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          className="input"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </Field>
    </div>
  )

  return (
    <>
      <PageHeader title="Day Book" subtitle="Voucher-by-voucher view of the books" />
      <ReportView
        report={data}
        loading={loading}
        actions={controls}
        empty="No movement for the selected period."
      />
    </>
  )
}
