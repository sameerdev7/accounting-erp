import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Voucher } from '@/db/schema'
import { createSalesReturn } from '@/services/sales'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import {
  DateInput,
  ItemSelect,
  MoneyInput,
  PartySelect,
  useAccountMap,
  useMasters,
} from '@/components/pickers'
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
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { VoucherPrint } from '@/components/VoucherPrint'

const GST_RATES = [0, 5, 12, 18, 28]

interface LineDraft {
  key: string
  itemId: string
  description: string
  qty: string
  rate: Paise
  gstRate: number
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `cnl-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', description: '', qty: '1', rate: 0, gstRate: 18 }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function SalesReturnsPage() {
  const actor = useSession((state) => state.actor)

  const { customers, items } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )
  const accountsById = useAccountMap()
  const company = useLiveQuery(() => db.company.get('company'), [])

  const vouchers = useLiveQuery(() => db.vouchers.where('type').equals('CREDIT_NOTE').toArray(), [])
  const rows = useMemo(
    () => [...(vouchers ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [vouchers],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Voucher | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [reinstateStock, setReinstateStock] = useState(false)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()

  const detailEntries = useAsync(
    () =>
      detail
        ? db.ledgerEntries.where('voucherId').equals(detail.id).toArray()
        : Promise.resolve([]),
    [detail?.id],
  )

  const resetForm = () => {
    setCustomerId('')
    setDate(todayISO())
    setNarration('')
    setReinstateStock(false)
    setLines([emptyLine()])
  }

  const openCreate = () => {
    resetForm()
    createTask.reset()
    setFlash(null)
    setCreating(true)
  }

  const validLines = lines.filter((line) => numberValue(line.qty) > 0 && (line.itemId || line.description))

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      const result = await createSalesReturn(actor(), {
        customerId,
        date,
        narration: narration.trim(),
        reinstateStock,
        lines: validLines.map((line) => ({
          itemId: line.itemId || null,
          description: line.description.trim() || (itemNames.get(line.itemId) ?? 'Item'),
          qty: numberValue(line.qty),
          rate: line.rate,
          gstRate: line.gstRate,
        })),
      })
      setFlash(`Credit note ${result.number} issued for ${formatINR(result.total)}.`)
    })
    if (succeeded) {
      setCreating(false)
      resetForm()
    }
  }

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'party',
      label: 'Customer',
      render: (row) => (row.partyId ? (customerNames.get(row.partyId) ?? row.partyId) : '—'),
    },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'narration',
      label: 'Narration',
      render: (row) => <span className="text-slate-500 dark:text-slate-400">{row.narration || '—'}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Sales returns"
        subtitle="Credit notes issued to customers for returned goods"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New credit note
          </Button>
        }
      />

      {createTask.error && (
        <div className="mb-3">
          <Alert tone="error">{createTask.error}</Alert>
        </div>
      )}
      {flash && (
        <div className="mb-3">
          <Alert tone="success">{flash}</Alert>
        </div>
      )}

      <Card bodyClassName="">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={vouchers === undefined}
          empty="No sales returns raised yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New sales return"
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
              Issue credit note
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
          <Field label="Date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Narration">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reinstateStock}
            onChange={(event) => setReinstateStock(event.target.checked)}
          />
          Reinstate the returned goods into stock (at weighted-average cost)
        </label>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Returned items</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="th w-64">Item</th>
                  <th className="th">Description</th>
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
                    <tr key={line.key} className="border-b border-slate-100 dark:border-slate-800">
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
        title={detail ? `Credit note ${detail.number}` : 'Credit note'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail ? (
          detailEntries.loading ? (
            <Spinner />
          ) : (
            <VoucherPrint
              voucher={detail}
              entries={detailEntries.data ?? []}
              accountsById={accountsById}
              company={company}
              partyName={detail.partyId ? customerNames.get(detail.partyId) : undefined}
            />
          )
        ) : null}
      </Modal>
    </>
  )
}
