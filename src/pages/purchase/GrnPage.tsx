import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Grn } from '@/db/schema'
import {
  createGrn,
  grnLines,
  postGrn,
  purchaseOrderLines,
  receivedQtyByPoLine,
  type GrnLineInput,
} from '@/services/purchase'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { DateInput, useMasters } from '@/components/pickers'
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

interface GrnDraft {
  poLineId: string
  itemId: string
  orderedQty: number
  rate: Paise
  remaining: number
  receivedQty: string
  rejectedQty: string
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function GrnPage() {
  const actor = useSession((state) => state.actor)

  const { items, suppliers } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const supplierNames = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  )

  const grns = useLiveQuery(() => db.grns.toArray(), [])
  const orders = useLiveQuery(() => db.purchaseOrders.toArray(), [])

  const rows = useMemo(
    () =>
      [...(grns ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [grns],
  )

  const receivablePos = useMemo(
    () => (orders ?? []).filter((order) => order.status === 'APPROVED' || order.status === 'PARTIAL'),
    [orders],
  )

  const poNumbers = useMemo(
    () => new Map((orders ?? []).map((order) => [order.id, order.number])),
    [orders],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Grn | null>(null)

  const [date, setDate] = useState(todayISO())
  const [poId, setPoId] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [narration, setNarration] = useState('')
  const [drafts, setDrafts] = useState<GrnDraft[]>([])

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

  const detailLines = useAsync(
    () => (detail ? grnLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  useEffect(() => {
    const lines = poLinesState.data ?? []
    const received = receivedState.data ?? new Map<string, number>()
    setDrafts(
      lines.map((line) => {
        const alreadyReceived = received.get(line.id) ?? 0
        const remaining = Math.max(0, line.qty - alreadyReceived)
        return {
          poLineId: line.id,
          itemId: line.itemId,
          orderedQty: line.qty,
          rate: line.rate,
          remaining,
          receivedQty: remaining > 0 ? String(remaining) : '0',
          rejectedQty: '0',
        }
      }),
    )
  }, [poLinesState.data, receivedState.data])

  const openCreate = () => {
    setDate(todayISO())
    setPoId('')
    setVehicleNo('')
    setNarration('')
    setDrafts([])
    createTask.reset()
    setCreating(true)
  }

  const updateDraft = (poLineId: string, patch: Partial<GrnDraft>) => {
    setDrafts((current) =>
      current.map((row) => (row.poLineId === poLineId ? { ...row, ...patch } : row)),
    )
  }

  const validDrafts = drafts.filter((row) => numberValue(row.receivedQty) > 0)

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      const grn = await createGrn(actor(), {
        date,
        poId,
        receivedBy: actor().userId,
        vehicleNo: vehicleNo.trim() || undefined,
        narration: narration.trim(),
        lines: validDrafts.map<GrnLineInput>((row) => ({
          poLineId: row.poLineId,
          itemId: row.itemId,
          orderedQty: row.orderedQty,
          receivedQty: numberValue(row.receivedQty),
          rejectedQty: numberValue(row.rejectedQty),
          rate: row.rate,
        })),
      })
      await postGrn(actor(), grn.id)
    })
    if (succeeded) {
      setCreating(false)
    }
  }

  const post = async (grn: Grn) => {
    await actionTask.run(async () => {
      await postGrn(actor(), grn.id)
    })
  }

  const columns: Array<Column<Grn>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'poId', label: 'PO', render: (row) => poNumbers.get(row.poId) ?? row.poId },
    {
      key: 'supplierId',
      label: 'Supplier',
      render: (row) => supplierNames.get(row.supplierId) ?? row.supplierId,
    },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.status === 'DRAFT' && (
            <Button variant="primary" disabled={actionTask.running} onClick={() => post(row)}>
              Post receipt
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Goods receipt notes"
        subtitle="Goods received against approved purchase orders"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New goods receipt
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
          loading={grns === undefined}
          empty="No goods receipts recorded yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New goods receipt"
        onClose={() => setCreating(false)}
        width="max-w-5xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={
                createTask.running ||
                !poId ||
                validDrafts.length === 0 ||
                poLinesState.loading ||
                receivedState.loading
              }
              onClick={submitCreate}
            >
              Record &amp; post receipt
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Purchase order" required className="sm:col-span-2">
            <Select value={poId} onChange={(event) => setPoId(event.target.value)}>
              <option value="">Select an approved purchase order</option>
              {receivablePos.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.number} — {supplierNames.get(order.supplierId) ?? order.supplierId} ({order.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Receipt date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Vehicle no.">
            <Input value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} />
          </Field>
          <Field label="Narration" className="sm:col-span-2 lg:col-span-4">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Receipt lines</h3>
          {!poId ? (
            <EmptyState message="Pick a purchase order to load its outstanding lines." />
          ) : poLinesState.loading || receivedState.loading ? (
            <Spinner />
          ) : drafts.length === 0 ? (
            <EmptyState message="This purchase order has no lines." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="th">Item</th>
                    <th className="th text-right">Ordered</th>
                    <th className="th text-right">Already received</th>
                    <th className="th w-28 text-right">Received now</th>
                    <th className="th w-28 text-right">Rejected</th>
                    <th className="th text-right">Accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((row) => {
                    const accepted = numberValue(row.receivedQty) - numberValue(row.rejectedQty)
                    return (
                      <tr key={row.poLineId} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{itemNames.get(row.itemId) ?? row.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(row.orderedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {formatQty(row.orderedQty - row.remaining)}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            className="text-right"
                            value={row.receivedQty}
                            onChange={(event) =>
                              updateDraft(row.poLineId, { receivedQty: event.target.value })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            className="text-right"
                            value={row.rejectedQty}
                            onChange={(event) =>
                              updateDraft(row.poLineId, { rejectedQty: event.target.value })
                            }
                          />
                        </td>
                        <td
                          className={`px-2 py-2 text-right tabular-nums ${
                            accepted < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {formatQty(accepted)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Only the accepted quantity (received less rejected) enters stock. Posting the receipt moves
            quantity; the purchase invoice values it in the ledger.
          </p>
        </div>
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `Goods receipt ${detail.number}` : 'Goods receipt'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
        footer={
          detail && detail.status === 'DRAFT' ? (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={async () => {
                await post(detail)
                setDetail(null)
              }}
            >
              Post receipt
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">PO</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{poNumbers.get(detail.poId) ?? detail.poId}</p>
              </div>
              <div>
                <p className="label">Supplier</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {supplierNames.get(detail.supplierId) ?? detail.supplierId}
                </p>
              </div>
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Received lines</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this receipt." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="th">Item</th>
                      <th className="th text-right">Ordered</th>
                      <th className="th text-right">Received</th>
                      <th className="th text-right">Rejected</th>
                      <th className="th text-right">Accepted</th>
                      <th className="th text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{itemNames.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.orderedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.receivedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.rejectedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.acceptedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
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
