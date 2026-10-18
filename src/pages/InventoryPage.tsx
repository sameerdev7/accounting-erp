import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type StockMovement } from '@/db/schema'
import { sortMovements, stockPositions, totalInventoryValue } from '@/services/inventory'
import { closeInventoryPeriod, closedInventoryMonths } from '@/services/periodEnd'
import { DataTable, type Column } from '@/components/DataTable'
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, StatCard } from '@/components/ui'
import { useTask } from '@/hooks/async'
import { monthKey } from '@/lib/dates'
import { formatDate, todayISO } from '@/lib/format'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { useSession } from '@/store/session'

interface StockRow {
  id: string
  sku: string
  name: string
  category: string
  qty: number
  avgCost: Paise
  value: Paise
  reorderLevel: number
  below: boolean
}

/**
 * Stock on hand, valued at weighted-average cost. Quantity and value are
 * replayed from the movement history rather than stored, so the warehouse and
 * the inventory ledger can never disagree.
 */
export function InventoryPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const items = useLiveQuery(() => db.items.toArray(), [])
  const positions = useLiveQuery(() => stockPositions(), [])
  const totalValue = useLiveQuery(() => totalInventoryValue(), [])
  const closedMonths = useLiveQuery(() => closedInventoryMonths(), [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [period, setPeriod] = useState(monthKey(todayISO()))
  const [reopen, setReopen] = useState(false)
  const task = useTask()

  const movements = useLiveQuery<StockMovement[]>(
    () =>
      selectedId
        ? db.stockMovements.where('itemId').equals(selectedId).toArray()
        : Promise.resolve([]),
    [selectedId],
  )

  const rows = useMemo<StockRow[]>(() => {
    // Services are never stocked, so they are not part of the warehouse view.
    return (items ?? []).filter((item) => item.kind !== 'SERVICE').map((item) => {
      const position = positions?.get(item.id)
      const qty = position?.qty ?? 0
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        qty,
        avgCost: position?.avgCost ?? 0,
        value: position?.value ?? 0,
        reorderLevel: item.reorderLevel,
        below: qty < item.reorderLevel,
      }
    })
  }, [items, positions])

  const belowCount = rows.filter((row) => row.below).length
  const selectedItem = (items ?? []).find((item) => item.id === selectedId)

  const movementRows = useMemo(() => {
    const ordered = sortMovements(movements ?? [])
    let running = 0
    return ordered.map((movement) => {
      running += movement.qtyIn - movement.qtyOut
      return { movement, running }
    })
  }, [movements])

  const columns: Array<Column<StockRow>> = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Item' },
    { key: 'category', label: 'Category' },
    { key: 'qty', label: 'Qty', align: 'right', render: (row) => formatQty(row.qty) },
    { key: 'avgCost', label: 'Avg cost', align: 'right', money: true },
    { key: 'value', label: 'Value', align: 'right', money: true, total: true },
    { key: 'reorderLevel', label: 'Reorder level', align: 'right' },
    {
      key: 'below',
      label: 'Status',
      render: (row) =>
        row.below ? <Badge tone="red">Below reorder</Badge> : <Badge tone="green">OK</Badge>,
    },
  ]

  async function closePeriod() {
    await task.run(async () => {
      const result = await closeInventoryPeriod(actor(), { month: period, reopen })
      task.setNotice(
        `Closed ${result.month}: opening ${formatINR(result.openingStock)} + purchases ${formatINR(
          result.purchases,
        )} − closing ${formatINR(result.closingStock)} → COGS, voucher ${result.voucherNumber}.`,
      )
      setReopen(false)
    })
  }

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock on hand valued at weighted-average cost" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Items" value={rows.length} hint="Active item master records" />
        <StatCard label="Inventory value" value={formatINR(totalValue ?? 0)} hint="At weighted-average cost" />
        <StatCard
          label="Below reorder level"
          value={belowCount}
          tone={belowCount > 0 ? 'warning' : 'default'}
          hint="Items needing replenishment"
        />
      </div>

      <div className="mt-4">
        <Card title="Stock position" bodyClassName="">
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={items === undefined || positions === undefined}
            empty="No items in the master."
            onRowClick={(row) => setSelectedId(row.id)}
            totalLabel="Total value"
          />
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Period-end inventory close">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            Inventory is valued by the periodic method: purchases accumulate in the Purchases
            account and are only charged to Cost of Goods Sold when a period is closed, using
            opening stock plus purchases less the closing stock below. Each month is closed at most
            once.
          </p>

          {task.error && <Alert tone="error">{task.error}</Alert>}
          {task.notice && (
            <div className="mb-3">
              <Alert tone="success">{task.notice}</Alert>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Period (month)">
              <Input
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              disabled={task.running || !period || !can('voucher.post')}
              onClick={closePeriod}
            >
              {task.running ? 'Closing…' : 'Close period'}
            </Button>
            <label className="mb-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={reopen}
                onChange={(event) => setReopen(event.target.checked)}
              />
              Re-open and re-close if already closed
            </label>
          </div>

          {!can('voucher.post') && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Your role cannot post journals, so you cannot close a period.
            </p>
          )}

          {closedMonths && closedMonths.length > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Closed months: {closedMonths.join(', ')}</p>
          )}
        </Card>
      </div>

      <Modal
        open={selectedId !== null}
        title={selectedItem ? `${selectedItem.sku} — ${selectedItem.name}` : 'Stock movements'}
        onClose={() => setSelectedId(null)}
      >
        {movementRows.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No stock movements recorded for this item.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="th text-left">Date</th>
                  <th className="th text-left">Type</th>
                  <th className="th text-left">Reference</th>
                  <th className="th text-right">In</th>
                  <th className="th text-right">Out</th>
                  <th className="th text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {movementRows.map(({ movement, running }) => (
                  <tr key={movement.id}>
                    <td className="px-3 py-1.5">{formatDate(movement.date)}</td>
                    <td className="px-3 py-1.5">{movement.type}</td>
                    <td className="px-3 py-1.5">{movement.narration}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {movement.qtyIn ? formatQty(movement.qtyIn) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {movement.qtyOut ? formatQty(movement.qtyOut) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  )
}
