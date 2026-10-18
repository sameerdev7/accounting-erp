import type { Account, AccountType } from '@/db/schema'
import { formatINR, type Paise } from '@/lib/money'
import {
  accountLabel,
  accountsOfType,
  buildBalanceMap,
  childrenByParent,
  descendantsOf,
  filterEntries,
  loadAccounts,
  loadLedger,
  netForAccount,
  rootAccounts,
  rollupNet,
  type BalanceMap,
} from './core'
import { moneyColumn, textColumn, type ReportResult, type ReportRow } from './types'

/**
 * Balance Sheet as on a date — cumulative ledger from the beginning of time up
 * to `asOn`.
 *
 * No closing entries are ever posted, so the income and expense accounts still
 * carry their balances. They are collapsed into a synthetic "Profit for the
 * period" line in Equity, which is why Assets = Liabilities + Equity always
 * holds for a balanced ledger.
 */
export async function balanceSheet(opts: { asOn: string }): Promise<ReportResult> {
  const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
  const entries = filterEntries(ledger, undefined, opts.asOn)
  const map = buildBalanceMap(entries)
  const byParent = childrenByParent(accounts)

  const assets = accountsOfType(accounts, 'ASSET')
  const liabilities = accountsOfType(accounts, 'LIABILITY')
  const equity = accountsOfType(accounts, 'EQUITY')

  const rows: ReportRow[] = []
  const assetsTotal = addTypeSection(rows, 'ASSETS', 'ASSETS', assets, map, byParent)
  const liabilitiesTotal = addTypeSection(
    rows,
    'LIABILITIES',
    'LIABILITIES',
    liabilities,
    map,
    byParent,
  )
  let equityTotal = addTypeSection(rows, 'EQUITY', 'EQUITY', equity, map, byParent)

  // Income and expense accounts are not "closed" into Retained Earnings, so we
  // synthesise the current-year profit and present it as equity. This is what
  // makes the sheet balance on demand.
  const profit = profitForPeriod(accounts, map)
  equityTotal += profit
  rows.push({
    id: 'profit-for-period',
    level: 0,
    particulars: 'Profit for the period',
    amount: profit,
    emphasis: 'subtotal',
  })

  const liabilitiesPlusEquity = liabilitiesTotal + equityTotal
  const difference = assetsTotal - liabilitiesPlusEquity
  const balanced = difference === 0

  const result: ReportResult = {
    title: 'Balance Sheet',
    subtitle: `As on ${opts.asOn}`,
    columns: [textColumn('particulars', 'Particulars'), moneyColumn('amount', 'Amount')],
    rows,
    totals: {
      assets: assetsTotal,
      liabilities: liabilitiesTotal,
      equity: equityTotal,
    },
    highlights: [
      {
        label: 'Assets = Liabilities + Equity',
        value: balanced ? 'Balanced ✓' : 'Out of balance ✗',
        tone: balanced ? 'positive' : 'negative',
      },
      { label: 'Total Assets', value: formatINR(assetsTotal) },
      { label: 'Total Liabilities + Equity', value: formatINR(liabilitiesPlusEquity) },
    ],
    notes: [
      'Control accounts are shown at their rolled-up total; party sub-ledgers are listed beneath, de-emphasised, and are not added again.',
      'Profit for the period equals the P&L net profit, added to equity because no closing entries are posted.',
    ],
  }

  if (!balanced) {
    result.warnings = [
      `The Balance Sheet is out of balance by ${formatINR(difference)} (Assets ${formatINR(assetsTotal)} vs Liabilities + Equity ${formatINR(liabilitiesPlusEquity)}). A ledger line may reference an account that is not in the chart of accounts.`,
    ]
  }

  return result
}

/**
 * Renders a whole statement section. Roots are the only accounts added to the
 * section total: a control account's roll-up already contains its sub-ledgers,
 * so listing them underneath is presentation only, never a second addition.
 */
function addTypeSection(
  rows: ReportRow[],
  id: string,
  heading: string,
  accounts: Account[],
  map: BalanceMap,
  byParent: Map<string, Account[]>,
): Paise {
  const roots = rootAccounts(accounts)

  let total = 0
  let wrote = false

  for (const root of roots) {
    const descendants = descendantsOf(root.id, byParent)
    const amount = signedRollup(root, map, byParent)

    const children = descendants
      .map((child) => ({ account: child, amount: contribution(child, map) }))
      .filter((child) => child.amount !== 0)

    if (amount === 0 && children.length === 0) continue

    if (!wrote) {
      rows.push({ id, particulars: heading, emphasis: 'heading' })
      wrote = true
    }

    total += amount

    if (descendants.length > 0) {
      // Control account: show the rolled-up figure as a subtotal, then each
      // party sub-ledger indented beneath it.
      rows.push({
        id: root.id,
        accountId: root.id,
        level: 0,
        particulars: accountLabel(root),
        amount,
        emphasis: 'subtotal',
        muted: children.length === 0,
      })
      for (const child of children) {
        rows.push({
          id: child.account.id,
          accountId: child.account.id,
          level: 1,
          particulars: accountLabel(child.account),
          amount: child.amount,
          muted: true,
        })
      }
    } else {
      rows.push({
        id: root.id,
        accountId: root.id,
        level: 0,
        particulars: accountLabel(root),
        amount,
        muted: root.isContra,
      })
    }
  }

  return total
}

/** An account's own balance plus every sub-ledger, in the section's direction. */
function signedRollup(account: Account, map: BalanceMap, byParent: Map<string, Account[]>): Paise {
  const roll = rollupNet(account, byParent, map)
  return account.isContra ? -roll : roll
}

function contribution(account: Account, map: BalanceMap): Paise {
  const net = netForAccount(account, map)
  return account.isContra ? -net : net
}

/**
 * Cumulative (income − expense) to date. Uses the same contra handling as the
 * P&L so the two statements can never disagree about the profit figure.
 */
function profitForPeriod(accounts: Account[], map: BalanceMap): Paise {
  return totalForType(accounts, 'INCOME', map) - totalForType(accounts, 'EXPENSE', map)
}

function totalForType(accounts: Account[], type: AccountType, map: BalanceMap): Paise {
  let total = 0
  for (const account of accountsOfType(accounts, type)) {
    total += contribution(account, map)
  }
  return total
}
