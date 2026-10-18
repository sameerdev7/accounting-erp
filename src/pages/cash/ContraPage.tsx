import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LedgerEntry, type Voucher } from '@/db/schema'
import { cashAndBankAccounts, createContra } from '@/services/cashbank'
import { entriesForVoucher } from '@/services/ledger'
import { useAsync, useTask } from '@/hooks/async'
import { useAccountMap, DateInput, MoneyInput } from '@/components/pickers'
import { DataTable, type Column } from '@/components/DataTable'
import { VoucherPrint } from '@/components/VoucherPrint'
import {
  Alert,
  Button,
  Card,
  Field,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui'
import { type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { useSession } from '@/store/session'

/** Cash deposited into, or withdrawn from, a bank — money never leaves the business. */
export function ContraPage() {
  const actor = useSession((state) => state.actor)
  const accountsById = useAccountMap()
  const company = useLiveQuery(() => db.company.get('company'), [])

  const accountsQuery = useAsync(() => cashAndBankAccounts(), [])
  const accounts = accountsQuery.data ?? []

  const contras = useLiveQuery(async () => {
    const rows = await db.vouchers.where('type').equals('CONTRA').toArray()
    return rows.sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    )
  }, [])

  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState<Paise>(0)
  const [narration, setNarration] = useState('')
  const task = useTask()

  const [printing, setPrinting] = useState<Voucher | null>(null)
  const [printEntries, setPrintEntries] = useState<LedgerEntry[]>([])

  function resetForm() {
    setOpen(false)
    setDate(todayISO())
    setFromAccountId('')
    setToAccountId('')
    setAmount(0)
    setNarration('')
    task.reset()
  }

  async function submit() {
    if (!fromAccountId || !toAccountId) {
      task.setError('Select both the source and the destination account.')
      return
    }
    if (fromAccountId === toAccountId) {
      task.setError('The source and destination accounts must be different.')
      return
    }
    if (amount <= 0) {
      task.setError('Enter a contra amount greater than zero.')
      return
    }

    await task.run(async () => {
      await createContra(actor(), { date, fromAccountId, toAccountId, amount, narration })
      resetForm()
    })
  }

  function showPrint(voucher: Voucher) {
    setPrinting(voucher)
    void entriesForVoucher(voucher.id).then(setPrintEntries)
  }

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Contra No' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'narration', label: 'Narration' },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
  ]

  return (
    <>
      <PageHeader
        title="Contra"
        subtitle="Transfer money between cash and bank accounts"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            New contra
          </Button>
        }
      />

      <Card title="Recent contra entries" bodyClassName="">
        <DataTable
          columns={columns}
          rows={contras ?? []}
          getRowId={(row) => row.id}
          loading={contras === undefined}
          empty="No contra entries recorded yet."
          onRowClick={showPrint}
        />
      </Card>

      <Modal
        open={open}
        title="New contra"
        onClose={resetForm}
        footer={
          <>
            <Button onClick={resetForm} disabled={task.running}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={task.running}>
              {task.running ? 'Posting…' : 'Post contra'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {task.error && <Alert tone="error">{task.error}</Alert>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="From account" required hint="Money leaves this account">
              <Select
                value={fromAccountId}
                onChange={(event) => setFromAccountId(event.target.value)}
              >
                <option value="">Select an account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To account" required hint="Money enters this account">
              <Select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                <option value="">Select an account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Narration" required className="sm:col-span-2">
              <Textarea
                value={narration}
                onChange={(event) => setNarration(event.target.value)}
                placeholder="e.g. Cash deposited into current account"
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={printing !== null}
        title={printing ? `Contra ${printing.number}` : 'Contra'}
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
