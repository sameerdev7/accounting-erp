import { ACC } from '@/db/coa'
import type { Account } from '@/db/schema'
import { formatINR, type Paise } from '@/lib/money'
import {
  accountLabel,
  accountsOfType,
  buildBalanceMap,
  filterEntries,
  loadAccounts,
  loadLedger,
  netForAccount,
  type BalanceMap,
} from './core'
import { moneyColumn, textColumn, type ReportResult, type ReportRow } from './types'

/**
 * Accounts grouped as "other income" rather than trading margin. Keeping them
 * apart lets the statement show Gross Profit (trading) and Operating Profit
 * (trading + incidental income) without double counting anything.
 */
const OTHER_INCOME_CODES = new Set<string>([
  ACC.SERVICE_INCOME,
  ACC.INTEREST_INCOME,
  ACC.DISCOUNT_RECEIVED,
])

/**
 * The amount an account contributes to its statement section.
 *
 * A contra account (Sales Returns 4002, Purchase Returns 5002) is carried on
 * the opposite side of its type, so `netForAccount` returns a positive number
 * for it just like a normal account. Its section must be REDUCED, so the sign
 * is flipped here — and only here — to keep every report consistent.
 */
function contribution(account: Account, map: BalanceMap): Paise {
  const net = netForAccount(account, map)
  return account.isContra ? -net : net
}

/**
 * Profit & Loss, hierarchical and for an explicit period.
 *
 * Net profit is (all income) − (all expense) with contra signs applied, which
 * is exactly the figure the Balance Sheet adds to equity as "Profit for the
 * period". The two must always agree because no closing entries are posted.
 */
export async function profitAndLoss(opts: { from: string; to: string }): Promise<ReportResult> {
  const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
  const entries = filterEntries(ledger, opts.from, opts.to)
  const map = buildBalanceMap(entries)

  const income = accountsOfType(accounts, 'INCOME')
  const expenses = accountsOfType(accounts, 'EXPENSE')

  const tradingIncome = income.filter((account) => !OTHER_INCOME_CODES.has(account.code))
  const otherIncome = income.filter((account) => OTHER_INCOME_CODES.has(account.code))
  const cogs = expenses.filter((account) => account.code === ACC.COGS)
  const operatingExpenses = expenses.filter((account) => account.code !== ACC.COGS)

  const rows: ReportRow[] = []

  const incomeTotal = addSection(rows, 'section-income', 'Income', tradingIncome, map)
  const cogsTotal = addSection(rows, 'section-cogs', 'Less: Cost of Goods Sold', cogs, map)

  const grossProfit = incomeTotal - cogsTotal
  pushSubtotal(rows, 'gross-profit', 'Gross Profit', grossProfit)

  const otherIncomeTotal = addSection(rows, 'section-other-income', 'Other Income', otherIncome, map)
  const expensesTotal = addSection(rows, 'section-expenses', 'Expenses', operatingExpenses, map)

  const operatingProfit = grossProfit + otherIncomeTotal - expensesTotal
  pushSubtotal(rows, 'operating-profit', 'Operating Profit', operatingProfit)

  const netProfit = operatingProfit
  pushTotal(rows, 'net-profit', 'Net Profit Before Tax', netProfit)

  return {
    title: 'Profit & Loss',
    subtitle: `${opts.from} to ${opts.to}`,
    columns: [textColumn('particulars', 'Particulars'), moneyColumn('amount', 'Amount')],
    rows,
    totals: { amount: netProfit },
    highlights: [
      {
        label: 'Net Profit',
        value: formatINR(netProfit),
        tone: netProfit >= 0 ? 'positive' : 'negative',
      },
    ],
    notes: [
      'Contra accounts (Sales Returns, Purchase Returns) are shown as negative because they reduce the section they belong to.',
      'Inventory is valued by the periodic method: the cost of goods sold is opening stock plus purchases less closing stock, recognised when the period is closed. No year-end closing entries are posted, so this profit is also added to equity on the Balance Sheet.',
    ],
  }
}

/**
 * Emits a heading row followed by one row per account that moved, and returns
 * the section total. Accounts with no movement are omitted, but the heading is
 * always shown so the statement keeps its expected structure.
 */
function addSection(
  rows: ReportRow[],
  id: string,
  heading: string,
  accounts: Account[],
  map: BalanceMap,
): Paise {
  rows.push({ id, particulars: heading, emphasis: 'heading' })

  let total = 0
  for (const account of accounts) {
    const amount = contribution(account, map)
    if (amount === 0) continue
    total += amount
    rows.push({
      id: account.id,
      accountId: account.id,
      level: 1,
      particulars: accountLabel(account),
      amount,
      muted: account.isContra,
    })
  }
  return total
}

function pushSubtotal(rows: ReportRow[], id: string, particulars: string, amount: Paise): void {
  rows.push({ id, particulars, emphasis: 'subtotal', amount })
}

function pushTotal(rows: ReportRow[], id: string, particulars: string, amount: Paise): void {
  rows.push({ id, particulars, emphasis: 'total', amount })
}
