import { ACC } from '@/db/coa'
import { db, type InvoiceType, type LedgerEntry } from '@/db/schema'
import { labelize } from '@/lib/format'
import { formatINR, formatQty, type Paise } from '@/lib/money'
import { groupByItem, replayMovements } from '@/services/inventory'
import {
  accountLabel,
  entriesForAccount,
  filterEntries,
  inRange,
  loadAccounts,
  loadLedger,
  sumCredit,
  sumDebit,
} from './core'
import { moneyColumn, numberColumn, textColumn, type ReportResult, type ReportRow } from './types'

/* ==========================================================================
 * General ledger
 * ========================================================================== */

/**
 * Account statement with opening balance, every movement and a closing balance.
 * Balances are shown as debit-positive: a negative balance means the account
 * actually carries a credit balance.
 */
export async function ledgerReport(opts: {
  accountId: string
  from?: string
  to?: string
}): Promise<ReportResult> {
  const columns = [
    textColumn('date', 'Date'),
    textColumn('voucher', 'Voucher'),
    textColumn('particulars', 'Particulars'),
    moneyColumn('debit', 'Debit', true),
    moneyColumn('credit', 'Credit', true),
    moneyColumn('balance', 'Balance'),
  ]

  const [account, ledger, vouchers] = await Promise.all([
    db.accounts.get(opts.accountId),
    loadLedger(),
    db.vouchers.toArray(),
  ])

  if (!account) {
    return {
      title: 'Ledger',
      columns,
      rows: [],
      warnings: [`Account ${opts.accountId} was not found in the chart of accounts.`],
    }
  }

  const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]))
  const all = entriesForAccount(ledger, account.id)

  // Everything before `from` collapses into a single opening balance row.
  const opening = all
    .filter((entry) => (opts.from ? entry.date < opts.from : false))
    .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)

  const period = filterEntries(all, opts.from, opts.to)
  const rows: ReportRow[] = [
    {
      id: 'opening',
      date: '',
      voucher: '',
      particulars: 'Opening Balance',
      balance: opening,
      muted: true,
    },
  ]

  let running = opening
  for (const entry of period) {
    running += entry.debit - entry.credit
    rows.push({
      id: entry.id,
      date: entry.date,
      voucher: voucherById.get(entry.voucherId)?.number ?? '',
      particulars: entry.narration,
      debit: entry.debit,
      credit: entry.credit,
      balance: running,
    })
  }

  rows.push({
    id: 'closing',
    date: '',
    voucher: '',
    particulars: 'Closing Balance',
    balance: running,
    emphasis: 'total',
  })

  return {
    title: `Ledger — ${accountLabel(account)}`,
    subtitle: rangeLabel(opts.from, opts.to),
    columns,
    rows,
    totals: { debit: sumDebit(period), credit: sumCredit(period) },
    highlights: [{ label: 'Closing Balance', value: formatINR(running) }],
  }
}

/* ==========================================================================
 * Day book
 * ========================================================================== */

/** Every ledger entry for the period, grouped under its voucher. */
export async function dayBook(opts: { from: string; to: string }): Promise<ReportResult> {
  const [ledger, vouchers, accounts] = await Promise.all([
    loadLedger(),
    db.vouchers.toArray(),
    loadAccounts(),
  ])

  const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]))
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  const entries = [...filterEntries(ledger, opts.from, opts.to)].sort((a, b) =>
    a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1,
  )

  // Group contiguously by voucher so the report reads voucher by voucher.
  const grouped = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const list = grouped.get(entry.voucherId)
    if (list) list.push(entry)
    else grouped.set(entry.voucherId, [entry])
  }

  const rows: ReportRow[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (const [voucherId, lines] of grouped) {
    const voucher = voucherById.get(voucherId)
    rows.push({
      id: `voucher-${voucherId}`,
      date: lines[0]?.date ?? '',
      voucher: voucher?.number ?? voucherId,
      type: voucher ? labelize(voucher.type) : '',
      particulars: voucher?.narration ?? '',
      emphasis: 'heading',
    })

    for (const entry of lines) {
      const account = accountById.get(entry.accountId)
      totalDebit += entry.debit
      totalCredit += entry.credit
      rows.push({
        id: entry.id,
        level: 1,
        date: '',
        voucher: '',
        type: '',
        particulars: account ? accountLabel(account) : entry.accountId,
        debit: entry.debit,
        credit: entry.credit,
      })
    }
  }

  return {
    title: 'Day Book',
    subtitle: `${opts.from} to ${opts.to}`,
    columns: [
      textColumn('date', 'Date'),
      textColumn('voucher', 'Voucher No'),
      textColumn('type', 'Type'),
      textColumn('particulars', 'Particulars'),
      moneyColumn('debit', 'Debit', true),
      moneyColumn('credit', 'Credit', true),
    ],
    rows,
    totals: { debit: totalDebit, credit: totalCredit },
  }
}

