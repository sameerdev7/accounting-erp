import { db } from '@/db/schema'
import { currentFinancialYear } from '@/lib/dates'
import { monthKey } from '@/lib/dates'
import { formatMonthKey, todayISO } from '@/lib/format'
import type { Paise } from '@/lib/money'
import {
  buildBalanceMap,
  filterEntries,
  loadAccounts,
  loadLedger,
  netForAccount,
} from '@/reports/core'
import { queryAuditLog } from './audit'
import { gstPositionForMonth } from './gst'
import { totalInventoryValue } from './inventory'
import type { AuditLogEntry } from '@/db/schema'

export interface DashboardSeriesPoint {
  month: string
  label: string
  sales: Paise
  purchases: Paise
}

export interface DashboardSummary {
  cashAndBank: Paise
  receivables: Paise
  payables: Paise
  overdueReceivables: Paise
  inventoryValue: Paise
  revenue: Paise
  purchases: Paise
  expenses: Paise
  netProfit: Paise
  grossProfit: Paise
  gstMonth: string
  gstNet: Paise
  gstOutput: Paise
  gstInput: Paise
  pendingVouchers: number
  pendingRequisitions: number
  pendingPurchaseOrders: number
  draftInvoices: number
  openDebtorInvoices: number
  openCreditorInvoices: number
  /** Ledger-wide debit and credit totals — equal when the books balance. */
  trialDebit: Paise
  trialCredit: Paise
  trialBalanced: boolean
  series: DashboardSeriesPoint[]
  recentActivity: AuditLogEntry[]
}

/**
 * Every headline figure on the dashboard, computed on demand from the ledger and
 * the documents. Nothing here is cached or stored — the same discipline the rest
 * of the application follows.
 */
export async function dashboardSummary(): Promise<DashboardSummary> {
  const today = todayISO()
  const fy = currentFinancialYear(today)

  const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
  const all = buildBalanceMap(ledger)
  const period = buildBalanceMap(filterEntries(ledger, fy.start, today))

  // Ledger-wide control total: every posting is balanced by construction, so
  // these two must be equal. The dashboard surfaces it so the invariant is
  // visible rather than merely asserted in tests.
  let trialDebit = 0
  let trialCredit = 0
  for (const entry of ledger) {
    trialDebit += entry.debit
    trialCredit += entry.credit
  }

  // Cash & bank: the debit-normal balances of the cash and bank accounts.
  const cashAndBank = accounts
    .filter((account) => account.isCash || account.isBank)
    .reduce((total, account) => total + netForAccount(account, all), 0)

  // Profit & loss for the financial year to date, with contra signs applied —
  // identical arithmetic to the Profit & Loss report.
  const contribution = (accountId: string, type: 'INCOME' | 'EXPENSE'): Paise => {
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account || account.type !== type) return 0
    const net = netForAccount(account, period)
    return account.isContra ? -net : net
  }

  let revenue = 0
  let grossProfitIncome = 0
  const cogsAccounts = accounts.filter((account) => account.code === '5003')
  const salesAccounts = accounts.filter((account) => account.code === '4001' || account.code === '4002')
  for (const account of accounts) {
    if (account.type === 'INCOME') revenue += contribution(account.id, 'INCOME')
  }
  let expenses = 0
  for (const account of accounts) {
    if (account.type === 'EXPENSE') expenses += contribution(account.id, 'EXPENSE')
  }
  for (const account of salesAccounts) grossProfitIncome += contribution(account.id, 'INCOME')
  let cogs = 0
  for (const account of cogsAccounts) cogs += contribution(account.id, 'EXPENSE')

  const netProfit = revenue - expenses
  const grossProfit = grossProfitIncome - cogs

  // Parties: recompute outstanding from invoices less allocations.
  const [invoices, allocations] = await Promise.all([db.invoices.toArray(), db.allocations.toArray()])
  const settled = new Map<string, number>()
  for (const allocation of allocations) {
    settled.set(allocation.invoiceId, (settled.get(allocation.invoiceId) ?? 0) + allocation.amount)
  }

  let receivables = 0
  let payable = 0
  let overdueReceivables = 0
  let openDebtorInvoices = 0
  let openCreditorInvoices = 0
  let purchases = 0
  for (const invoice of invoices) {
    if (invoice.date > today) continue
    if (invoice.status === 'DRAFT') continue
    if (invoice.date >= fy.start && invoice.type === 'PURCHASE') purchases += invoice.taxable
    const outstanding = invoice.total - (settled.get(invoice.id) ?? 0)
    if (outstanding <= 0) continue
    if (invoice.type === 'SALES') {
      receivables += outstanding
      openDebtorInvoices += 1
      if (invoice.dueDate < today) overdueReceivables += outstanding
    } else {
      payable += outstanding
      openCreditorInvoices += 1
    }
  }

  const gstMonth = monthKey(today)
  const gst = await gstPositionForMonth(gstMonth)

  const [pendingVouchers, pendingRequisitions, pendingPurchaseOrders, draftInvoices, inventoryValue, recentActivity] =
    await Promise.all([
      db.vouchers.where('status').equals('PENDING').count(),
      db.purchaseRequisitions.where('status').equals('SUBMITTED').count(),
      db.purchaseOrders.where('status').equals('DRAFT').count(),
      db.invoices.where('status').equals('DRAFT').count(),
      totalInventoryValue(),
      queryAuditLog({ limit: 12 }),
    ])

  // Twelve-month trading trend: posted invoice totals grouped by month.
  const byMonth = new Map<string, { sales: number; purchases: number }>()
  for (const invoice of invoices) {
    if (invoice.type !== 'SALES' && invoice.type !== 'PURCHASE') continue
    if (invoice.status === 'DRAFT') continue
    const key = monthKey(invoice.date)
    const bucket = byMonth.get(key) ?? { sales: 0, purchases: 0 }
    if (invoice.type === 'SALES') bucket.sales += invoice.total
    else bucket.purchases += invoice.total
    byMonth.set(key, bucket)
  }

  const series: DashboardSeriesPoint[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, totals]) => ({
      month,
      label: formatMonthKey(month),
      sales: totals.sales,
      purchases: totals.purchases,
    }))

  return {
    cashAndBank,
    receivables,
    payables: payable,
    overdueReceivables,
    inventoryValue,
    revenue,
    purchases,
    expenses,
    netProfit,
    grossProfit,
    gstMonth,
    gstNet: gst.netPayable,
    gstOutput: gst.outputTotal,
    gstInput: gst.inputTotal,
    pendingVouchers,
    pendingRequisitions,
    pendingPurchaseOrders,
    draftInvoices,
    openDebtorInvoices,
    openCreditorInvoices,
    trialDebit,
    trialCredit,
    trialBalanced: trialDebit === trialCredit,
    series,
    recentActivity,
  }
}
