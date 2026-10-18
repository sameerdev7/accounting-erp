import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Invoice } from '@/db/schema'
import {
  approveInvoice,
  createPurchaseInvoice,
  grnLines,
  invoiceLines,
  purchaseOrderLines,
  receivedQtyByPoLine,
  submitInvoice,
  threeWayMatch,
  type PurchaseInvoiceLineInput,
} from '@/services/purchase'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { DateInput, ItemSelect, MoneyInput, PartySelect, useMasters } from '@/components/pickers'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'

const GST_RATES = [0, 5, 12, 18, 28]

interface LineDraft {
  key: string
  itemId: string
  description: string
  hsn: string
  qty: string
  rate: Paise
  gstRate: string
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `invl-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', description: '', hsn: '', qty: '1', rate: 0, gstRate: '18' }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function PurchaseInvoicesPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canApprove = can('voucher.approve')

  const { items, suppliers } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const supplierNames = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  )

  const invoices = useLiveQuery(() => db.invoices.where('type').equals('PURCHASE').toArray(), [])
  const orders = useLiveQuery(() => db.purchaseOrders.toArray(), [])
  const grns = useLiveQuery(() => db.grns.toArray(), [])

  const rows = useMemo(
    () =>
      [...(invoices ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [invoices],
  )

  const orderNumbers = useMemo(
    () => new Map((orders ?? []).map((order) => [order.id, order.number])),
    [orders],
  )
  const grnNumbers = useMemo(() => new Map((grns ?? []).map((grn) => [grn.id, grn.number])), [grns])

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Invoice | null>(null)

  const [supplierId, setSupplierId] = useState('')
  const [partyInvoiceNumber, setPartyInvoiceNumber] = useState('')
  const [date, setDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [poId, setPoId] = useState('')
  const [grnId, setGrnId] = useState('')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()
  const actionTask = useTask()

  const poLinesState = useAsync(
    () => (poId ? purchaseOrderLines(poId) : Promise.resolve([])),
    [poId],
  )
  const receivedState = useAsync(
    () => (poId ? receivedQtyByPoLine(poId) : Promise.resolve(new Map<string, number>())),
    [poId],
  )
  const grnState = useAsync(
    () => (grnId ? grnLines(grnId) : Promise.resolve([])),
    [grnId],
  )

  const detailLines = useAsync(
    () => (detail ? invoiceLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const match = useMemo(() => {
    if (!poId && !grnId) return null
    if (poLinesState.loading || receivedState.loading || grnState.loading) return null

    const poLines = poLinesState.data ?? []
    const received = receivedState.data ?? new Map<string, number>()

    const po = poLines.map((line) => ({ itemId: line.itemId, qty: line.qty }))
    const grn = grnId
      ? (grnState.data ?? []).map((line) => ({ itemId: line.itemId, acceptedQty: line.acceptedQty }))
      : poLines
          .filter((line) => (received.get(line.id) ?? 0) > 0)
          .map((line) => ({ itemId: line.itemId, acceptedQty: received.get(line.id) ?? 0 }))
    const invoiced = lines
      .filter((line) => line.itemId)
      .map((line) => ({ itemId: line.itemId, qty: numberValue(line.qty) }))

    if (po.length === 0 && grn.length === 0) return null
    return threeWayMatch({ po, grn, invoiced, itemNames })
  }, [
    poId,
    grnId,
    poLinesState.loading,
    poLinesState.data,
    receivedState.loading,
    receivedState.data,
    grnState.loading,
    grnState.data,
    lines,
    itemNames,
  ])

  const resetForm = () => {
    setSupplierId('')
    setPartyInvoiceNumber('')
    setDate(todayISO())
    setDueDate('')
    setPoId('')
    setGrnId('')
    setNarration('')
    setLines([emptyLine()])
  }

  const openCreate = () => {
    resetForm()
    createTask.reset()
    setCreating(true)
  }

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const validLines = lines.filter(
    (line) => line.description.trim() && numberValue(line.qty) > 0,
  )

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      await createPurchaseInvoice(actor(), {
        supplierId,
        partyInvoiceNumber: partyInvoiceNumber.trim(),
        date,
        dueDate: dueDate || undefined,
        poId: poId || null,
        grnId: grnId || null,
        narration: narration.trim(),
        lines: validLines.map<PurchaseInvoiceLineInput>((line) => ({
          itemId: line.itemId || null,
          description: line.description.trim(),
          hsn: line.hsn.trim(),
          qty: numberValue(line.qty),
          rate: line.rate,
          gstRate: numberValue(line.gstRate),
        })),
      })
    })
    if (succeeded) {
      setCreating(false)
      resetForm()
    }
  }

  const runAction = async (work: () => Promise<unknown>) => {
    await actionTask.run(async () => {
      await work()
    })
  }

  const columns: Array<Column<Invoice>> = [
    { key: 'number', label: 'Number' },
    { key: 'partyInvoiceNumber', label: 'Supplier ref' },
    { key: 'partyId', label: 'Supplier', render: (row) => supplierNames.get(row.partyId) ?? row.partyId },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'dueDate', label: 'Due', render: (row) => formatDate(row.dueDate) },
    { key: 'total', label: 'Total', align: 'right', money: true },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.status === 'DRAFT' && (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={() => runAction(() => submitInvoice(actor(), row.id))}
            >
              Submit
            </Button>
          )}
          {row.status === 'PENDING' && canApprove && (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={() => runAction(() => approveInvoice(actor(), row.id))}
            >
              Approve &amp; post
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Purchase invoices"
        subtitle="Supplier tax invoices — each is valued and posted through the engine"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New purchase invoice
          </Button>
        }
      />

      {actionTask.error && (
        <div className="mb-3">
          <Alert tone="error">{actionTask.error}</Alert>
        </div>
      )}

      <Card bodyClassName="">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={invoices === undefined}
          empty="No purchase invoices recorded yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New purchase invoice"
        onClose={() => setCreating(false)}
        width="max-w-5xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={
                createTask.running ||
                !supplierId ||
                !partyInvoiceNumber.trim() ||
                validLines.length === 0
              }
              onClick={submitCreate}
            >
              Record invoice
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Supplier" required>
            <PartySelect value={supplierId} onChange={setSupplierId} parties={suppliers} />
          </Field>
          <Field
            label="Supplier invoice number"
            required
            hint="Must be unique for this supplier — duplicates are blocked."
          >
            <Input
              value={partyInvoiceNumber}
              onChange={(event) => setPartyInvoiceNumber(event.target.value)}
            />
          </Field>
          <Field label="Narration">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
          <Field label="Invoice date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Due date" hint="Defaults to the supplier's payment terms.">
            <DateInput value={dueDate} onChange={setDueDate} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Against PO">
              <Select value={poId} onChange={(event) => setPoId(event.target.value)}>
                <option value="">None</option>
                {(orders ?? []).map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Against GRN">
              <Select
                value={grnId}
                onChange={(event) => {
                  setGrnId(event.target.value)
                  setPoId('')
                }}
              >
                <option value="">None</option>
                {(grns ?? []).map((grn) => (
                  <option key={grn.id} value={grn.id}>
                    {grn.number}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {match && !match.ok && (
          <div className="mt-3">
            <Alert tone="warning">
              <p className="font-medium">Three-way match warning</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {match.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Invoice lines</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="th">Item</th>
                  <th className="th">Description</th>
                  <th className="th w-24">HSN</th>
                  <th className="th w-24 text-right">Qty</th>
                  <th className="th w-36 text-right">Rate</th>
                  <th className="th w-24">GST %</th>
                  <th className="th w-16" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-2 min-w-[12rem]">
                      <ItemSelect
                        value={line.itemId}
                        onChange={(value) => {
                          const item = items.find((candidate) => candidate.id === value)
                          updateLine(line.key, {
                            itemId: value,
                            description: line.description || item?.name || '',
                            hsn: line.hsn || item?.hsn || '',
                            rate: line.rate || item?.purchasePrice || 0,
                            gstRate: item ? String(item.gstRate) : line.gstRate,
                          })
                        }}
                        items={items}
                        placeholder="— none —"
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[14rem]">
                      <Input
                        value={line.description}
                        onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.hsn}
                        onChange={(event) => updateLine(line.key, { hsn: event.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        className="text-right"
                        value={line.qty}
                        onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput
                        value={line.rate}
                        onChange={(paise) => updateLine(line.key, { rate: paise })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={line.gstRate}
                        onChange={(event) => updateLine(line.key, { gstRate: event.target.value })}
                      >
                        {GST_RATES.map((rate) => (
                          <option key={rate} value={String(rate)}>
                            {rate}%
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        variant="ghost"
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines((current) => current.filter((row) => row.key !== line.key))
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Taxable value, CGST/SGST or IGST and the round-off are computed by the posting engine when
            the invoice is saved.
          </p>
        </div>
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `Purchase invoice ${detail.number}` : 'Purchase invoice'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
        footer={
          detail ? (
            <>
              {detail.status === 'DRAFT' && (
                <Button
                  variant="primary"
                  disabled={actionTask.running}
                  onClick={async () => {
                    await runAction(() => submitInvoice(actor(), detail.id))
                    setDetail(null)
                  }}
                >
                  Submit for approval
                </Button>
              )}
              {detail.status === 'PENDING' && canApprove && (
                <Button
                  variant="primary"
                  disabled={actionTask.running}
                  onClick={async () => {
                    await runAction(() => approveInvoice(actor(), detail.id))
                    setDetail(null)
                  }}
                >
                  Approve &amp; post
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detail && (
          <>
            {actionTask.error && (
              <div className="mb-3">
                <Alert tone="error">{actionTask.error}</Alert>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <p className="label">Supplier</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {supplierNames.get(detail.partyId) ?? detail.partyId}
                </p>
              </div>
              <div>
                <p className="label">Supplier ref</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{detail.partyInvoiceNumber || '—'}</p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
              <div>
                <p className="label">Invoice date</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Due date</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(detail.dueDate)}</p>
              </div>
              <div>
                <p className="label">Place of supply</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {detail.placeOfSupply} · {detail.interState ? 'IGST' : 'CGST + SGST'}
                </p>
              </div>
              {detail.sourceDocId && (
                <div>
                  <p className="label">Source</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {detail.sourceDocType === 'GRN'
                      ? grnNumbers.get(detail.sourceDocId) ?? detail.sourceDocId
                      : orderNumbers.get(detail.sourceDocId) ?? detail.sourceDocId}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Invoice lines</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this invoice." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="th">Description</th>
                      <th className="th">HSN</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Taxable</th>
                      <th className="th text-right">GST %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">
                          {line.description}
                          {line.itemId && (
                            <span className="block text-xs text-slate-400 dark:text-slate-500">
                              {itemNames.get(line.itemId) ?? line.itemId}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">{line.hsn || '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.taxable)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{line.gstRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 dark:border-slate-700 font-semibold">
                    <tr>
                      <td className="px-2 py-2" colSpan={4}>
                        Taxable
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                        {formatINR(detail.taxable)}
                      </td>
                    </tr>
                    {detail.igst > 0 ? (
                      <tr>
                        <td className="px-2 py-2" colSpan={4}>
                          IGST
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                          {formatINR(detail.igst)}
                        </td>
                      </tr>
                    ) : (
                      <>
                        <tr>
                          <td className="px-2 py-2" colSpan={4}>
                            CGST
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                            {formatINR(detail.cgst)}
                          </td>
                        </tr>
                        <tr>
                          <td className="px-2 py-2" colSpan={4}>
                            SGST
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                            {formatINR(detail.sgst)}
                          </td>
                        </tr>
                      </>
                    )}
                    {detail.roundOff !== 0 && (
                      <tr>
                        <td className="px-2 py-2" colSpan={4}>
                          Round off
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                          {formatINR(detail.roundOff)}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-2 py-2" colSpan={4}>
                        Total
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" colSpan={2}>
                        {formatINR(detail.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