/* ==========================================================================
 * Cash book / bank book
 * ========================================================================== */

/** Cash Book — every entry touching Cash in Hand, with a running balance. */
export async function cashBook(opts: { from: string; to: string }): Promise<ReportResult> {
  return bookReport(ACC.CASH, 'Cash Book', opts, false)
}

/** Bank Book — the bank ledger, with the contra account named on each line. */
export async function bankBook(opts: { from: string; to: string }): Promise<ReportResult> {
  return bookReport(ACC.BANK, 'Bank Book', opts, true)
}

async function bookReport(
  accountCode: string,
  title: string,
  opts: { from: string; to: string },
  showContra: boolean,
): Promise<ReportResult> {
  const columns = showContra
    ? [
        textColumn('date', 'Date'),
        textColumn('voucher', 'Voucher'),
        textColumn('particulars', 'Particulars'),
        textColumn('book', 'Book'),
        moneyColumn('debit', 'Debit', true),
        moneyColumn('credit', 'Credit', true),
        moneyColumn('balance', 'Balance'),
      ]
    : [
        textColumn('date', 'Date'),
        textColumn('voucher', 'Voucher'),
        textColumn('particulars', 'Particulars'),
        moneyColumn('debit', 'Debit', true),
        moneyColumn('credit', 'Credit', true),
        moneyColumn('balance', 'Balance'),
      ]

  const account = await db.accounts.where('code').equals(accountCode).first()
  if (!account) {
    return {
      title,
      columns,
      rows: [],
      warnings: [`The chart of accounts has no account with code ${accountCode}.`],
    }
  }

  const [ledger, vouchers, accounts] = await Promise.all([
    loadLedger(),
    db.vouchers.toArray(),
    loadAccounts(),
  ])

  const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]))
  const accountById = new Map(accounts.map((row) => [row.id, row]))

  const byVoucher = new Map<string, LedgerEntry[]>()
  for (const entry of ledger) {
    const list = byVoucher.get(entry.voucherId)
    if (list) list.push(entry)
    else byVoucher.set(entry.voucherId, [entry])
  }

  const all = entriesForAccount(ledger, account.id)
  const opening = all
    .filter((entry) => entry.date < opts.from)
    .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
  const period = filterEntries(all, opts.from, opts.to)

  const rows: ReportRow[] = [
    {
      id: 'opening',
      date: '',
      voucher: '',
      particulars: 'Opening Balance',
      balance: opening,
      muted: true,
    },
  ]

  let running = opening
  for (const entry of period) {
    running += entry.debit - entry.credit

    let contraLabel = ''
    if (showContra) {
      const others = (byVoucher.get(entry.voucherId) ?? []).filter(
        (line) => line.accountId !== account.id,
      )
      contraLabel = others
        .map((line) => {
          const contra = accountById.get(line.accountId)
          return contra ? accountLabel(contra) : line.accountId
        })
        .join(', ')
    }

    const voucher = voucherById.get(entry.voucherId)
    rows.push({
      id: entry.id,
      date: entry.date,
      voucher: voucher?.number ?? '',
      particulars: entry.narration || voucher?.narration || '',
      book: contraLabel,
      debit: entry.debit,
      credit: entry.credit,
      balance: running,
    })
  }

  rows.push({
    id: 'closing',
    date: '',
    voucher: '',
    particulars: 'Closing Balance',
    balance: running,
    emphasis: 'total',
  })

  return {
    title,
    subtitle: `${opts.from} to ${opts.to}`,
    columns,
    rows,
    totals: { debit: sumDebit(period), credit: sumCredit(period) },
    highlights: [{ label: 'Closing Balance', value: formatINR(running) }],
  }
}

/* ==========================================================================
 * Stock summary
 * ========================================================================== */

/**
 * Inventory on hand valued at weighted-average cost, replayed from stock
 * movements. The total here should equal the Inventory ledger account.
 */
