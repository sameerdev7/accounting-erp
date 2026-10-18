import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PurchaseOrder } from '@/db/schema'
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  purchaseOrderLines,
  type PurchaseOrderLineInput,
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
  qty: string
  rate: Paise
  gstRate: string
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `pol-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', qty: '1', rate: 0, gstRate: '18' }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function PurchaseOrdersPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canApprove = can('purchase.approve')

  const { items, suppliers } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const supplierNames = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  )

  const orders = useLiveQuery(() => db.purchaseOrders.toArray(), [])
  const requisitions = useLiveQuery(() => db.purchaseRequisitions.toArray(), [])

  const rows = useMemo(
    () =>
      [...(orders ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [orders],
  )

  const approvedPrs = useMemo(
    () => (requisitions ?? []).filter((pr) => pr.status === 'APPROVED'),
    [requisitions],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<PurchaseOrder | null>(null)

  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [expectedDate, setExpectedDate] = useState(todayISO())
  const [prId, setPrId] = useState('')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()
  const actionTask = useTask()

  const detailLines = useAsync(
    () => (detail ? purchaseOrderLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const resetForm = () => {
    setSupplierId('')
    setDate(todayISO())
    setExpectedDate(todayISO())
    setPrId('')
    setNarration('')
    setLines([emptyLine()])
  }

  const openCreate = () => {
    resetForm()
    createTask.reset()
    setCreating(true)
  }

  const validLines = lines.filter((line) => line.itemId && numberValue(line.qty) > 0)

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      await createPurchaseOrder(actor(), {
        date,
        supplierId,
        expectedDate,
        prId: prId || null,
        narration: narration.trim(),
        lines: validLines.map<PurchaseOrderLineInput>((line) => ({
          itemId: line.itemId,
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

  const approve = async (order: PurchaseOrder) => {
    await actionTask.run(async () => {
      await approvePurchaseOrder(actor(), order.id)
    })
  }

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const columns: Array<Column<PurchaseOrder>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'supplierId', label: 'Supplier', render: (row) => supplierNames.get(row.supplierId) ?? row.supplierId },
    { key: 'expectedDate', label: 'Expected', render: (row) => formatDate(row.expectedDate) },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.status === 'DRAFT' && canApprove && (
            <Button variant="primary" disabled={actionTask.running} onClick={() => approve(row)}>
              Approve
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Orders placed on suppliers"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New purchase order
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
          loading={orders === undefined}
          empty="No purchase orders yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New purchase order"
        onClose={() => setCreating(false)}
        width="max-w-5xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || !supplierId || validLines.length === 0}
              onClick={submitCreate}
            >
              Raise purchase order
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
          <Field label="Supplier" required className="sm:col-span-2">
            <PartySelect value={supplierId} onChange={setSupplierId} parties={suppliers} />
          </Field>
          <Field label="Date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Expected date" required>
            <DateInput value={expectedDate} onChange={setExpectedDate} />
          </Field>
          <Field label="Link requisition" hint="Optional — ties the order back to an approved indent.">
            <Select value={prId} onChange={(event) => setPrId(event.target.value)}>
              <option value="">None</option>
              {approvedPrs.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.number} — {pr.department}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Narration" className="sm:col-span-2 lg:col-span-3">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Order lines</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="th">Item</th>
                  <th className="th w-24 text-right">Qty</th>
                  <th className="th w-36 text-right">Rate</th>
                  <th className="th w-28">GST %</th>
                  <th className="th w-32 text-right">Amount</th>
                  <th className="th w-16" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100">
                    <td className="px-2 py-2">
                      <ItemSelect
                        value={line.itemId}
                        onChange={(value) => {
                          const item = items.find((candidate) => candidate.id === value)
                          updateLine(line.key, {
                            itemId: value,
                            rate: line.rate || item?.purchasePrice || 0,
                            gstRate: item ? String(item.gstRate) : line.gstRate,
                          })
                        }}
                        items={items}
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
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(Math.round(numberValue(line.qty) * line.rate))}
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
        </div>
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `Purchase order ${detail.number}` : 'Purchase order'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
        footer={
          detail && detail.status === 'DRAFT' && canApprove ? (
            <Button
              variant="primary"
              disabled={actionTask.running}
              onClick={async () => {
                await approve(detail)
                setDetail(null)
              }}
            >
              Approve purchase order
            </Button>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Supplier</p>
                <p className="text-sm text-slate-700">
                  {supplierNames.get(detail.supplierId) ?? detail.supplierId}
                </p>
              </div>
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Expected</p>
                <p className="text-sm text-slate-700">{formatDate(detail.expectedDate)}</p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Order lines</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this order." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="th">Item</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">GST %</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-2 py-2">{itemNames.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{line.gstRate}%</td>
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
