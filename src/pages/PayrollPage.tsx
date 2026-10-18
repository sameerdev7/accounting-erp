import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { PayrollRun, Payslip } from '@/db/schema'
import { db } from '@/db/schema'
import {
  listPayrollRuns,
  paySalary,
  payslipsForRun,
  previewPayroll,
  remitStatutory,
  runPayroll,
  statutoryBalance,
  summarisePayroll,
  type PayslipComputation,
  type StatutoryLiability,
} from '@/services/payroll'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatMonthKey, todayISO } from '@/lib/format'
import { monthKey } from '@/lib/dates'
import { formatINR } from '@/lib/money'
import { DataTable, type Column } from '@/components/DataTable'
import { DateInput, MoneyInput } from '@/components/pickers'
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
} from '@/components/ui'

const LIABILITIES: StatutoryLiability[] = ['PF', 'PT', 'TDS']

export function PayrollPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)

  const [month, setMonth] = useState(() => monthKey(todayISO()))
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const preview = useAsync(() => previewPayroll(month), [month])
  const runs = useAsync(() => listPayrollRuns(), [])
  const slips = useAsync(
    () => (selectedRunId ? payslipsForRun(selectedRunId) : Promise.resolve<Payslip[]>([])),
    [selectedRunId],
  )
  const balances = useAsync(
    () => Promise.all(LIABILITIES.map((liability) => statutoryBalance(liability))),
    [],
  )

  const employees = useLiveQuery(() => db.employees.toArray(), [])
  const employeeName = (employeeId: string) =>
    employees?.find((employee) => employee.id === employeeId)?.name ?? '—'

  const runTask = useTask()
  const payTask = useTask()
  const remitTask = useTask()

  const [payDate, setPayDate] = useState(() => todayISO())
  const [remitOpen, setRemitOpen] = useState(false)
  const [remitLiability, setRemitLiability] = useState<StatutoryLiability>('PF')
  const [remitAmount, setRemitAmount] = useState(0)
  const [remitDate, setRemitDate] = useState(() => todayISO())
  const [remitNarration, setRemitNarration] = useState('')

  const totals = useMemo(() => summarisePayroll(preview.data ?? []), [preview.data])
  const balanceRows = balances.data ?? [0, 0, 0]
  const balanceFor = (liability: StatutoryLiability): number => {
    const index = LIABILITIES.indexOf(liability)
    return balanceRows[index] ?? 0
  }

  const selectedRun = (runs.data ?? []).find((run) => run.id === selectedRunId) ?? null

  const previewColumns: Array<Column<PayslipComputation>> = [
    {
      key: 'employee',
      label: 'Employee',
      render: (row) => `${row.employeeCode} — ${row.employeeName}`,
    },
    {
      key: 'days',
      label: 'Days',
      align: 'right',
      render: (row) => `${row.daysPresent}/${row.daysInMonth}`,
    },
    { key: 'gross', label: 'Gross', align: 'right', money: true, total: true },
    { key: 'pfEmployee', label: 'PF', align: 'right', money: true, total: true },
    { key: 'pt', label: 'PT', align: 'right', money: true, total: true },
    { key: 'tds', label: 'TDS', align: 'right', money: true, total: true },
    { key: 'net', label: 'Net', align: 'right', money: true, total: true },
  ]

  const runColumns: Array<Column<PayrollRun>> = [
    { key: 'month', label: 'Month', render: (row) => formatMonthKey(row.month) },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'employeeCount', label: 'Employees', align: 'right' },
    { key: 'grossTotal', label: 'Gross', align: 'right', money: true, total: true },
    { key: 'netTotal', label: 'Net', align: 'right', money: true, total: true },
  ]

  const slipColumns: Array<Column<Payslip>> = [
    { key: 'employeeId', label: 'Employee', render: (row) => employeeName(row.employeeId) },
    {
      key: 'days',
      label: 'Days',
      align: 'right',
      render: (row) => `${row.daysPresent}/${row.daysInMonth}`,
    },
    { key: 'gross', label: 'Gross', align: 'right', money: true, total: true },
    { key: 'pf', label: 'PF', align: 'right', money: true, total: true },
    { key: 'pt', label: 'PT', align: 'right', money: true, total: true },
    { key: 'tds', label: 'TDS', align: 'right', money: true, total: true },
    { key: 'net', label: 'Net', align: 'right', money: true, total: true },
  ]

  const handleRunPayroll = () =>
    runTask.run(async () => {
      const run = await runPayroll(actor(), month)
      runTask.setNotice(`Payroll posted for ${formatMonthKey(run.month)}`)
      setSelectedRunId(run.id)
      preview.reload()
      runs.reload()
      balances.reload()
    })

  const handlePaySalary = () =>
    payTask.run(async () => {
      if (!selectedRunId) return
      await paySalary(actor(), selectedRunId, { date: payDate })
      payTask.setNotice('Salary payment posted')
    })

  const handleRemit = () =>
    remitTask.run(async () => {
      await remitStatutory(actor(), {
        liability: remitLiability,
        amount: remitAmount,
        date: remitDate,
        narration: remitNarration || undefined,
      })
      remitTask.setNotice(`${remitLiability} remittance posted`)
      balances.reload()
      setRemitOpen(false)
      setRemitAmount(0)
      setRemitNarration('')
    })

  const openRemit = (liability: StatutoryLiability) => {
    setRemitLiability(liability)
    setRemitAmount(balanceFor(liability))
    setRemitDate(todayISO())
    setRemitNarration('')
    remitTask.reset()
    setRemitOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Salary computation, monthly runs, payouts and statutory remittances"
        actions={
          <Field label="Month">
            <Input
              type="month"
              value={month}
              onChange={(event) => {
                if (event.target.value) setMonth(event.target.value)
              }}
            />
          </Field>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Gross" value={formatINR(totals.gross)} />
        <StatCard label="PF (employee)" value={formatINR(totals.pfEmployee)} />
        <StatCard label="PF (employer)" value={formatINR(totals.pfEmployer)} />
        <StatCard label="PT" value={formatINR(totals.pt)} />
        <StatCard label="TDS" value={formatINR(totals.tds)} />
        <StatCard label="Net payable" value={formatINR(totals.net)} tone="warning" />
      </div>

      <Card
        title={`Preview — ${month ? formatMonthKey(month) : 'no month selected'}`}
        className="mt-4"
        actions={
          can('payroll.run') ? (
            <Button
              variant="primary"
              disabled={runTask.running || !month || preview.loading}
              onClick={handleRunPayroll}
            >
              {runTask.running ? 'Running…' : 'Run payroll'}
            </Button>
          ) : null
        }
      >
        {runTask.error && (
          <div className="mb-3">
            <Alert tone="error">{runTask.error}</Alert>
          </div>
        )}
        {runTask.notice && (
          <div className="mb-3">
            <Alert tone="success">{runTask.notice}</Alert>
          </div>
        )}
        <DataTable
          columns={previewColumns}
          rows={preview.data ?? []}
          getRowId={(row) => row.employeeId}
          loading={preview.loading}
          empty="No active employees to preview."
        />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Payroll runs" className="mt-0">
          <DataTable
            columns={runColumns}
            rows={runs.data ?? []}
            getRowId={(row) => row.id}
            loading={runs.loading}
            empty="No payroll has been run yet."
            onRowClick={(row) => setSelectedRunId(row.id)}
            rowClassName={(row) => (row.id === selectedRunId ? 'bg-brand-50' : '')}
          />
        </Card>

        <Card title="Statutory liabilities">
          <DataTable
            columns={[
              { key: 'liability', label: 'Liability' },
              { key: 'balance', label: 'Outstanding', align: 'right', money: true },
              {
                key: 'action',
                label: '',
                align: 'right',
                render: (row: { liability: StatutoryLiability; balance: number }) =>
                  can('payroll.run') ? (
                    <Button variant="secondary" onClick={() => openRemit(row.liability)}>
                      Remit
                    </Button>
                  ) : null,
              },
            ]}
            rows={LIABILITIES.map((liability) => ({ liability, balance: balanceFor(liability) }))}
            getRowId={(row) => row.liability}
            loading={balances.loading}
            empty="No statutory liabilities."
          />
          {balances.error && (
            <div className="mt-3">
              <Alert tone="error">{balances.error}</Alert>
            </div>
          )}
        </Card>
      </div>

      {selectedRun && (
        <Card
          title={`Payslips — ${formatMonthKey(selectedRun.month)}`}
          className="mt-4"
          actions={
            can('payroll.run') ? (
              <div className="flex items-end gap-2">
                <Field label="Payment date">
                  <DateInput value={payDate} onChange={setPayDate} />
                </Field>
                <Button
                  variant="primary"
                  disabled={payTask.running}
                  onClick={handlePaySalary}
                >
                  {payTask.running ? 'Paying…' : 'Pay salary'}
                </Button>
              </div>
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
          <p className="mb-3 text-sm text-slate-500">
            Net payout for this run: <span className="font-semibold">{formatINR(selectedRun.netTotal)}</span>
          </p>
          <DataTable
            columns={slipColumns}
            rows={slips.data ?? []}
            getRowId={(row) => row.id}
            loading={slips.loading}
            empty="No payslips for this run."
          />
        </Card>
      )}

      <Modal
        open={remitOpen}
        title={`Remit ${remitLiability}`}
        onClose={() => setRemitOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setRemitOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={remitTask.running || remitAmount <= 0}
              onClick={handleRemit}
            >
              {remitTask.running ? 'Posting…' : 'Post remittance'}
            </Button>
          </>
        }
      >
        {remitTask.error && (
          <div className="mb-3">
            <Alert tone="error">{remitTask.error}</Alert>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Liability" required>
            <Select
              value={remitLiability}
              onChange={(event) => {
                const liability = event.target.value as StatutoryLiability
                setRemitLiability(liability)
                setRemitAmount(balanceFor(liability))
              }}
            >
              {LIABILITIES.map((liability) => (
                <option key={liability} value={liability}>
                  {liability}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required hint={`Outstanding ${formatINR(balanceFor(remitLiability))}`}>
            <MoneyInput value={remitAmount} onChange={setRemitAmount} />
          </Field>
          <Field label="Date" required>
            <DateInput value={remitDate} onChange={setRemitDate} />
          </Field>
          <Field label="Narration">
            <Input value={remitNarration} onChange={(event) => setRemitNarration(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
