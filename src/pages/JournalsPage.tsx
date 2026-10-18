import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Voucher } from '@/db/schema'
import type { Paise } from '@/lib/money'
import type { JournalLine } from '@/engine/types'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { AccountSelect, MoneyInput, PartySelect, useMasters } from '@/components/pickers'
import { DataTable, type Column } from '@/components/DataTable'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { createManualJournal } from '@/services/ledger'
import { formatDate, todayISO } from '@/lib/format'
import { formatINR } from '@/lib/money'
import { newId } from '@/lib/id'

interface DraftLine {
  key: string
  accountId: string
  debit: Paise
  credit: Paise
  narration: string
}

function blankLine(): DraftLine {
  return { key: newId('line'), accountId: '', debit: 0, credit: 0, narration: '' }
}

/**
 * A hand-written journal. The engine validates the entry, so the form only has
 * to make balance visible: submit stays disabled until debits equal credits.
 */
export function JournalsPage() {
  const actor = useSession((state) => state.actor)
  const masters = useMasters()
  const task = useTask()

  const [date, setDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [partyId, setPartyId] = useState('')
  const [postNow, setPostNow] = useState(true)
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()])

  const postableAccounts = masters.accounts.filter((account) => !account.isControl)
  const parties = [...masters.customers, ...masters.suppliers]

  const debitTotal = lines.reduce((sum, line) => sum + line.debit, 0)
  const creditTotal = lines.reduce((sum, line) => sum + line.credit, 0)
  const balanced = debitTotal > 0 && debitTotal === creditTotal

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const addLine = () => setLines((prev) => [...prev, blankLine()])
  const removeLine = (key: string) =>
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((line) => line.key !== key)))

  function resetForm() {
    setDate(todayISO())
    setNarration('')
    setPartyId('')
    setPostNow(true)
    setLines([blankLine(), blankLine()])
  }

  function submit() {
    const journalLines: JournalLine[] = lines
      .filter((line) => line.accountId && (line.debit > 0 || line.credit > 0))
      .map((line) => ({
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        narration: line.narration.trim() || undefined,
      }))

    void task.run(async () => {
      await createManualJournal(actor(), {
        date,
        narration,
        lines: journalLines,
        partyId: partyId || null,
        postNow,
      })
      resetForm()
      task.setNotice(
        postNow ? 'Journal posted to the ledger.' : 'Journal saved as a draft for approval.',
      )
    })
  }

  const journalVouchers = useLiveQuery(
    () => db.vouchers.where('type').equals('JOURNAL').toArray(),
    [],
  )

  const rows = useMemo(
    () =>
      [...(journalVouchers ?? [])].sort((a, b) =>
        a.date === b.date ? b.number.localeCompare(a.number) : a.date < b.date ? 1 : -1,
      ),
    [journalVouchers],
  )

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Number', width: '140px' },
    { key: 'date', label: 'Date', width: '120px', render: (row) => formatDate(row.date) },
    { key: 'narration', label: 'Narration' },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  return (
    <>
      <PageHeader title="Journals" subtitle="Manual double-entry journals" />

      <Card title="New journal entry">
        <div className="space-y-3">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          {task.notice && <Alert tone="success">{task.notice}</Alert>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Party (optional)">
              <PartySelect value={partyId} onChange={setPartyId} parties={parties} />
            </Field>
            <Field label="Posting">
              <label className="flex items-center gap-2 pt-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={postNow}
                  onChange={(event) => setPostNow(event.target.checked)}
                />
                Post immediately
              </label>
            </Field>
          </div>

          <Field label="Narration" required>
            <Textarea
              value={narration}
              onChange={(event) => setNarration(event.target.value)}
              placeholder="What this journal records"
            />
          </Field>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="py-1.5">Account</th>
                  <th className="py-1.5 text-right">Debit</th>
                  <th className="py-1.5 text-right">Credit</th>
                  <th className="py-1.5">Line narration</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-2">
                      <AccountSelect
                        value={line.accountId}
                        onChange={(value) => setLine(line.key, { accountId: value })}
                        accounts={postableAccounts}
                      />
                    </td>
                    <td className="py-1.5 px-1">
                      <MoneyInput
                        value={line.debit}
                        onChange={(paise) => setLine(line.key, { debit: paise })}
                        className="w-28 text-right"
                      />
                    </td>
                    <td className="py-1.5 px-1">
                      <MoneyInput
                        value={line.credit}
                        onChange={(paise) => setLine(line.key, { credit: paise })}
                        className="w-28 text-right"
                      />
                    </td>
                    <td className="py-1.5 px-1">
                      <Input
                        value={line.narration}
                        onChange={(event) => setLine(line.key, { narration: event.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pl-1 text-right">
                      <Button
                        variant="ghost"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length <= 2}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-1.5 text-right">Totals</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{formatINR(debitTotal)}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{formatINR(creditTotal)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button onClick={addLine}>Add line</Button>
              {balanced ? (
                <Badge tone="green">Balanced</Badge>
              ) : (
                <Badge tone="amber">Not balanced</Badge>
              )}
            </div>
            <Button variant="primary" onClick={submit} disabled={!balanced || task.running}>
              {task.running ? 'Saving…' : 'Save journal'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Card title={`Journal vouchers (${rows.length})`} bodyClassName="p-0">
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={journalVouchers === undefined}
            empty="No journals recorded yet."
          />
        </Card>
      </div>
    </>
  )
}
