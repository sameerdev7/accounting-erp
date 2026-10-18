import { beforeEach, describe, expect, it } from 'vitest'
import { ACC, CHART_OF_ACCOUNTS, type AccountSeed } from '@/db/coa'
import {
  db,
  type Account,
  type Invoice,
  type InvoiceLine,
  type LedgerEntry,
  type Voucher,
  type VoucherType,
} from '@/db/schema'
import {
  cr,
  dr,
  postExpense,
  postInventoryClosing,
  postJournal,
  postPayment,
  postPurchaseInvoice,
  postReceipt,
  postSalesInvoice,
} from '@/engine/posting'
import type { JournalLine, PostingContext } from '@/engine/types'
import { toPaise } from '@/lib/money'
import {
  balanceSheet,
  bankBook,
  cashBook,
  creditorsOutstanding,
  dayBook,
  debtorsOutstanding,
  gstr1,
  gstr3b,
  ledgerReport,
  profitAndLoss,
  purchaseReport,
  salesReport,
  stockSummary,
  trialBalance,
} from '@/reports'

/**
 * Reports are pure functions over the ledger, so the tests build a tiny but
 * complete set of books by hand: the full chart of accounts plus a couple of
 * party sub-ledgers, then a handful of balanced postings produced by the real
 * posting engine.
 */

const resolve = (code: string) => `acc:${code}`
const ctx: PostingContext = { resolve, narration: 'Test entry' }

const CUSTOMER_ACCOUNT = 'acc:CUST1'
const SUPPLIER_ACCOUNT = 'acc:SUP1'

const PERIOD = { from: '2025-04-01', to: '2025-06-30' }

function accountFromSeed(seed: AccountSeed): Account {
  return {
    id: `acc:${seed.code}`,
    code: seed.code,
    name: seed.name,
    type: seed.type,
    parentId: seed.parentCode ? `acc:${seed.parentCode}` : null,
    isControl: seed.isControl ?? false,
    normalBalance: seed.normalBalance,
    isBank: seed.isBank ?? false,
    isCash: seed.isCash ?? false,
    isContra: seed.isContra ?? false,
    active: true,
    createdAt: 0,
    createdBy: 'test',
  }
}

const PARTY_ACCOUNTS: Account[] = [
  {
    id: CUSTOMER_ACCOUNT,
    code: 'C0001',
    name: 'Test Customer',
    type: 'ASSET',
    parentId: resolve(ACC.RECEIVABLE),
    isControl: false,
    normalBalance: 'DEBIT',
    isBank: false,
    isCash: false,
    partyType: 'CUSTOMER',
    partyId: 'cust-1',
    isContra: false,
    active: true,
    createdAt: 0,
    createdBy: 'test',
  },
  {
    id: SUPPLIER_ACCOUNT,
    code: 'S0001',
    name: 'Test Supplier',
    type: 'LIABILITY',
    parentId: resolve(ACC.PAYABLE),
    isControl: false,
    normalBalance: 'CREDIT',
    isBank: false,
    isCash: false,
    partyType: 'SUPPLIER',
    partyId: 'sup-1',
    isContra: false,
    active: true,
    createdAt: 0,
    createdBy: 'test',
  },
]

let voucherCounter = 0

/** Writes a voucher and its ledger entries directly — no approval workflow. */
async function postVoucher(
  type: VoucherType,
  date: string,
  lines: JournalLine[],
): Promise<void> {
  voucherCounter += 1
  const voucherId = `vch:${voucherCounter}`
  const number = `${type}/${String(voucherCounter).padStart(4, '0')}`

  const voucher: Voucher = {
    id: voucherId,
    type,
    number,
    date,
    narration: `Test ${type}`,
    status: 'POSTED',
    amount: lines.reduce((sum, line) => sum + line.debit, 0),
    preparedBy: 'test',
    createdAt: voucherCounter,
    createdBy: 'test',
  }

  const entries: LedgerEntry[] = lines.map((line, index) => ({
    id: `led:${voucherCounter}:${index}`,
    voucherId,
    date,
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    partyId: line.partyId ?? null,
    narration: line.narration ?? `Test ${type}`,
    createdAt: voucherCounter,
    createdBy: 'test',
  }))

  await db.vouchers.add(voucher)
  await db.ledgerEntries.bulkAdd(entries)
}

