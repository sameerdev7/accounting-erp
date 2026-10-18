import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LedgerEntry, type Voucher } from '@/db/schema'
import {
  PAYMENT_MODES,
  checkDuplicateSettlement,
  createPayment,
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
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { formatINR, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { useSession } from '@/store/session'

/**
 * Supplier payments. Dr Supplier, Cr Cash/Bank, then settled against the
 * supplier's open purchase invoices — oldest first unless the operator picks.
 */
export function PaymentsPage() {
  const actor = useSession((state) => state.actor)
  const { suppliers } = useMasters()
  const accountsById = useAccountMap()
  const company = useLiveQuery(() => db.company.get('company'), [])

  const payments = useLiveQuery(async () => {
    const rows = await db.vouchers.where('type').equals('PAYMENT').toArray()
    return rows
      .filter((row) => row.refDocType !== 'EXPENSE')
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
  }, [])

  const supplierName = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
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
  const [requireApproval, setRequireApproval] = useState(false)
  const task = useTask()

  const [printing, setPrinting] = useState<Voucher | null>(null)
  const [printEntries, setPrintEntries] = useState<LedgerEntry[]>([])

  const openQuery = useAsync<OpenInvoice[]>(
    () => (partyId ? openInvoices('PURCHASE', partyId, date) : Promise.resolve([])),
    [partyId, date],
  )
  const openList = openQuery.data ?? []

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
    setRequireApproval(false)
    task.reset()
  }

  async function submit(force: boolean) {
    if (!partyId) {
      task.setError('Select a supplier.')
      return
    }
    if (amount <= 0) {
      task.setError('Enter a payment amount greater than zero.')
      return
    }

    await task.run(async () => {
      if (!force) {
        const warning = await checkDuplicateSettlement('PAYMENT', partyId, amount, date, reference)
        if (warning.duplicate) {
          setDuplicate(warning)
          setAck(false)
          return
        }
      }

      const allocateTo = Object.entries(alloc)
        .filter(([, value]) => value > 0)
        .map(([invoiceId, value]) => ({ invoiceId, amount: value }))

      await createPayment(actor(), {
        partyId,
        date,
        amount,
        mode,
        reference,
        narration,
        allocateTo,
        acknowledgeDuplicate: force ? true : undefined,
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
    { key: 'number', label: 'Payment No' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'partyId',
      label: 'Supplier',
      render: (row) => supplierName.get(row.partyId ?? '') ?? '—',
    },
    { key: 'narration', label: 'Narration' },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
  ]

  const duplicatePending = duplicate?.duplicate ?? false

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Money paid to suppliers and settled against open purchase invoices"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            New payment
          </Button>
        }
      />

      <Card title="Recent payments" bodyClassName="">
        <DataTable
          columns={columns}
          rows={payments ?? []}
          getRowId={(row) => row.id}
          loading={payments === undefined}
          empty="No payments recorded yet."
          onRowClick={showPrint}
        />
      </Card>

      <Modal
        open={open}
        title="New payment"
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
              {task.running
                ? 'Posting…'
                : duplicatePending
                  ? 'Post anyway'
                  : requireApproval
                    ? 'Raise request'
                    : 'Post payment'}
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
                I confirm this is a genuine second payment.
              </label>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Supplier" required>
              <PartySelect value={partyId} onChange={setPartyId} parties={suppliers} />
            </Field>
            <Field label="Date" required>
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label="Amount paid" required>
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

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requireApproval}
              onChange={(event) => setRequireApproval(event.target.checked)}
            />
            <span>
              Raise as a payment request (needs approval)
              <span className="block text-xs text-slate-500">
                The payment is parked as PENDING and only posts to the ledger, and settles
                invoices, once a different authorised user approves it.
              </span>
            </span>
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="label mb-0">Allocate to open invoices</span>
              <Button onClick={autoAllocate} disabled={!partyId || amount <= 0 || openList.length === 0}>
                Auto-allocate oldest first
              </Button>
            </div>

            {!partyId ? (
              <p className="text-sm text-slate-400">Select a supplier to see their open invoices.</p>
            ) : openQuery.loading ? (
              <Spinner label="Loading open invoices…" />
            ) : openList.length === 0 ? (
              <p className="text-sm text-slate-400">
                No open invoices for this supplier — the payment will be treated as an advance.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th text-left">Invoice</th>
                      <th className="th text-left">Due</th>
                      <th className="th text-right">Outstanding</th>
                      <th className="th text-right">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
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
              <p className="mt-2 text-xs text-slate-500">
                Allocating <span className="font-medium">{formatINR(allocatedTotal)}</span> of{' '}
                {formatINR(amount)}
                {allocatedTotal > amount && (
                  <span className="text-red-600"> — more than the payment amount.</span>
                )}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={printing !== null}
        title={printing ? `Payment ${printing.number}` : 'Payment'}
        onClose={() => setPrinting(null)}
        width="max-w-4xl"
      >
        {printing && (
          <VoucherPrint
            voucher={printing}
            entries={printEntries}
            accountsById={accountsById}
            company={company}
            partyName={supplierName.get(printing.partyId ?? '')}
          />
        )}
      </Modal>
    </>
  )
}
