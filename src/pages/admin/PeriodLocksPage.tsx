import { useMemo, useState } from 'react'
import type { PeriodLock } from '@/db/schema'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { listPeriodLocks, lockPeriod, unlockPeriod } from '@/services/admin'
import { describePeriodLock } from '@/services/controls'
import { currentFinancialYear, monthKey, monthsInFinancialYear } from '@/lib/dates'
import { formatDateTime, formatMonthKey, todayISO } from '@/lib/format'

/**
 * Closing a month (or a whole financial year) to further postings. The lock is
 * enforced in the ledger service, so this screen only manages the records.
 */
export function PeriodLocksPage() {
  const actor = useSession((state) => state.actor)
  const locks = useAsync(() => listPeriodLocks(), [])
  const task = useTask()

  const fy = currentFinancialYear()
  const months = useMemo(() => monthsInFinancialYear(fy), [fy])

  const [type, setType] = useState<'MONTH' | 'FY'>('MONTH')
  const [month, setMonth] = useState(monthKey(todayISO()))
  const [note, setNote] = useState('')

  const period = type === 'FY' ? fy.key : month

  function submit() {
    void task.run(async () => {
      await lockPeriod(actor(), { period, type, note })
      setNote('')
      locks.reload()
    })
  }

  function unlock(lock: PeriodLock) {
    void task.run(async () => {
      await unlockPeriod(actor(), lock.id)
      locks.reload()
    })
  }

  const columns: Array<Column<PeriodLock>> = [
    { key: 'period', label: 'Period', render: (row) => describePeriodLock(row) },
    { key: 'type', label: 'Type' },
    { key: 'note', label: 'Note', render: (row) => row.note || '—' },
    { key: 'createdAt', label: 'Locked at', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (row) => (
        <Button
          className="px-2 py-1 text-xs"
          variant="danger"
          onClick={() => unlock(row)}
          disabled={task.running}
        >
          Re-open
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Period locks"
        subtitle="Prevent postings into closed periods so reported figures cannot be restated"
      />

      <Card title="Lock a period">
        <div className="space-y-3">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Lock type">
              <Select
                value={type}
                onChange={(event) => setType(event.target.value as 'MONTH' | 'FY')}
              >
                <option value="MONTH">A single month</option>
                <option value="FY">A full financial year</option>
              </Select>
            </Field>
            {type === 'MONTH' ? (
              <Field label="Month">
                <Select value={month} onChange={(event) => setMonth(event.target.value)}>
                  {months.map((key) => (
                    <option key={key} value={key}>
                      {formatMonthKey(key)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Financial year">
                <Select value={fy.key} disabled>
                  <option value={fy.key}>{fy.label}</option>
                </Select>
              </Field>
            )}
            <Field label="Note">
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Reason for the lock"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={submit} disabled={task.running}>
              {task.running ? 'Locking…' : 'Lock period'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Card title={`Locked periods (${locks.data?.length ?? 0})`} bodyClassName="p-0">
          <DataTable
            columns={columns}
            rows={locks.data ?? []}
            getRowId={(row) => row.id}
            loading={locks.loading}
            empty="No periods are locked."
          />
        </Card>
      </div>
    </>
  )
}
