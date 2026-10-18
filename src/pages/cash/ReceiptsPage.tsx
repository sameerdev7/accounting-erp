import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LedgerEntry, type Voucher } from '@/db/schema'
import {
  PAYMENT_MODES,
  checkDuplicateSettlement,
  createReceipt,
  openInvoices,
  planOldestFirst,
  type DuplicateWarning,
  type OpenInvoice,
  type PaymentMode,
} from '@/services/cashbank'
import { entriesForVoucher } from '@/services/ledger'
import { useAsync, useTask } from '@/hooks/async'
import { useAccountMap, useMasters, DateInput, MoneyInput, PartySelect } from '@/components/pickers'
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
  Spinner,
  Textarea,
} from '@/components/ui'
import { formatINR, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { useSession } from '@/store/session'

/**
 * Customer receipts. A receipt is Dr Cash/Bank, Cr Customer, then spread over
 * the customer's open invoices — oldest first by default, with a manual editor
 * for when the operator knows which invoice is being settled.
 */
export function ReceiptsPage() {
  const actor = useSession((state) => state.actor)
  const { customers } = useMasters()
  const accountsById = useAccountMap()
  const company = useLiveQuery(() => db.company.get('company'), [])

  const receipts = useLiveQuery(async () => {
    const rows = await db.vouchers.where('type').equals('RECEIPT').toArray()
    return rows.sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    )
  }, [])

  const customerName = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )

  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [partyId, setPartyId] = useState('')
  const [amount, setAmount] = useState<Paise>(0)
  const [mode, setMode] = useState<PaymentMode>('BANK')
  const [reference, setReference] = useState('')
  const [narration, setNarration] = useState('')
  const [alloc, setAlloc] = useState<Record<string, Paise>>({})
  const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null)
  const [ack, setAck] = useState(false)
  const task = useTask()

  const [printing, setPrinting] = useState<Voucher | null>(null)
  const [printEntries, setPrintEntries] = useState<LedgerEntry[]>([])

  const openQuery = useAsync<OpenInvoice[]>(
    () => (partyId ? openInvoices('SALES', partyId, date) : Promise.resolve([])),
    [partyId, date],
  )
  const openList = openQuery.data ?? []

  // A duplicate warning is only valid for the exact party/amount/date/reference
  // that triggered it, so clear it whenever one of those changes.
  useEffect(() => {
    setDuplicate(null)
    setAck(false)
  }, [partyId, amount, date, reference])

  useEffect(() => {
    setAlloc({})
  }, [partyId])

  const allocatedTotal = useMemo(
    () => Object.values(alloc).reduce((total, value) => total + value, 0),
    [alloc],
  )

  function autoAllocate() {
    const plan = planOldestFirst(openList, amount)
    const next: Record<string, Paise> = {}
    for (const item of plan) next[item.invoiceId] = item.amount
    setAlloc(next)
  }

  function resetForm() {
    setOpen(false)
    setDate(todayISO())
    setPartyId('')
    setAmount(0)
    setMode('BANK')
    setReference('')
    setNarration('')
    setAlloc({})
    setDuplicate(null)
    setAck(false)
    task.reset()
  }

  async function submit(force: boolean) {
    if (!partyId) {
      task.setError('Select a customer.')
      return
    }
    if (amount <= 0) {
      task.setError('Enter a receipt amount greater than zero.')
      return
    }

    await task.run(async () => {
      if (!force) {
        const warning = await checkDuplicateSettlement('RECEIPT', partyId, amount, date, reference)
        if (warning.duplicate) {
          setDuplicate(warning)
          setAck(false)
          return
        }
      }

      const allocateTo = Object.entries(alloc)
        .filter(([, value]) => value > 0)
        .map(([invoiceId, value]) => ({ invoiceId, amount: value }))

      await createReceipt(actor(), {
        partyId,
        date,
        amount,
        mode,
        reference,
        narration,
        allocateTo,
        acknowledgeDuplicate: force ? true : undefined,
      })

      resetForm()
    })
  }

  function showPrint(voucher: Voucher) {
    setPrinting(voucher)
    void entriesForVoucher(voucher.id).then(setPrintEntries)
  }

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Receipt No' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'partyId',
      label: 'Customer',
      render: (row) => customerName.get(row.partyId ?? '') ?? '—',
    },
    { key: 'narration', label: 'Narration' },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
  ]

  const duplicatePending = duplicate?.duplicate ?? false

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Money received from customers and settled against open invoices"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            New receipt
          </Button>
        }
      />

      <Card title="Recent receipts" bodyClassName="">
        <DataTable
          columns={columns}
          rows={receipts ?? []}
          getRowId={(row) => row.id}
          loading={receipts === undefined}
          empty="No receipts recorded yet."
          onRowClick={showPrint}
        />
      </Card>

      <Modal
        open={open}
        title="New receipt"
        onClose={resetForm}
        footer={
          <>
            <Button onClick={resetForm} disabled={task.running}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => submit(duplicatePending && ack)}
              disabled={task.running || (duplicatePending && !ack)}
            >
              {task.running ? 'Posting…' : duplicatePending ? 'Post anyway' : 'Post receipt'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {task.error && <Alert tone="error">{task.error}</Alert>}

          {duplicatePending && (
            <Alert tone="warning">
              <p>{duplicate?.message}</p>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(event) => setAck(event.target.checked)}
                />
                I confirm this is a genuine second receipt.
              </label>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer" required>
              <PartySelect value={partyId} onChange={setPartyId} parties={customers} />
            </Field>
            <Field label="Date" required>
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Amount received" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Mode" required>
              <Select value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}>
                {PAYMENT_MODES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" hint="Cheque / UTR / transaction reference">
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </Field>
            <Field label="Narration" className="sm:col-span-2">
              <Textarea
                value={narration}
                onChange={(event) => setNarration(event.target.value)}
                placeholder="Optional — a default is used when left blank."
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="label mb-0">Allocate to open invoices</span>
              <Button onClick={autoAllocate} disabled={!partyId || amount <= 0 || openList.length === 0}>
                Auto-allocate oldest first
              </Button>
            </div>

            {!partyId ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Select a customer to see their open invoices.</p>
            ) : openQuery.loading ? (
              <Spinner label="Loading open invoices…" />
            ) : openList.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No open invoices for this customer — the receipt will be treated as an advance.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="th text-left">Invoice</th>
                      <th className="th text-left">Due</th>
                      <th className="th text-right">Outstanding</th>
                      <th className="th text-right">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {openList.map((row) => (
                      <tr key={row.invoice.id}>
                        <td className="px-3 py-1.5">{row.invoice.number}</td>
                        <td className="px-3 py-1.5">{formatDate(row.invoice.dueDate)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatINR(row.outstanding)}
                        </td>
                        <td className="px-3 py-1.5">
                          <MoneyInput
                            value={alloc[row.invoice.id] ?? 0}
                            onChange={(value) =>
                              setAlloc((current) => ({ ...current, [row.invoice.id]: value }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {allocatedTotal > 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Allocating <span className="font-medium">{formatINR(allocatedTotal)}</span> of{' '}
                {formatINR(amount)}
                {allocatedTotal > amount && (
                  <span className="text-red-600 dark:text-red-400"> — more than the receipt amount.</span>
                )}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={printing !== null}
        title={printing ? `Receipt ${printing.number}` : 'Receipt'}
        onClose={() => setPrinting(null)}
        width="max-w-4xl"
      >
        {printing && (
          <VoucherPrint
            voucher={printing}
            entries={printEntries}
            accountsById={accountsById}
            company={company}
            partyName={customerName.get(printing.partyId ?? '')}
          />
        )}
      </Modal>
    </>
  )
}
