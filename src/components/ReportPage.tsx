import { useState } from 'react'
import { currentFinancialYear } from '@/lib/dates'
import { todayISO } from '@/lib/format'
import type { ReportResult } from '@/reports/types'
import { useAsync } from '@/hooks/async'
import { ReportView } from './ReportView'
import { Input } from './ui'

export type ReportMode = 'range' | 'asOn' | 'none'

/**
 * A report screen is a pure function plus this shell: pick a period, run, and
 * render generically. Every report in the app is expressed this way, so adding
 * one never means writing a bespoke screen.
 */
export function ReportPage({
  run,
  mode = 'range',
  defaultFrom,
  defaultTo,
}: {
  run: (args: { from: string; to: string }) => Promise<ReportResult>
  mode?: ReportMode
  defaultFrom?: string
  defaultTo?: string
}) {
  const fy = currentFinancialYear()
  const [from, setFrom] = useState(defaultFrom ?? fy.start)
  const [to, setTo] = useState(defaultTo ?? todayISO())

  const { data, loading, error } = useAsync(() => run({ from, to }), [from, to, mode])

  const controls =
    mode === 'none' ? undefined : (
      <div className="flex flex-wrap items-end gap-2">
        {mode === 'range' && (
          <label className="text-xs text-slate-500 dark:text-slate-400">
            From
            <Input type="date" className="mt-1" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
        )}
        <label className="text-xs text-slate-500 dark:text-slate-400">
          {mode === 'asOn' ? 'As on' : 'To'}
          <Input type="date" className="mt-1" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
    )

  if (error) {
    return (
      <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
        Could not run the report: {error}
      </div>
    )
  }

  return (
    <ReportView report={data} loading={loading} actions={controls} empty="Run the report to see results." />
  )
}