/** Seeds a capital injection, a purchase, a sale, a receipt, a payment and rent. */
async function seedLedger(): Promise<void> {
  await postVoucher(
    'JOURNAL',
    '2025-04-01',
    postJournal(ctx, [
      dr(resolve(ACC.BANK), toPaise(500000)),
      cr(resolve(ACC.SHARE_CAPITAL), toPaise(500000)),
    ]),
  )

  await postVoucher(
    'PURCHASE',
    '2025-04-10',
    postPurchaseInvoice(ctx, {
      supplierAccountId: SUPPLIER_ACCOUNT,
      supplierPartyId: 'sup-1',
      debitAccountId: resolve(ACC.PURCHASES),
      taxable: toPaise(100000),
      cgst: toPaise(9000),
      sgst: toPaise(9000),
      igst: 0,
      total: toPaise(118000),
    }),
  )

  await postVoucher(
    'SALES',
    '2025-05-01',
    postSalesInvoice(ctx, {
      customerAccountId: CUSTOMER_ACCOUNT,
      customerPartyId: 'cust-1',
      taxable: toPaise(200000),
      cgst: toPaise(18000),
      sgst: toPaise(18000),
      igst: 0,
      total: toPaise(236000),
    }),
  )

  await postVoucher(
    'JOURNAL',
    '2025-05-01',
    postInventoryClosing(ctx, {
      openingStock: 0,
      purchases: toPaise(100000),
      closingStock: 0,
    }),
  )

  await postVoucher(
    'RECEIPT',
    '2025-05-20',
    postReceipt(ctx, {
      partyAccountId: CUSTOMER_ACCOUNT,
      partyId: 'cust-1',
      cashOrBankAccountId: resolve(ACC.BANK),
      amount: toPaise(100000),
    }),
  )

  await postVoucher(
    'PAYMENT',
    '2025-05-25',
    postPayment(ctx, {
      partyAccountId: SUPPLIER_ACCOUNT,
      partyId: 'sup-1',
      cashOrBankAccountId: resolve(ACC.BANK),
      amount: toPaise(50000),
    }),
  )

  await postVoucher(
    'PAYMENT',
    '2025-06-01',
    postExpense(ctx, {
      expenseAccountId: resolve(ACC.RENT),
      amount: toPaise(20000),
      tdsAmount: toPaise(2000),
      creditAccountId: resolve(ACC.BANK),
    }),
  )
}

