import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatINR, toRupees } from '@/lib/money'
import { formatDateTime, formatMonthKey } from '@/lib/format'
import { dashboardSummary } from '@/services/dashboard'
import { useAsync } from '@/hooks/async'
import { useTheme } from '@/store/theme'
import { Card, PageHeader, Spinner, StatCard, StatusBadge, Alert } from '@/components/ui'

export function DashboardPage() {
  const { data, loading, error } = useAsync(() => dashboardSummary(), [])
  const isDark = useTheme((state) => state.resolved) === 'dark'

  const gridStroke = isDark ? '#1e293b' : '#e2e8f0'
  const lineStroke = isDark ? '#598bff' : '#2049db'

  if (loading || !data) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Position as at today" />
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <Spinner label="Tallying the books…" />
        )}
      </>
    )
  }

  const chartData = data.series.map((point) => ({
    month: point.label,
    Sales: toRupees(point.sales),
    Purchases: toRupees(point.purchases),
  }))

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Sai Electronics & Appliances — financial position derived live from the ledger"
      />

      <div className="mb-4">
        {data.trialBalanced ? (
          <Alert tone="success">
            Trial Balance balanced ✓ — debits and credits each {formatINR(data.trialDebit)} across{' '}
            {data.series.length} months of trading.
          </Alert>
        ) : (
          <Alert tone="error">
            The ledger is out of balance: debits {formatINR(data.trialDebit)} vs credits{' '}
            {formatINR(data.trialCredit)}.
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sales (FY to date)" value={formatINR(data.revenue)} hint="All income" />
        <StatCard label="Purchases (FY to date)" value={formatINR(data.purchases)} hint="Goods for resale" />
        <StatCard
          label="Receivables"
          value={formatINR(data.receivables)}
          hint={`${data.openDebtorInvoices} open invoices`}
          tone={data.overdueReceivables > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Payables"
          value={formatINR(data.payables)}
          hint={`${data.openCreditorInvoices} open invoices`}
        />
        <StatCard label="Cash & Bank" value={formatINR(data.cashAndBank)} hint="Ledger balances" />
        <StatCard label="Expenses (FY to date)" value={formatINR(data.expenses)} hint="Incl. cost of goods sold" />
        <StatCard
          label="Profit (FY to date)"
          value={formatINR(data.netProfit)}
          tone={data.netProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Inventory at cost" value={formatINR(data.inventoryValue)} hint="Closing stock" />
      </div>

      <div className="mt-4">
        <Card title={`GST position — ${formatMonthKey(data.gstMonth)}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Output tax
              </p>
              <p className="mt-0.5 text-slate-800 dark:text-slate-200">{formatINR(data.gstOutput)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Input tax
              </p>
              <p className="mt-0.5 text-slate-800 dark:text-slate-200">{formatINR(data.gstInput)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Net payable to government
              </p>
              <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                {formatINR(data.gstNet)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Trading trend — invoices by month" className="xl:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(value) => `₹${Math.round(Number(value) / 1000)}k`} />
                <Tooltip formatter={(value: number) => formatINR(Math.round(value * 100))} />
                <Legend />
                <Bar dataKey="Sales" fill="#3366f2" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Purchases" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Cash position trend">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData.map((point, index) => ({
                  month: point.month,
                  Net: point.Sales - point.Purchases,
                  index,
                }))}
                margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(value) => `₹${Math.round(Number(value) / 1000)}k`} />
                <Tooltip formatter={(value: number) => formatINR(Math.round(value * 100))} />
                <Line type="monotone" dataKey="Net" stroke={lineStroke} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Awaiting action">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <ActionRow label="Vouchers pending approval" count={data.pendingVouchers} to="/vouchers" />
            <ActionRow
              label="Requisitions awaiting approval"
              count={data.pendingRequisitions}
              to="/purchase/requisitions"
            />
            <ActionRow
              label="Purchase orders in draft"
              count={data.pendingPurchaseOrders}
              to="/purchase/orders"
            />
            <ActionRow label="Draft invoices" count={data.draftInvoices} to="/sales/invoices" />
          </ul>
        </Card>

        <Card title="Recent activity">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recentActivity.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="text-slate-700 dark:text-slate-300">{entry.summary}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {entry.username} · {formatDateTime(entry.ts)}
                  </p>
                </div>
                <StatusBadge status={entry.action} />
              </li>
            ))}
            {data.recentActivity.length === 0 && (
              <li className="py-2 text-sm text-slate-400 dark:text-slate-500">No activity yet.</li>
            )}
          </ul>
        </Card>
      </div>
    </>
  )
}

function ActionRow({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-slate-700 dark:text-slate-300">{label}</span>
      <span className="flex items-center gap-3">
        <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{count}</span>
        <Link className="link text-xs" to={to}>
          Open
        </Link>
      </span>
    </li>
  )
}
