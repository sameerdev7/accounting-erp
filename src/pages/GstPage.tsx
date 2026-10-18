import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  gstPayableBalance,
  gstPositionForMonth,
  gstYearOverview,
  payGst,
  settleGst,
  type GstYearRow,
} from '@/services/gst'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatMonthKey, todayISO } from '@/lib/format'
import { monthKey } from '@/lib/dates'
import { formatINR } from '@/lib/money'
import { DataTable, type Column } from '@/components/DataTable'
import { DateInput, MoneyInput } from '@/components/pickers'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  StatCard,
} from '@/components/ui'

export function GstPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)

  const [month, setMonth] = useState(() => monthKey(todayISO()))
  const position = useAsync(() => gstPositionForMonth(month), [month])
  const year = useAsync(() => gstYearOverview(todayISO()), [])
  const balance = useAsync(() => gstPayableBalance(), [])

  const settleTask = useTask()
  const payTask = useTask()

  const [payAmount, setPayAmount] = useState(0)
  const [payDate, setPayDate] = useState(() => todayISO())
  const [payNarration, setPayNarration] = useState('')

  useEffect(() => {
    if (balance.data !== null) setPayAmount(balance.data)
  }, [balance.data])

  const positionData = position.data
  const net = positionData?.netPayable ?? 0

  const handleSettle = (row: GstYearRow) =>
    settleTask.run(async () => {
      const result = await settleGst(actor(), { month: row.month })
      settleTask.setNotice(
        `Settled ${formatMonthKey(row.month)} — net ${formatINR(result.net)} (voucher ${result.number})`,
      )
      year.reload()
      balance.reload()
    })

  const handlePay = () =>
    payTask.run(async () => {
      await payGst(actor(), {
        amount: payAmount,
        date: payDate,
        narration: payNarration || undefined,
      })
      payTask.setNotice('GST payment posted')
      balance.reload()
      setPayNarration('')
    })

  const yearColumns: Array<Column<GstYearRow>> = [
    { key: 'label', label: 'Month' },
    { key: 'outputTotal', label: 'Output', align: 'right', money: true, total: true },
    { key: 'inputTotal', label: 'Input', align: 'right', money: true, total: true },
    { key: 'net', label: 'Net payable', align: 'right', money: true, total: true },
    {
      key: 'settled',
      label: 'Status',
      render: (row) =>
        row.isFuture ? (
          <Badge tone="slate">Future</Badge>
        ) : row.settled ? (
          <Badge tone="green">Settled</Badge>
        ) : (
          <Badge tone="amber">Unsettled</Badge>
        ),
    },
    {
      key: 'action',
      label: '',
      align: 'right',
      render: (row) =>
        !row.settled && !row.isFuture && can('gst.settle') ? (
          <Button
            variant="secondary"
            disabled={settleTask.running}
            onClick={() => handleSettle(row)}
          >
            Settle
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="GST"
        subtitle="Output and input tax position, monthly settlement and payments"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Month">
              <Input
                type="month"
                value={month}
                onChange={(event) => {
                  if (event.target.value) setMonth(event.target.value)
                }}
              />
            </Field>
            <Link className="link text-sm" to="/reports/gstr1">
              GSTR-1
            </Link>
            <Link className="link text-sm" to="/reports/gstr3b">
              GSTR-3B
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Output CGST" value={formatINR(positionData?.outputCgst ?? 0)} />
        <StatCard label="Output SGST" value={formatINR(positionData?.outputSgst ?? 0)} />
        <StatCard label="Output IGST" value={formatINR(positionData?.outputIgst ?? 0)} />
        <StatCard label="Input CGST" value={formatINR(positionData?.inputCgst ?? 0)} />
        <StatCard label="Input SGST" value={formatINR(positionData?.inputSgst ?? 0)} />
        <StatCard label="Input IGST" value={formatINR(positionData?.inputIgst ?? 0)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Output tax total" value={formatINR(positionData?.outputTotal ?? 0)} />
        <StatCard label="Input tax total" value={formatINR(positionData?.inputTotal ?? 0)} />
        <StatCard
          label="Net payable"
          value={formatINR(net)}
          tone={net > 0 ? 'warning' : 'positive'}
          hint={net < 0 ? 'Credit carried forward' : undefined}
        />
        <StatCard label="GST payable balance" value={formatINR(balance.data ?? 0)} />
      </div>

      {position.error && (
        <div className="mt-3">
          <Alert tone="error">{position.error}</Alert>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={`Year overview — ${month ? formatMonthKey(month) : 'no month selected'}`} className="mt-0 xl:col-span-2">
          {settleTask.error && (
            <div className="mb-3">
              <Alert tone="error">{settleTask.error}</Alert>
            </div>
          )}
          {settleTask.notice && (
            <div className="mb-3">
              <Alert tone="success">{settleTask.notice}</Alert>
            </div>
          )}
          <DataTable
            columns={yearColumns}
            rows={year.data ?? []}
            getRowId={(row) => row.month}
            loading={year.loading}
            empty="No GST activity this financial year."
          />
        </Card>

        <Card
          title="Pay GST"
          actions={
            can('gst.settle') ? (
              <Button
                variant="primary"
                disabled={payTask.running || payAmount <= 0}
                onClick={handlePay}
              >
                {payTask.running ? 'Paying…' : 'Pay'}
              </Button>
            ) : null
          }
        >
          {payTask.error && (
            <div className="mb-3">
              <Alert tone="error">{payTask.error}</Alert>
            </div>
          )}
          {payTask.notice && (
            <div className="mb-3">
              <Alert tone="success">{payTask.notice}</Alert>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            <Field label="Amount" required hint={`Payable balance ${formatINR(balance.data ?? 0)}`}>
              <MoneyInput value={payAmount} onChange={setPayAmount} />
            </Field>
            <Field label="Date" required>
              <DateInput value={payDate} onChange={setPayDate} />
            </Field>
            <Field label="Narration">
              <Input
                value={payNarration}
                onChange={(event) => setPayNarration(event.target.value)}
                placeholder="GST paid to the government"
              />
            </Field>
          </div>
        </Card>
      </div>
    </>
  )
}