/** A part-settled sales invoice and a part-settled purchase invoice. */
async function seedInvoices(): Promise<void> {
  const salesInvoice: Invoice = {
    id: 'inv-1',
    type: 'SALES',
    number: 'SV/2526/0001',
    partyInvoiceNumber: '',
    partyId: 'cust-1',
    date: '2025-05-01',
    dueDate: '2025-05-31',
    placeOfSupply: 'Maharashtra',
    interState: false,
    taxable: toPaise(200000),
    cgst: toPaise(18000),
    sgst: toPaise(18000),
    igst: 0,
    roundOff: 0,
    total: toPaise(236000),
    status: 'POSTED',
    narration: 'Test sale',
    preparedBy: 'test',
    createdAt: 0,
    createdBy: 'test',
  }

  const purchaseInvoice: Invoice = {
    id: 'inv-2',
    type: 'PURCHASE',
    number: 'PV/2526/0001',
    partyInvoiceNumber: 'SUP-INV-1',
    partyId: 'sup-1',
    date: '2025-04-10',
    dueDate: '2025-07-31',
    placeOfSupply: 'Maharashtra',
    interState: false,
    taxable: toPaise(100000),
    cgst: toPaise(9000),
    sgst: toPaise(9000),
    igst: 0,
    roundOff: 0,
    total: toPaise(118000),
    status: 'POSTED',
    narration: 'Test purchase',
    preparedBy: 'test',
    createdAt: 0,
    createdBy: 'test',
  }

  const lines: InvoiceLine[] = [
    {
      id: 'line-1',
      invoiceId: 'inv-1',
      description: 'Test item',
      hsn: '8517',
      qty: 10,
      rate: toPaise(20000),
      gstRate: 18,
      taxable: toPaise(200000),
      cgst: toPaise(18000),
      sgst: toPaise(18000),
      igst: 0,
      createdAt: 0,
      createdBy: 'test',
    },
    {
      id: 'line-2',
      invoiceId: 'inv-2',
      description: 'Test item',
      hsn: '8517',
      qty: 10,
      rate: toPaise(10000),
      gstRate: 18,
      taxable: toPaise(100000),
      cgst: toPaise(9000),
      sgst: toPaise(9000),
      igst: 0,
      createdAt: 0,
      createdBy: 'test',
    },
  ]

  await db.invoices.bulkAdd([salesInvoice, purchaseInvoice])
  await db.invoiceLines.bulkAdd(lines)
  await db.allocations.bulkAdd([
    {
      id: 'alloc-1',
      invoiceId: 'inv-1',
      voucherId: 'vch:5',
      partyId: 'cust-1',
      amount: toPaise(100000),
      createdAt: 0,
      createdBy: 'test',
    },
    {
      id: 'alloc-2',
      invoiceId: 'inv-2',
      voucherId: 'vch:6',
      partyId: 'sup-1',
      amount: toPaise(50000),
      createdAt: 0,
      createdBy: 'test',
    },
  ])
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  voucherCounter = 0

  await db.accounts.bulkAdd([...CHART_OF_ACCOUNTS.map(accountFromSeed), ...PARTY_ACCOUNTS])

  await db.customers.add({
    id: 'cust-1',
    code: 'CUST1',
    name: 'Test Customer',
    gstin: '',
    state: 'Maharashtra',
    stateCode: '27',
    address: '',
    city: '',
    pincode: '',
    phone: '',
    email: '',
    creditLimit: 0,
    creditDays: 15,
    ledgerAccountId: CUSTOMER_ACCOUNT,
    active: true,
    createdAt: 0,
    createdBy: 'test',
  })

  await db.suppliers.add({
    id: 'sup-1',
    code: 'SUP1',
    name: 'Test Supplier',
    gstin: '',
    state: 'Maharashtra',
    stateCode: '27',
    address: '',
    city: '',
    pincode: '',
    phone: '',
    email: '',
    paymentTermsDays: 30,
    ledgerAccountId: SUPPLIER_ACCOUNT,
    active: true,
    createdAt: 0,
    createdBy: 'test',
  })

  await seedLedger()
  await seedInvoices()
})

describe('trialBalance', () => {
  it('produces equal debit and credit grand totals', async () => {
    const report = await trialBalance(PERIOD)

    expect(report.totals?.debit).toBe(report.totals?.credit)
    expect(Number(report.totals?.debit)).toBeGreaterThan(0)
    expect(report.highlights?.[0]?.value).toBe('Balanced ✓')
  })

  it('includes party sub-ledger accounts as ordinary rows', async () => {
    const report = await trialBalance(PERIOD)
    const customerRow = report.rows.find((row) => row.accountId === CUSTOMER_ACCOUNT)
    expect(customerRow).toBeDefined()
    expect(customerRow?.account).toContain('Test Customer')
  })
})

describe('balanceSheet', () => {
  it('balances because profit is carried into equity', async () => {
    const report = await balanceSheet({ asOn: '2025-06-30' })

    const highlight = report.highlights?.find(
      (item) => item.label === 'Assets = Liabilities + Equity',
    )
    expect(highlight?.value).toBe('Balanced ✓')
    expect(report.warnings).toBeUndefined()
    expect(report.totals?.assets).toBe(
      Number(report.totals?.liabilities) + Number(report.totals?.equity),
    )
  })
})

describe('profitAndLoss', () => {
  it('computes net profit for the period', async () => {
    const report = await profitAndLoss(PERIOD)

    // Sales 2,00,000 less COGS 1,00,000 less rent 20,000 = 80,000 rupees.
    const netProfit = report.rows.find((row) => row.id === 'net-profit')
    expect(netProfit?.amount).toBe(toPaise(80000))
    expect(report.highlights?.[0]?.label).toBe('Net Profit')
  })
})

