import { ACC } from '@/db/coa'
import type { Account } from '@/db/schema'
import { formatINR, type Paise } from '@/lib/money'
import {
  accountsOfType,
  balanceOf,
  buildBalanceMap,
  childrenByParent,
  descendantsOf,
  filterEntries,
  loadAccounts,
  loadLedger,
  netForAccount,
  type BalanceMap,
} from './core'
import { moneyColumn, textColumn, type ReportResult, type ReportRow } from './types'

/**
 * Cash Flow Statement (indirect method).
 *
 * The reconciliation is derived from the ledger rather than guessed: cash and
 * bank are the residual of every other account's movement, so if the statement
 * does not tie with the actual cash/bank movement the difference is reported
 * explicitly instead of being hidden.
 */
export async function cashFlow(opts: { from: string; to: string }): Promise<ReportResult> {
  const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
  const entries = filterEntries(ledger, opts.from, opts.to)
  const map = buildBalanceMap(entries)
  const byParent = childrenByParent(accounts)
  const byCode = new Map(accounts.map((account) => [account.code, account]))

  const signedOver = (codes: string[]): Paise => {
    let total = 0
    for (const code of codes) {
      const root = byCode.get(code)
      if (!root) continue
      total += signedOf(root, map)
      for (const child of descendantsOf(root.id, byParent)) total += signedOf(child, map)
    }
    return total
  }

  // Net profit uses the same sign convention as the P&L and Balance Sheet.
  const profit =
    totalForType(accounts, 'INCOME', map) - totalForType(accounts, 'EXPENSE', map)

  const depreciation = signedOver([ACC.DEPRECIATION])

  // Working capital. For a current asset an increase consumes cash, so the
  // adjustment is the negative of its movement; for a current liability an
  // increase releases cash, which is again the negative of its signed movement.
  const changeReceivable = -signedOver([ACC.RECEIVABLE])
  const changeInventory = -signedOver([ACC.INVENTORY])
  const changeInputTax = -signedOver([ACC.INPUT_CGST, ACC.INPUT_SGST, ACC.INPUT_IGST])
  const changeTdsReceivable = -signedOver([ACC.TDS_RECEIVABLE])
  const changePrepaid = -signedOver([ACC.PREPAID])
  const changePayable = -signedOver([ACC.PAYABLE])
  const changeOutputTax = -signedOver([ACC.OUTPUT_CGST, ACC.OUTPUT_SGST, ACC.OUTPUT_IGST])
  const changeGstPayable = -signedOver([ACC.GST_PAYABLE])
  const changeTdsPayable = -signedOver([ACC.TDS_PAYABLE])
  const changeOtherLiabilities = -signedOver([
    ACC.PF_PAYABLE,
    ACC.PT_PAYABLE,
    ACC.SALARY_PAYABLE,
    ACC.EXPENSES_PAYABLE,
  ])

  const operatingTotal =
    profit +
    depreciation +
    changeReceivable +
    changeInventory +
    changeInputTax +
    changeTdsReceivable +
    changePrepaid +
    changePayable +
    changeOutputTax +
    changeGstPayable +
    changeTdsPayable +
    changeOtherLiabilities

  // Investing: cash spent on fixed assets shows as a negative (an increase in
  // the asset accounts is a use of cash).
  const fixedAssetPurchases = -signedOver([ACC.FURNITURE, ACC.COMPUTERS, ACC.VEHICLES])
  const investingTotal = fixedAssetPurchases

  // Financing: an increase in a liability or equity account is a source of cash,
  // so the cash effect is the negative of the signed movement.
  const bankLoan = -signedOver([ACC.BANK_LOAN])
  const shareCapital = -signedOver([ACC.SHARE_CAPITAL])
  const reserves = -signedOver([ACC.RESERVES])
  const retainedEarnings = -signedOver([ACC.RETAINED_EARNINGS])
  const drawings = -signedOver([ACC.DRAWINGS])
  const financingTotal = bankLoan + shareCapital + reserves + retainedEarnings + drawings

  const computedNet = operatingTotal + investingTotal + financingTotal
  const actualNet = signedOver([ACC.CASH, ACC.BANK])
  const difference = actualNet - computedNet

  const rows: ReportRow[] = []
  rows.push({ id: 'section-operating', particulars: 'A. Operating activities', emphasis: 'heading' })
  pushLine(rows, 'net-profit', 'Net profit for the period', profit)
  pushIf(rows, 'depreciation', 'Add: Depreciation (non-cash)', depreciation)
  pushIf(rows, 'wc-receivable', 'Change in Accounts Receivable', changeReceivable)
  pushIf(rows, 'wc-inventory', 'Change in Inventory', changeInventory)
  pushIf(rows, 'wc-input-gst', 'Change in Input Tax Credit', changeInputTax)
  pushIf(rows, 'wc-tds-receivable', 'Change in TDS Receivable', changeTdsReceivable)
  pushIf(rows, 'wc-prepaid', 'Change in Prepaid Expenses', changePrepaid)
  pushIf(rows, 'wc-payable', 'Change in Accounts Payable', changePayable)
  pushIf(rows, 'wc-output-gst', 'Change in Output GST', changeOutputTax)
  pushIf(rows, 'wc-gst-payable', 'Change in GST Payable', changeGstPayable)
  pushIf(rows, 'wc-tds-payable', 'Change in TDS Payable', changeTdsPayable)
  pushIf(rows, 'wc-other-liabilities', 'Change in other current liabilities', changeOtherLiabilities)
  rows.push({
    id: 'operating-total',
    particulars: 'Net cash from operating activities',
    amount: operatingTotal,
    emphasis: 'subtotal',
  })

  rows.push({ id: 'section-investing', particulars: 'B. Investing activities', emphasis: 'heading' })
  pushIf(rows, 'fixed-assets', 'Purchase of fixed assets', fixedAssetPurchases)
  rows.push({
    id: 'investing-total',
    particulars: 'Net cash used in investing activities',
    amount: investingTotal,
    emphasis: 'subtotal',
  })

  rows.push({ id: 'section-financing', particulars: 'C. Financing activities', emphasis: 'heading' })
  pushIf(rows, 'bank-loan', 'Bank loan (net)', bankLoan)
  pushIf(rows, 'share-capital', 'Share capital', shareCapital)
  pushIf(rows, 'reserves', 'Reserves & surplus', reserves)
  pushIf(rows, 'retained-earnings', 'Retained earnings', retainedEarnings)
  pushIf(rows, 'drawings', 'Drawings / dividend', drawings)
  rows.push({
    id: 'financing-total',
    particulars: 'Net cash from financing activities',
    amount: financingTotal,
    emphasis: 'subtotal',
  })

  rows.push({
    id: 'computed-net',
    particulars: 'Net increase / (decrease) in cash and bank',
    amount: computedNet,
    emphasis: 'total',
  })
  rows.push({ id: 'actual-net', particulars: 'Actual movement in cash and bank', amount: actualNet })
  if (difference !== 0) {
    rows.push({ id: 'difference', particulars: 'Unreconciled difference', amount: difference, muted: true })
  }

  const result: ReportResult = {
    title: 'Cash Flow Statement',
    subtitle: `${opts.from} to ${opts.to} · indirect method`,
    columns: [textColumn('particulars', 'Particulars'), moneyColumn('amount', 'Amount')],
    rows,
    totals: { amount: actualNet },
    highlights: [
      {
        label: 'Net change in cash',
        value: formatINR(actualNet),
        tone: actualNet >= 0 ? 'positive' : 'negative',
      },
    ],
    notes: [
      'Cash and bank movement is taken directly from the Cash in Hand and Bank ledger accounts, not derived from the profit figure.',
      'Depreciation is added back because it reduced profit without moving cash.',
    ],
  }

  if (difference !== 0) {
    result.warnings = [
      `The cash flow does not reconcile with the Cash and Bank ledger by ${formatINR(difference)}. This normally means an account moved for reasons outside the standard classification (for example a fixed asset was sold, or drawings were posted through an unexpected account).`,
    ]
  }

  return result
}

function pushLine(rows: ReportRow[], id: string, particulars: string, amount: Paise): void {
  rows.push({ id, particulars, level: 1, amount })
}

/** Only show a movement line when there actually was one. */
function pushIf(rows: ReportRow[], id: string, particulars: string, amount: Paise): void {
  if (amount === 0) return
  pushLine(rows, id, particulars, amount)
}

function signedOf(account: Account, map: BalanceMap): Paise {
  const { debit, credit } = balanceOf(map, account.id)
  return debit - credit
}

function contribution(account: Account, map: BalanceMap): Paise {
  const net = netForAccount(account, map)
  return account.isContra ? -net : net
}

function totalForType(accounts: Account[], type: Account['type'], map: BalanceMap): Paise {
  let total = 0
  for (const account of accountsOfType(accounts, type)) total += contribution(account, map)
  return total
}
