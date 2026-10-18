import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Invoice } from '@/db/schema'
import {
  approveSalesInvoice,
  createSalesInvoice,
  submitSalesInvoice,
  type SalesInvoiceLineInput,
} from '@/services/sales'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import {
  DateInput,
  ItemSelect,
  MoneyInput,
  PartySelect,
  useMasters,
} from '@/components/pickers'
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
  Textarea,
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
  gstRate: number
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `invl-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', description: '', hsn: '', qty: '1', rate: 0, gstRate: 18 }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function SalesInvoicesPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canApprove = can('voucher.approve')

  const { customers, items } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )

  const invoices = useLiveQuery(() => db.invoices.where('type').equals('SALES').toArray(), [])
  const rows = useMemo(
    () =>
      [...(invoices ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [invoices],
  )

  const deliveries = useLiveQuery(() => db.deliveries.toArray(), [])
  const postedDeliveries = useMemo(
    () => (deliveries ?? []).filter((delivery) => delivery.status === 'POSTED'),
    [deliveries],
  )
  const deliveryNumbers = useMemo(
    () => new Map((deliveries ?? []).map((delivery) => [delivery.id, delivery.number])),
    [deliveries],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Invoice | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [deliveryId, setDeliveryId] = useState('')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()
  const actionTask = useTask()

  const sourcedDelivery = postedDeliveries.find((delivery) => delivery.id === deliveryId) ?? null

  const deliveryLines = useAsync(
    () => (deliveryId ? db.deliveryLines.where('deliveryId').equals(deliveryId).toArray() : Promise.resolve([])),
    [deliveryId],
  )

  useEffect(() => {
    if (!deliveryId) return
    const sourced = deliveryLines.data ?? []
    if (sourced.length === 0) return
    const delivery = (deliveries ?? []).find((row) => row.id === deliveryId)
    if (delivery) setCustomerId(delivery.customerId)
    setLines(
      sourced.map<LineDraft>((line) => {
        const item = items.find((candidate) => candidate.id === line.itemId)
        return {
          key: nextKey(),
          itemId: line.itemId,
          description: item?.name ?? '',
          hsn: item?.hsn ?? '',
          qty: String(line.qty),
          rate: line.rate,
          gstRate: item?.gstRate ?? 18,
        }
      }),
    )
  }, [deliveryLines.data, deliveryId, deliveries, items])

  const detailLines = useAsync(
    () =>
      detail
        ? db.invoiceLines.where('invoiceId').equals(detail.id).toArray()
        : Promise.resolve([]),
    [detail?.id],
  )

  const resetForm = () => {
    setCustomerId('')
    setDate(todayISO())
    setDueDate('')
    setDeliveryId('')
    setNarration('')
    setLines([emptyLine()])
  }

  const openCreate = () => {
    resetForm()
    createTask.reset()
    setCreating(true)
  }

  const validLines = lines.filter((line) => numberValue(line.qty) > 0 && (line.itemId || line.description))

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      await createSalesInvoice(actor(), {
        customerId,
        date,
        dueDate: dueDate || undefined,
        deliveryId: deliveryId || null,
        narration: narration.trim(),
        lines: validLines.map<SalesInvoiceLineInput>((line) => ({
          itemId: line.itemId || null,
          description: line.description.trim() || (itemNames.get(line.itemId) ?? 'Item'),
          hsn: line.hsn.trim(),
          qty: numberValue(line.qty),
          rate: line.rate,
          gstRate: line.gstRate,
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
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'party',
      label: 'Customer',
      render: (row) => customerNames.get(row.partyId) ?? row.partyId,
    },
    { key: 'dueDate', label: 'Due', render: (row) => formatDate(row.dueDate) },
    { key: 'total', label: 'Total', align: 'right', money: true, total: true },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.status === 'DRAFT' && (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={() => runAction(() => submitSalesInvoice(actor(), row.id))}
            >
              Submit
            </Button>
          )}
          {row.status === 'PENDING' && canApprove && (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={() => runAction(() => approveSalesInvoice(actor(), row.id))}
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
        title="Sales invoices"
        subtitle="Tax invoices raised on customers, with GST computed on the lines"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New invoice
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
          empty="No sales invoices raised yet."
          onRowClick={(row) => setDetail(row)}
          totalLabel="Total"
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New sales invoice"
        onClose={() => setCreating(false)}
        width="max-w-5xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || validLines.length === 0 || !customerId}
              onClick={submitCreate}
            >
              Raise invoice
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Customer" required>
            <PartySelect value={customerId} onChange={setCustomerId} parties={customers} />
          </Field>
          <Field label="Invoice date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Due date" hint="Defaults to the customer's credit days">
            <DateInput value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Source delivery" hint="Optional — pulls the despatched lines">
            <Select value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)}>
              <option value="">None</option>
              {postedDeliveries.map((delivery) => (
                <option key={delivery.id} value={delivery.id}>
                  {delivery.number} — {customerNames.get(delivery.customerId) ?? delivery.customerId}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {sourcedDelivery && (
          <div className="mt-3">
            <Alert tone="info">
              Lines loaded from delivery {sourcedDelivery.number}. GST is recalculated on the invoice.
            </Alert>
          </div>
        )}

        <div className="mt-3">
          <Field label="Narration">
            <Textarea value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Invoice lines</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="th w-56">Item</th>
                  <th className="th">Description</th>
                  <th className="th w-24">HSN</th>
                  <th className="th w-20 text-right">Qty</th>
                  <th className="th w-32 text-right">Rate</th>
                  <th className="th w-24">GST %</th>
                  <th className="th w-28 text-right">Amount</th>
                  <th className="th w-20" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const taxable = Math.round(numberValue(line.qty) * line.rate)
                  return (
                    <tr key={line.key} className="border-b border-slate-100">
                      <td className="px-2 py-2">
                        <ItemSelect
                          value={line.itemId}
                          onChange={(value) => {
                            const item = items.find((candidate) => candidate.id === value)
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? {
                                      ...row,
                                      itemId: value,
                                      description: item?.name ?? row.description,
                                      hsn: item?.hsn ?? row.hsn,
                                      rate: item?.salePrice ?? row.rate,
                                      gstRate: item?.gstRate ?? row.gstRate,
                                    }
                                  : row,
                              ),
                            )
                          }}
                          items={items}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, description: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          value={line.hsn}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key ? { ...row, hsn: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          className="text-right"
                          value={line.qty}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key ? { ...row, qty: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput
                          value={line.rate}
                          onChange={(paise) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key ? { ...row, rate: paise } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          value={String(line.gstRate)}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((row) =>
                                row.key === line.key
                                  ? { ...row, gstRate: Number(event.target.value) }
                                  : row,
                              ),
                            )
                          }
                        >
                          {GST_RATES.map((rate) => (
                            <option key={rate} value={rate}>
                              {rate}%
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {formatINR(taxable + Math.round((taxable * line.gstRate) / 100))}
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
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `Sales invoice ${detail.number}` : 'Sales invoice'}
        onClose={() => setDetail(null)}
        width="max-w-4xl"
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Due</p>
                <p className="text-sm text-slate-700">{formatDate(detail.dueDate)}</p>
              </div>
              <div>
                <p className="label">Customer</p>
                <p className="text-sm text-slate-700">
                  {customerNames.get(detail.partyId) ?? detail.partyId}
                </p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Place of supply</p>
                <p className="text-sm text-slate-700">{detail.placeOfSupply || '—'}</p>
              </div>
              <div>
                <p className="label">Source</p>
                <p className="text-sm text-slate-700">
                  {detail.sourceDocType === 'DELIVERY' && detail.sourceDocId
                    ? (deliveryNumbers.get(detail.sourceDocId) ?? '—')
                    : '—'}
                </p>
              </div>
              <div>
                <p className="label">GST</p>
                <p className="text-sm text-slate-700">
                  {detail.interState
                    ? `IGST ${formatINR(detail.igst)}`
                    : `CGST ${formatINR(detail.cgst)} · SGST ${formatINR(detail.sgst)}`}
                </p>
              </div>
              <div>
                <p className="label">Total</p>
                <p className="text-sm font-semibold text-slate-800">{formatINR(detail.total)}</p>
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Invoice lines</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this invoice." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="th">Item</th>
                      <th className="th">Description</th>
                      <th className="th text-right">HSN</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Taxable</th>
                      <th className="th text-right">GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-2 py-2">
                          {line.itemId ? (itemNames.get(line.itemId) ?? line.itemId) : '—'}
                        </td>
                        <td className="px-2 py-2">{line.description}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{line.hsn || '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(line.taxable)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(line.cgst + line.sgst + line.igst)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
