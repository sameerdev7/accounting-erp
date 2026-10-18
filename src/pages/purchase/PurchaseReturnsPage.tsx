import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Voucher } from '@/db/schema'
import { createPurchaseReturn } from '@/services/purchase'
import { entriesForVoucher, VOUCHER_TYPE_LABELS } from '@/services/ledger'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { DateInput, ItemSelect, MoneyInput, PartySelect, useAccountMap, useMasters } from '@/components/pickers'
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
import { VoucherActions } from '@/components/VoucherActions'

const GST_RATES = [0, 5, 12, 18, 28]

interface LineDraft {
  key: string
  itemId: string
  description: string
  qty: string
  rate: Paise
  gstRate: string
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `dnl-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', description: '', qty: '1', rate: 0, gstRate: '18' }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function PurchaseReturnsPage() {
  const actor = useSession((state) => state.actor)

  const { items, suppliers } = useMasters()
  const accountsById = useAccountMap()
  const supplierNames = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  )

  const vouchers = useLiveQuery(() => db.vouchers.where('type').equals('DEBIT_NOTE').toArray(), [])

  const rows = useMemo(
    () =>
      [...(vouchers ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [vouchers],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<Voucher | null>(null)

  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()

  const detailEntries = useAsync(
    () => (detail ? entriesForVoucher(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const resetForm = () => {
    setSupplierId('')
    setDate(todayISO())
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

  const validLines = lines.filter((line) => line.description.trim() && numberValue(line.qty) > 0)

  const submitCreate = async () => {
    const succeeded = await createTask.run(async () => {
      const result = await createPurchaseReturn(actor(), {
        supplierId,
        date,
        narration: narration.trim(),
        lines: validLines.map((line) => ({
          itemId: line.itemId || null,
          description: line.description.trim(),
          qty: numberValue(line.qty),
          rate: line.rate,
          gstRate: numberValue(line.gstRate),
        })),
      })
      createTask.setNotice(
        `Debit note ${result.number} raised for ${formatINR(result.total)}. It now awaits approval.`,
      )
    })
    if (succeeded) {
      resetForm()
    }
  }

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'partyId',
      label: 'Supplier',
      render: (row) => (row.partyId ? supplierNames.get(row.partyId) ?? row.partyId : '—'),
    },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'narration',
      label: 'Narration',
      render: (row) => <span className="text-slate-500">{row.narration || '—'}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Purchase returns"
        subtitle="Debit notes raised on suppliers for goods returned"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New debit note
          </Button>
        }
      />

      {createTask.notice && (
        <div className="mb-3">
          <Alert tone="success">{createTask.notice}</Alert>
        </div>
      )}

      <Card bodyClassName="">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={vouchers === undefined}
          empty="No purchase returns recorded yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New purchase return (debit note)"
        onClose={() => setCreating(false)}
        width="max-w-5xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Close</Button>
            <Button
              variant="primary"
              disabled={createTask.running || !supplierId || validLines.length === 0}
              onClick={submitCreate}
            >
              Raise debit note
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}
        {createTask.notice && (
          <div className="mb-3">
            <Alert tone="success">{createTask.notice}</Alert>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Supplier" required>
            <PartySelect value={supplierId} onChange={setSupplierId} parties={suppliers} />
          </Field>
          <Field label="Date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Narration">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Returned items</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="th">Item</th>
                  <th className="th">Description</th>
                  <th className="th w-24 text-right">Qty</th>
                  <th className="th w-36 text-right">Rate</th>
                  <th className="th w-24">GST %</th>
                  <th className="th w-16" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100">
                    <td className="px-2 py-2 min-w-[12rem]">
                      <ItemSelect
                        value={line.itemId}
                        onChange={(value) => {
                          const item = items.find((candidate) => candidate.id === value)
                          updateLine(line.key, {
                            itemId: value,
                            description: line.description || item?.name || '',
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
                        onChange={(event) =>
                          updateLine(line.key, { description: event.target.value })
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
        </div>
      </Modal>

      {/* Detail ----------------------------------------------------------- */}
      <Modal
        open={detail !== null}
        title={detail ? `${VOUCHER_TYPE_LABELS[detail.type]} ${detail.number}` : 'Debit note'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Supplier</p>
                <p className="text-sm text-slate-700">
                  {detail.partyId ? supplierNames.get(detail.partyId) ?? detail.partyId : '—'}
                </p>
              </div>
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Amount</p>
                <p className="text-sm text-slate-700 tabular-nums">{formatINR(detail.amount)}</p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Ledger lines</h3>
              {detailEntries.loading ? (
                <Spinner />
              ) : (detailEntries.data ?? []).length === 0 ? (
                <EmptyState message="This voucher has not been posted yet, so it has no ledger entries." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="th">Account</th>
                      <th className="th text-right">Debit</th>
                      <th className="th text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailEntries.data ?? []).map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100">
                        <td className="px-2 py-2">
                          {accountsById.get(entry.accountId)?.name ?? entry.accountId}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {entry.debit ? formatINR(entry.debit) : ''}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {entry.credit ? formatINR(entry.credit) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <VoucherActions voucher={detail} />
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
