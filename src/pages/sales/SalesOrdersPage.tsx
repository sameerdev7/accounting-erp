import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SalesOrder } from '@/db/schema'
import {
  createSalesOrder,
  salesOrderLines,
  setSalesOrderStatus,
  type SalesOrderLineInput,
} from '@/services/sales'
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
  Textarea,
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'

const GST_RATES = [0, 5, 12, 18, 28]

interface LineDraft {
  key: string
  itemId: string
  qty: string
  rate: Paise
  gstRate: number
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `sol-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', qty: '1', rate: 0, gstRate: 18 }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lineTotal(qty: number, rate: Paise, gstRate: number): Paise {
  const taxable = Math.round(qty * rate)
  return taxable + Math.round((taxable * gstRate) / 100)
}

export function SalesOrdersPage() {
  const actor = useSession((state) => state.actor)

  const { customers, items } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )

  const orders = useLiveQuery(() => db.salesOrders.toArray(), [])
  const rows = useMemo(
    () =>
      [...(orders ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [orders],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<SalesOrder | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [expectedDate, setExpectedDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()
  const actionTask = useTask()

  const detailLines = useAsync(
    () => (detail ? salesOrderLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const resetForm = () => {
    setCustomerId('')
    setDate(todayISO())
    setExpectedDate(todayISO())
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
      await createSalesOrder(actor(), {
        customerId,
        date,
        expectedDate,
        narration: narration.trim(),
        lines: validLines.map<SalesOrderLineInput>((line) => ({
          itemId: line.itemId,
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

  const columns: Array<Column<SalesOrder>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'customer',
      label: 'Customer',
      render: (row) => customerNames.get(row.customerId) ?? row.customerId,
    },
    { key: 'expectedDate', label: 'Expected', render: (row) => formatDate(row.expectedDate) },
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
              onClick={() => runAction(() => setSalesOrderStatus(actor(), row.id, 'CONFIRMED'))}
            >
              Confirm
            </Button>
          )}
          {row.status === 'CONFIRMED' && (
            <Button
              disabled={actionTask.running}
              onClick={() => runAction(() => setSalesOrderStatus(actor(), row.id, 'CLOSED'))}
            >
              Close
            </Button>
          )}
          {(row.status === 'DRAFT' || row.status === 'CONFIRMED') && (
            <Button
              variant="danger"
              disabled={actionTask.running}
              onClick={() => runAction(() => setSalesOrderStatus(actor(), row.id, 'CANCELLED'))}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle="Customer orders awaiting confirmation and despatch"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New order
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
          empty="No sales orders raised yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New sales order"
        onClose={() => setCreating(false)}
        width="max-w-4xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || validLines.length === 0 || !customerId}
              onClick={submitCreate}
            >
              Raise order
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Customer" required>
            <PartySelect value={customerId} onChange={setCustomerId} parties={customers} />
          </Field>
          <Field label="Order date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Expected date">
            <DateInput value={expectedDate} onChange={setExpectedDate} />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Narration">
            <Textarea value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Items</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="th">Item</th>
                  <th className="th w-24 text-right">Qty</th>
                  <th className="th w-36 text-right">Rate</th>
                  <th className="th w-28">GST %</th>
                  <th className="th w-32 text-right">Amount</th>
                  <th className="th w-24" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-2">
                      <ItemSelect
                        value={line.itemId}
                        onChange={(value) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key
                                ? {
                                    ...row,
                                    itemId: value,
                                    rate:
                                      row.rate ||
                                      items.find((item) => item.id === value)?.salePrice ||
                                      0,
                                    gstRate:
                                      items.find((item) => item.id === value)?.gstRate ??
                                      row.gstRate,
                                  }
                                : row,
                            ),
                          )
                        }
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
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {formatINR(lineTotal(numberValue(line.qty), line.rate, line.gstRate))}
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
        title={detail ? `Sales order ${detail.number}` : 'Sales order'}
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
                <p className="label">Expected</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(detail.expectedDate)}</p>
              </div>
              <div>
                <p className="label">Customer</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {customerNames.get(detail.customerId) ?? detail.customerId}
                </p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            {detail.narration && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">Narration: </span>
                {detail.narration}
              </p>
            )}

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Ordered items</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this order." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className="th">Item</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">GST %</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{itemNames.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(line.rate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{line.gstRate}%</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(lineTotal(line.qty, line.rate, line.gstRate))}
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