describe('debtorsOutstanding', () => {
  it('buckets a part-paid overdue invoice correctly', async () => {
    const report = await debtorsOutstanding({ asOn: '2025-06-15' })

    const row = report.rows.find((item) => item.number === 'SV/2526/0001')
    expect(row).toBeDefined()
    // 2,36,000 invoiced less 1,00,000 received = 1,36,000 outstanding.
    expect(row?.outstanding).toBe(toPaise(136000))
    expect(row?.settled).toBe(toPaise(100000))
    // Due 31-May, report date 15-Jun -> 15 days overdue -> 0–30 bucket.
    expect(row?.daysOverdue).toBe(15)
    expect(row?.bucket).toBe('0–30')
  })
})

describe('books and registers', () => {
  it('day book keeps its debits and credits equal', async () => {
    const report = await dayBook(PERIOD)
    expect(report.totals?.debit).toBe(report.totals?.credit)
    expect(Number(report.totals?.debit)).toBeGreaterThan(0)
  })

  it('bank book closes at the ledger bank balance and names the contra account', async () => {
    const report = await bankBook(PERIOD)
    const closing = report.rows.find((row) => row.id === 'closing')
    // Capital 5,00,000 + receipt 1,00,000 − payment 50,000 − rent 18,000.
    expect(closing?.balance).toBe(toPaise(532000))
    expect(report.columns.some((column) => column.key === 'book')).toBe(true)
    const contra = report.rows.find((row) => typeof row.book === 'string' && row.book.length > 0)
    expect(contra).toBeDefined()
  })

  it('cash book has an opening and a closing balance row', async () => {
    const report = await cashBook(PERIOD)
    expect(report.rows[0]?.id).toBe('opening')
    expect(report.rows[report.rows.length - 1]?.id).toBe('closing')
  })

  it('ledger report closes at the account balance', async () => {
    const report = await ledgerReport({ accountId: resolve(ACC.BANK), from: PERIOD.from, to: PERIOD.to })
    const closing = report.rows.find((row) => row.id === 'closing')
    expect(closing?.balance).toBe(toPaise(532000))
  })

  it('sales and purchase registers total their invoices', async () => {
    const sales = await salesReport(PERIOD)
    expect(sales.totals?.total).toBe(toPaise(236000))
    expect(sales.rows.find((row) => row.id === 'total')?.party).toBe('')

    const purchases = await purchaseReport(PERIOD)
    expect(purchases.totals?.total).toBe(toPaise(118000))
  })

  it('stock summary totals the on-hand value', async () => {
    const report = await stockSummary()
    expect(report.title).toBe('Stock Summary')
    expect(report.totals?.value).toBe(0)
  })
})

describe('creditorsOutstanding', () => {
  it('shows a part-paid purchase invoice as not yet due', async () => {
    const report = await creditorsOutstanding({ asOn: '2025-06-15' })
    const row = report.rows.find((item) => item.number === 'PV/2526/0001')
    expect(row?.outstanding).toBe(toPaise(68000))
    expect(row?.bucket).toBe('Not yet due')
  })
})

describe('GST reports', () => {
  it('summarises GSTR-1 by rate slab', async () => {
    const report = await gstr1(PERIOD)
    const slab = report.rows.find((row) => row.id === 'rate-18')
    expect(slab?.taxable).toBe(toPaise(200000))
    expect(slab?.cgst).toBe(toPaise(18000))
    expect(slab?.sgst).toBe(toPaise(18000))
  })

  it('summarises GSTR-3B with a net payable', async () => {
    const report = await gstr3b(PERIOD)
    const net = report.rows.find((row) => row.id === 'net')
    // Output 36,000 less input 18,000 = 18,000 rupees payable.
    expect(net?.cgst).toBe(toPaise(9000))
    expect(net?.sgst).toBe(toPaise(9000))
    const highlight = report.highlights?.find((item) => item.label === 'Net GST payable')
    expect(highlight?.value).toBe('₹18,000.00')
  })
})
