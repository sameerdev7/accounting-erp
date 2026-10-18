import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Delivery, type SalesOrderLine } from '@/db/schema'
import {
  checkAvailability,
  createDelivery,
  deliveryLines,
  postDelivery,
  salesOrderLines,
  type DeliveryLineInput,
  type Shortfall,
} from '@/services/sales'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { DateInput, MoneyInput, useMasters } from '@/components/pickers'
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

interface DeliveryDraft {
  key: string
  soLineId: string | null
  itemId: string
  orderedQty: number
  qty: string
  rate: Paise
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function DeliveriesPage() {
  const actor = useSession((state) => state.actor)

  const { customers, items } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )

  const salesOrders = useLiveQuery(() => db.salesOrders.toArray(), [])
  const deliveries = useLiveQuery(() => db.deliveries.toArray(), [])
  const rows = useMemo(
    () => [...(deliveries ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [deliveries],
  )
  const orderNumbers = useMemo(
    () => new Map((salesOrders ?? []).map((order) => [order.id, order.number])),
    [salesOrders],
  )
  const confirmedOrders = useMemo(
    () => (salesOrders ?? []).filter((order) => order.status === 'CONFIRMED'),
    [salesOrders],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Delivery | null>(null)

  const [soId, setSoId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [drafts, setDrafts] = useState<DeliveryDraft[]>([])
  const [postNow, setPostNow] = useState(true)
  const [backorder, setBackorder] = useState(false)

  const createTask = useTask()
  const actionTask = useTask()

  const selectedOrder = confirmedOrders.find((order) => order.id === soId) ?? null

  const orderLines = useAsync(
    () => (soId ? salesOrderLines(soId) : Promise.resolve<SalesOrderLine[]>([])),
    [soId],
  )

  useEffect(() => {
    const lines = orderLines.data ?? []
    setDrafts(
      lines.map((line) => ({
        key: line.id,
        soLineId: line.id,
        itemId: line.itemId,
        orderedQty: line.qty,
        qty: String(line.qty),
        rate: line.rate,
      })),
    )
  }, [orderLines.data])

  const shortfalls = useAsync(
    () =>
      orderLines.data && orderLines.data.length > 0
        ? checkAvailability(orderLines.data.map((line) => ({ itemId: line.itemId, qty: line.qty })))
        : Promise.resolve<Shortfall[]>([]),
    [orderLines.data],
  )

  const detailLines = useAsync(
    () => (detail ? deliveryLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const resetForm = () => {
    setSoId('')
    setDate(todayISO())
    setNarration('')
    setDrafts([])
    setPostNow(true)
    setBackorder(false)
  }

  const openCreate = () => {
    resetForm()
    createTask.reset()
    setCreating(true)
  }

  const validLines = drafts.filter((draft) => numberValue(draft.qty) > 0)

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      if (!selectedOrder) throw new Error('Select a confirmed sales order to deliver against')
      if (validLines.length === 0) throw new Error('Enter a delivered quantity for at least one line')

      const delivery = await createDelivery(actor(), {
        customerId: selectedOrder.customerId,
        date,
        soId: selectedOrder.id,
        deliveredBy: actor().username,
        narration: narration.trim(),
        lines: validLines.map<DeliveryLineInput>((draft) => ({
          itemId: draft.itemId,
          soLineId: draft.soLineId,
          qty: numberValue(draft.qty),
          rate: draft.rate,
        })),
        allowShortfall: backorder,
      })

      if (postNow) await postDelivery(actor(), delivery.id)
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

  const updateDraft = (key: string, qty: string) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, qty } : draft)))

  const columns: Array<Column<Delivery>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'customer',
      label: 'Customer',
      render: (row) => customerNames.get(row.customerId) ?? row.customerId,
    },
    {
      key: 'so',
      label: 'Sales order',
      render: (row) => (row.soId ? (orderNumbers.get(row.soId) ?? '—') : '—'),
    },
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
              onClick={() => runAction(() => postDelivery(actor(), row.id))}
            >
              Post
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Deliveries"
        subtitle="Despatch goods against confirmed sales orders and post the cost of sales"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New delivery
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
          loading={deliveries === undefined}
          empty="No deliveries prepared yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New delivery"
        onClose={() => setCreating(false)}
        width="max-w-4xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || validLines.length === 0 || !selectedOrder}
              onClick={submitCreate}
            >
              Prepare delivery
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}

        {confirmedOrders.length === 0 && (
          <div className="mb-3">
            <Alert tone="warning">
              No confirmed sales orders. Confirm a sales order before preparing a delivery.
            </Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Sales order" required>
            <Select value={soId} onChange={(event) => setSoId(event.target.value)}>
              <option value="">Select a confirmed order</option>
              {confirmedOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.number} — {customerNames.get(order.customerId) ?? order.customerId}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Narration">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        {selectedOrder && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Goods to despatch</h3>
              {orderLines.loading && <Spinner />}
            </div>

            {(shortfalls.data ?? []).length > 0 && (
              <div className="mb-3">
                <Alert tone="warning">
                  <p className="font-medium">Insufficient stock for:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {(shortfalls.data ?? []).map((short) => (
                      <li key={short.itemId}>
                        {itemNames.get(short.itemId) ?? short.itemId} — short by{' '}
                        {formatQty(short.shortBy)} (required {formatQty(short.required)}, available{' '}
                        {formatQty(short.available)})
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">
                    Reduce the delivered quantity, split the delivery, or tick “Allow back-order”.
                  </p>
                </Alert>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="th">Item</th>
                    <th className="th w-28 text-right">Ordered</th>
                    <th className="th w-28 text-right">Delivered</th>
                    <th className="th w-36 text-right">Rate</th>
                    <th className="th w-32 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => (
                    <tr key={draft.key} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-2">{itemNames.get(draft.itemId) ?? draft.itemId}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                        {formatQty(draft.orderedQty)}
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          className="text-right"
                          value={draft.qty}
                          onChange={(event) => updateDraft(draft.key, event.target.value)}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <MoneyInput
                          value={draft.rate}
                          onChange={(paise) =>
                            setDrafts((current) =>
                              current.map((row) =>
                                row.key === draft.key ? { ...row, rate: paise } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {formatINR(Math.round(numberValue(draft.qty) * draft.rate))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={postNow}
                  onChange={(event) => setPostNow(event.target.checked)}
                />
                Post immediately (issue stock)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={backorder}
                  onChange={(event) => setBackorder(event.target.checked)}
                />
                Allow back-order (permit shortfall)
              </label>
            </div>
          </div>
        )}
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `Delivery ${detail.number}` : 'Delivery'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Customer</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {customerNames.get(detail.customerId) ?? detail.customerId}
                </p>
              </div>
              <div>
                <p className="label">Sales order</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {detail.soId ? (orderNumbers.get(detail.soId) ?? '—') : '—'}
                </p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Despatched items</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this delivery." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="th">Item</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Cost rate</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{itemNames.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(line.costRate)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(Math.round(line.qty * line.rate))}
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
