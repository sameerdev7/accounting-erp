import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LedgerEntry, type Voucher } from '@/db/schema'
import { PAYMENT_MODES, createExpense, type PaymentMode } from '@/services/cashbank'
import { entriesForVoucher } from '@/services/ledger'
import { useTask } from '@/hooks/async'
import { useAccountMap, useMasters, AccountSelect, DateInput, MoneyInput } from '@/components/pickers'
import { DataTable, type Column } from '@/components/DataTable'
import { VoucherPrint } from '@/components/VoucherPrint'
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { useSession } from '@/store/session'

/**
 * Revenue expenses paid from cash or bank, optionally withholding TDS at
 * source. `createExpense` posts a PAYMENT voucher tagged refDocType 'EXPENSE'.
 */
export function ExpensesPage() {
  const actor = useSession((state) => state.actor)
  const { accounts } = useMasters()
  const accountsById = useAccountMap()
  const company = useLiveQuery(() => db.company.get('company'), [])

  const expenses = useLiveQuery(async () => {
    const rows = await db.vouchers.where('type').equals('PAYMENT').toArray()
    return rows
      .filter((row) => row.refDocType === 'EXPENSE')
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
  }, [])

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'EXPENSE'),
    [accounts],
  )

  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [amount, setAmount] = useState<Paise>(0)
  const [tdsAmount, setTdsAmount] = useState<Paise>(0)
  const [mode, setMode] = useState<PaymentMode>('BANK')
  const [reference, setReference] = useState('')
  const [narration, setNarration] = useState('')
  const [requireApproval, setRequireApproval] = useState(false)
  const task = useTask()

  const [printing, setPrinting] = useState<Voucher | null>(null)
  const [printEntries, setPrintEntries] = useState<LedgerEntry[]>([])

  function resetForm() {
    setOpen(false)
    setDate(todayISO())
    setExpenseAccountId('')
    setAmount(0)
    setTdsAmount(0)
    setMode('BANK')
    setReference('')
    setNarration('')
    setRequireApproval(false)
    task.reset()
  }

  async function submit() {
    if (!expenseAccountId) {
      task.setError('Select an expense account.')
      return
    }
    if (!narration.trim()) {
      task.setError('Enter a narration describing the expense.')
      return
    }
    if (amount <= 0) {
      task.setError('Enter an expense amount greater than zero.')
      return
    }
    if (tdsAmount < 0 || tdsAmount > amount) {
      task.setError('TDS cannot be negative or exceed the expense amount.')
      return
    }

    await task.run(async () => {
      await createExpense(actor(), {
        date,
        expenseAccountId,
        amount,
        tdsAmount,
        mode,
        reference,
        narration,
        requireApproval,
      })
      resetForm()
    })
  }

  function showPrint(voucher: Voucher) {
    setPrinting(voucher)
    void entriesForVoucher(voucher.id).then(setPrintEntries)
  }

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Voucher No' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'narration', label: 'Narration' },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
  ]

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Revenue expenses paid from cash or bank, with optional TDS withholding"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            New expense
          </Button>
        }
      />

      <Card title="Recent expenses" bodyClassName="">
        <DataTable
          columns={columns}
          rows={expenses ?? []}
          getRowId={(row) => row.id}
          loading={expenses === undefined}
          empty="No expenses recorded yet."
          onRowClick={showPrint}
        />
      </Card>

      <Modal
        open={open}
        title="New expense"
        onClose={resetForm}
        footer={
          <>
            <Button onClick={resetForm} disabled={task.running}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={task.running}>
              {task.running ? 'Posting…' : requireApproval ? 'Raise request' : 'Post expense'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {task.error && <Alert tone="error">{task.error}</Alert>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Expense account" required>
              <AccountSelect
                value={expenseAccountId}
                onChange={setExpenseAccountId}
                accounts={expenseAccounts}
                placeholder="Select an expense account"
              />
            </Field>
            <Field label="Date" required>
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Gross amount" required hint="Before withholding tax">
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="TDS withheld" hint="Leave zero when no tax is withheld">
              <MoneyInput value={tdsAmount} onChange={setTdsAmount} />
            </Field>
            <Field label="Paid via" required>
              <Select value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>
                {PAYMENT_MODES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" hint="Bill / invoice reference">
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </Field>
            <Field label="Narration" required className="sm:col-span-2">
              <Textarea
                value={narration}
                onChange={(event) => setNarration(event.target.value)}
                placeholder="e.g. Office rent for October"
              />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requireApproval}
              onChange={(event) => setRequireApproval(event.target.checked)}
            />
            <span>
              Raise as a payment request (needs approval)
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                The expense is parked as PENDING and only posts to the ledger once a
                different authorised user approves it.
              </span>
            </span>
          </label>

          {tdsAmount > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Net cash outflow will be {((amount - tdsAmount) / 100).toFixed(2)} with TDS payable of{' '}
              {(tdsAmount / 100).toFixed(2)}.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={printing !== null}
        title={printing ? `Expense ${printing.number}` : 'Expense'}
        onClose={() => setPrinting(null)}
        width="max-w-4xl"
      >
        {printing && (
          <VoucherPrint
            voucher={printing}
            entries={printEntries}
            accountsById={accountsById}
            company={company}
          />
        )}
      </Modal>
    </>
  )
}
