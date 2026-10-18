import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PurchaseRequisition } from '@/db/schema'
import {
  createRequisition,
  requisitionLines,
  setRequisitionStatus,
  type RequisitionLineInput,
} from '@/services/purchase'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'
import { DateInput, ItemSelect, MoneyInput, useMasters } from '@/components/pickers'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'

interface LineDraft {
  key: string
  itemId: string
  qty: string
  estimatedRate: Paise
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `prl-${keySeed}`
}

function emptyLine(): LineDraft {
  return { key: nextKey(), itemId: '', qty: '1', estimatedRate: 0 }
}

function numberValue(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function RequisitionsPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canApprove = can('purchase.approve')

  const { items } = useMasters()
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])

  const requisitions = useLiveQuery(() => db.purchaseRequisitions.toArray(), [])
  const rows = useMemo(
    () =>
      [...(requisitions ?? [])].sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
    [requisitions],
  )

  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<PurchaseRequisition | null>(null)
  const [rejecting, setRejecting] = useState<PurchaseRequisition | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const [date, setDate] = useState(todayISO())
  const [department, setDepartment] = useState('')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])

  const createTask = useTask()
  const actionTask = useTask()

  const detailLines = useAsync(
    () => (detail ? requisitionLines(detail.id) : Promise.resolve([])),
    [detail?.id],
  )

  const resetForm = () => {
    setDate(todayISO())
    setDepartment('')
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
      await createRequisition(actor(), {
        date,
        department: department.trim(),
        narration: narration.trim(),
        lines: validLines.map<RequisitionLineInput>((line) => ({
          itemId: line.itemId,
          qty: numberValue(line.qty),
          estimatedRate: line.estimatedRate,
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

  const columns: Array<Column<PurchaseRequisition>> = [
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'department', label: 'Department' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'narration',
      label: 'Narration',
      render: (row) => <span className="text-slate-500">{row.narration || '—'}</span>,
    },
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
              onClick={() => runAction(() => setRequisitionStatus(actor(), row.id, 'SUBMITTED'))}
            >
              Submit
            </Button>
          )}
          {row.status === 'SUBMITTED' && canApprove && (
            <>
              <Button
                variant="primary"
                disabled={actionTask.running}
                onClick={() => runAction(() => setRequisitionStatus(actor(), row.id, 'APPROVED'))}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                disabled={actionTask.running}
                onClick={() => {
                  setRejectReason('')
                  setRejecting(row)
                }}
              >
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Purchase requisitions"
        subtitle="Indents raised by departments ahead of ordering"
        actions={
          <Button variant="primary" onClick={openCreate}>
            New requisition
          </Button>
        }
      />

      {actionTask.error && (
        <div className="mb-3">
          <Alert tone="error">{actionTask.error}</Alert>
        </div>
      )}
      {actionTask.notice && (
        <div className="mb-3">
          <Alert tone="success">{actionTask.notice}</Alert>
        </div>
      )}

      <Card bodyClassName="">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={requisitions === undefined}
          empty="No requisitions raised yet."
          onRowClick={(row) => setDetail(row)}
        />
      </Card>

      {/* Create ---------------------------------------------------------- */}
      <Modal
        open={creating}
        title="New purchase requisition"
        onClose={() => setCreating(false)}
        width="max-w-4xl"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || validLines.length === 0}
              onClick={submitCreate}
            >
              Raise requisition
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
          <Field label="Date" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Department" required>
            <Input
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="e.g. Stores"
            />
          </Field>
          <Field label="Narration">
            <Input value={narration} onChange={(event) => setNarration(event.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Items</h3>
            <Button onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="th">Item</th>
                  <th className="th w-24 text-right">Qty</th>
                  <th className="th w-40 text-right">Est. rate</th>
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
                        onChange={(value) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key
                                ? {
                                    ...row,
                                    itemId: value,
                                    estimatedRate:
                                      row.estimatedRate ||
                                      items.find((item) => item.id === value)?.purchasePrice ||
                                      0,
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
                        value={line.estimatedRate}
                        onChange={(paise) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key ? { ...row, estimatedRate: paise } : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(Math.round(numberValue(line.qty) * line.estimatedRate))}
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
        title={detail ? `Requisition ${detail.number}` : 'Requisition'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label">Date</p>
                <p className="text-sm text-slate-700">{formatDate(detail.date)}</p>
              </div>
              <div>
                <p className="label">Department</p>
                <p className="text-sm text-slate-700">{detail.department || '—'}</p>
              </div>
              <div>
                <p className="label">Status</p>
                <StatusBadge status={detail.status} />
              </div>
              <div>
                <p className="label">Narration</p>
                <p className="text-sm text-slate-700">{detail.narration || '—'}</p>
              </div>
            </div>

            {detail.rejectionReason && (
              <div className="mt-3">
                <Alert tone="error">Rejected — {detail.rejectionReason}</Alert>
              </div>
            )}

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Requested items</h3>
              {detailLines.loading ? (
                <Spinner />
              ) : (detailLines.data ?? []).length === 0 ? (
                <EmptyState message="No lines on this requisition." />
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="th">Item</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Est. rate</th>
                      <th className="th text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailLines.data ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-2 py-2">{itemNames.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQty(line.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(line.estimatedRate)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatINR(Math.round(line.qty * line.estimatedRate))}
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

      {/* Reject ----------------------------------------------------------- */}
      <Modal
        open={rejecting !== null}
        title={rejecting ? `Reject ${rejecting.number}` : 'Reject requisition'}
        onClose={() => setRejecting(null)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={actionTask.running}
              onClick={async () => {
                const target = rejecting
                if (!target) return
                await runAction(() => setRequisitionStatus(actor(), target.id, 'REJECTED', rejectReason))
                setRejecting(null)
              }}
            >
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Shown to the requester. Optional but recommended.">
          <Textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
        </Field>
      </Modal>
    </>
  )
}
