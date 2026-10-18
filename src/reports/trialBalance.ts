import { formatINR, type Paise } from '@/lib/money'
import {
  accountLabel,
  activeAccountIds,
  buildBalanceMap,
  filterEntries,
  loadAccounts,
  loadLedger,
  sortAccounts,
  trialBalanceColumns,
} from './core'
import { moneyColumn, textColumn, type ReportResult, type ReportRow } from './types'

/**
 * Trial balance for a period.
 *
 * One row per account that moved. The debit and credit columns are produced by
 * `trialBalanceColumns`, which places the account's NET balance on whichever
 * side it actually sits. Because the ledger itself always balances, summing the
 * two columns gives identical totals — the whole point of the statement.
 */
export async function trialBalance(opts: { from?: string; to?: string }): Promise<ReportResult> {
  const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
  const entries = filterEntries(ledger, opts.from, opts.to)
  const map = buildBalanceMap(entries)
  const active = activeAccountIds(entries)

  const rows: ReportRow[] = []
  let totalDebit: Paise = 0
  let totalCredit: Paise = 0

  const pushRow = (label: string, accountId: string): void => {
    const { debit, credit } = trialBalanceColumns(map, accountId)
    totalDebit += debit
    totalCredit += credit
    rows.push({
      id: accountId,
      accountId,
      account: label,
      debit,
      credit,
    })
  }

  for (const account of sortAccounts(accounts)) {
    if (!active.has(account.id)) continue
    pushRow(accountLabel(account), account.id)
  }

  // A ledger line whose account is missing from the chart must still appear,
  // otherwise the two sides could silently stop agreeing without any clue why.
  const knownIds = new Set(accounts.map((account) => account.id))
  for (const accountId of active) {
    if (knownIds.has(accountId)) continue
    pushRow(`Unmapped account ${accountId}`, accountId)
  }

  const balanced = totalDebit === totalCredit
  const difference = totalDebit - totalCredit

  const result: ReportResult = {
    title: 'Trial Balance',
    subtitle: rangeLabel(opts.from, opts.to),
    columns: [
      textColumn('account', 'Account'),
      moneyColumn('debit', 'Debit', true),
      moneyColumn('credit', 'Credit', true),
    ],
    rows,
    totals: { debit: totalDebit, credit: totalCredit },
    highlights: [
      {
        label: 'Trial Balance',
        value: balanced ? 'Balanced ✓' : 'Out of balance ✗',
        tone: balanced ? 'positive' : 'negative',
      },
    ],
  }

  if (!balanced) {
    result.warnings = [
      `The ledger does not balance: debits exceed credits by ${formatINR(difference)}. This should be impossible because every posting is validated — look for a row written outside the posting engine.`,
    ]
  }

  return result
}

function rangeLabel(from?: string, to?: string): string {
  if (!from && !to) return 'All periods'
  return `${from ?? 'the beginning'} to ${to ?? 'date'}`
}