export async function stockSummary(opts: { asOn?: string } = {}): Promise<ReportResult> {
  const [items, movements] = await Promise.all([db.items.toArray(), db.stockMovements.toArray()])
  const relevant = opts.asOn ? movements.filter((movement) => movement.date <= opts.asOn!) : movements
  const grouped = groupByItem(relevant)
  const itemById = new Map(items.map((item) => [item.id, item]))

  const data: Array<{
    id: string
    sku: string
    item: string
    uom: string
    qty: number
    avgCost: Paise
    value: Paise
  }> = []
  const lowStock: string[] = []
  let totalValue = 0

  for (const [itemId, rows] of grouped) {
    const item = itemById.get(itemId)
    const position = replayMovements(itemId, rows)
    data.push({
      id: itemId,
      sku: item?.sku ?? itemId,
      item: item?.name ?? 'Unknown item',
      uom: item?.uom ?? '',
      qty: position.qty,
      avgCost: position.avgCost,
      value: position.value,
    })
    totalValue += position.value

    if (item && position.qty < item.reorderLevel) {
      lowStock.push(`${item.sku} ${item.name} (on hand ${formatQty(position.qty)}, reorder at ${item.reorderLevel})`)
    }
  }

  data.sort((a, b) => a.sku.localeCompare(b.sku))

  const rows: ReportRow[] = data.map((row) => ({ ...row }))
  rows.push({
    id: 'total',
    sku: '',
    item: 'Total',
    uom: '',
    qty: 0,
    avgCost: 0,
    value: totalValue,
    emphasis: 'total',
  })

  const result: ReportResult = {
    title: 'Stock Summary',
    subtitle: opts.asOn ? `As on ${opts.asOn}` : 'All movements',
    columns: [
      textColumn('sku', 'SKU'),
      textColumn('item', 'Item'),
      textColumn('uom', 'UOM'),
      numberColumn('qty', 'Qty On Hand', 3),
      moneyColumn('avgCost', 'Avg Cost'),
      moneyColumn('value', 'Value', true),
    ],
    rows,
    totals: { value: totalValue },
    highlights: [{ label: 'Inventory value', value: formatINR(totalValue) }],
  }

  if (lowStock.length > 0) {
    result.warnings = [
      `${lowStock.length} item(s) are at or below their reorder level: ${lowStock.join('; ')}.`,
    ]
  }

  return result
}

/* ==========================================================================
 * Sales / purchase registers
 * ========================================================================== */

/** Sales register — invoices of type SALES within the period. */
export async function salesReport(opts: { from: string; to: string }): Promise<ReportResult> {
  return invoiceReport('SALES', 'Sales Report', opts)
}

/** Purchase register — invoices of type PURCHASE within the period. */
export async function purchaseReport(opts: { from: string; to: string }): Promise<ReportResult> {
  return invoiceReport('PURCHASE', 'Purchase Report', opts)
}

async function invoiceReport(
  type: InvoiceType,
  title: string,
  opts: { from: string; to: string },
): Promise<ReportResult> {
  const [invoices, customers, suppliers] = await Promise.all([
    db.invoices.toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
  ])

  const partyName = new Map<string, string>(
    type === 'SALES'
      ? customers.map((customer) => [customer.id, customer.name])
      : suppliers.map((supplier) => [supplier.id, supplier.name]),
  )

  const relevant = invoices
    .filter((invoice) => invoice.type === type && inRange(invoice.date, opts.from, opts.to))
    .sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : a.date < b.date ? -1 : 1))

  const rows: ReportRow[] = []
  let taxable = 0
  let cgst = 0
  let sgst = 0
  let igst = 0
  let total = 0

  for (const invoice of relevant) {
    taxable += invoice.taxable
    cgst += invoice.cgst
    sgst += invoice.sgst
    igst += invoice.igst
    total += invoice.total
    rows.push({
      id: invoice.id,
      date: invoice.date,
      number: invoice.number,
      party: partyName.get(invoice.partyId) ?? invoice.partyId,
      taxable: invoice.taxable,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      total: invoice.total,
    })
  }

  rows.push({
    id: 'total',
    date: '',
    number: 'Total',
    party: '',
    taxable,
    cgst,
    sgst,
    igst,
    total,
    emphasis: 'total',
  })

  return {
    title,
    subtitle: `${opts.from} to ${opts.to}`,
    columns: [
      textColumn('date', 'Date'),
      textColumn('number', 'Invoice No'),
      textColumn('party', 'Party'),
      moneyColumn('taxable', 'Taxable', true),
      moneyColumn('cgst', 'CGST', true),
      moneyColumn('sgst', 'SGST', true),
      moneyColumn('igst', 'IGST', true),
      moneyColumn('total', 'Total', true),
    ],
    rows,
    totals: { taxable, cgst, sgst, igst, total },
    highlights: [{ label: 'Total invoiced', value: formatINR(total) }],
  }
}

function rangeLabel(from?: string, to?: string): string {
  if (!from && !to) return 'All periods'
  return `${from ?? 'the beginning'} to ${to ?? 'date'}`
}
