import { describe, expect, it } from 'vitest'
import { ACC } from '@/db/coa'
import {
  postContra,
  postDepreciation,
  postExpense,
  postGstSettlement,
  postInventoryClosing,
  postJournal,
  postPayroll,
  postPayment,
  postPurchaseInvoice,
  postPurchaseReturn,
  postReceipt,
  postSalesInvoice,
  postSalesReturn,
  postSalaryPayment,
} from '@/engine/posting'
import { PostingError, type JournalLine, type PostingContext } from '@/engine/types'
import { totalCredit, totalDebit } from '@/engine/validators'
import { toPaise } from '@/lib/money'

const resolve = (code: string) => `acc:${code}`
const ctx: PostingContext = { resolve, narration: 'Test entry' }

/** Resolve a chart-of-accounts code (or a literal party id) to a test account id. */
const A = (code: string) => `acc:${code}`

function debitTotalOf(lines: JournalLine[], accountId: string): number {
  return lines.filter((line) => line.accountId === accountId).reduce((sum, line) => sum + line.debit, 0)
}

function creditTotalOf(lines: JournalLine[], accountId: string): number {
  return lines
    .filter((line) => line.accountId === accountId)
    .reduce((sum, line) => sum + line.credit, 0)
}

function expectBalanced(lines: JournalLine[]): void {
  expect(totalDebit(lines)).toBe(totalCredit(lines))
}

describe('postPurchaseInvoice', () => {
  it('posts an intra-state purchase: Dr Purchases + Input GST, Cr Supplier', () => {
    const lines = postPurchaseInvoice(ctx, {
      supplierAccountId: 'acc:sup-1',
      supplierPartyId: 'sup-1',
      debitAccountId: `acc:${ACC.PURCHASES}`,
      taxable: toPaise(50000),
      cgst: toPaise(4500),
      sgst: toPaise(4500),
      igst: 0,
      total: toPaise(59000),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.PURCHASES))).toBe(5_000_000)
    expect(debitTotalOf(lines, A(ACC.INPUT_CGST))).toBe(450_000)
    expect(debitTotalOf(lines, A(ACC.INPUT_SGST))).toBe(450_000)
    expect(lines.find((line) => line.accountId === 'acc:sup-1')?.credit).toBe(5_900_000)
    expect(lines.find((line) => line.accountId === 'acc:sup-1')?.partyId).toBe('sup-1')
  })

  it('posts an inter-state purchase using IGST only', () => {
    const lines = postPurchaseInvoice(ctx, {
      supplierAccountId: 'acc:sup-2',
      debitAccountId: `acc:${ACC.PURCHASES}`,
      taxable: toPaise(50000),
      cgst: 0,
      sgst: 0,
      igst: toPaise(9000),
      total: toPaise(59000),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.INPUT_IGST))).toBe(900_000)
    expect(lines.some((line) => line.accountId === `acc:${ACC.INPUT_CGST}`)).toBe(false)
  })

  it('omits nil-rated tax legs entirely', () => {
    const lines = postPurchaseInvoice(ctx, {
      supplierAccountId: 'acc:sup-3',
      debitAccountId: `acc:${ACC.PURCHASES}`,
      taxable: toPaise(10000),
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: toPaise(10000),
    })

    expectBalanced(lines)
    expect(lines).toHaveLength(2)
  })

  it('absorbs a rupee rounding difference in the Round-off account', () => {
    const lines = postPurchaseInvoice(ctx, {
      supplierAccountId: 'acc:sup-4',
      debitAccountId: `acc:${ACC.PURCHASES}`,
      taxable: 1_234_567,
      cgst: 111_111,
      sgst: 111_111,
      igst: 0,
      total: 1_456_800,
    })

    expectBalanced(lines)
    expect(totalDebit(lines)).toBe(1_456_800)
  })

  it('can capitalise a purchase straight to a fixed asset', () => {
    const lines = postPurchaseInvoice(ctx, {
      supplierAccountId: 'acc:sup-5',
      debitAccountId: `acc:${ACC.COMPUTERS}`,
      taxable: toPaise(100000),
      cgst: toPaise(9000),
      sgst: toPaise(9000),
      igst: 0,
      total: toPaise(118000),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.COMPUTERS))).toBe(10_000_000)
    expect(debitTotalOf(lines, A(ACC.INVENTORY))).toBe(0)
  })
})

describe('postSalesInvoice', () => {
  it('posts an intra-state sale: Dr Customer, Cr Sales + Output GST', () => {
    const lines = postSalesInvoice(ctx, {
      customerAccountId: 'acc:cust-1',
      customerPartyId: 'cust-1',
      taxable: toPaise(80000),
      cgst: toPaise(7200),
      sgst: toPaise(7200),
      igst: 0,
      total: toPaise(94400),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, 'acc:cust-1')).toBe(9_440_000)
    expect(creditTotalOf(lines, A(ACC.SALES))).toBe(8_000_000)
    expect(creditTotalOf(lines, A(ACC.OUTPUT_CGST))).toBe(720_000)
    expect(creditTotalOf(lines, A(ACC.OUTPUT_SGST))).toBe(720_000)
  })

  it('posts an inter-state sale using IGST', () => {
    const lines = postSalesInvoice(ctx, {
      customerAccountId: 'acc:cust-2',
      taxable: toPaise(80000),
      cgst: 0,
      sgst: 0,
      igst: toPaise(14400),
      total: toPaise(94400),
    })

    expectBalanced(lines)
    expect(creditTotalOf(lines, A(ACC.OUTPUT_IGST))).toBe(1_440_000)
    expect(creditTotalOf(lines, A(ACC.OUTPUT_CGST))).toBe(0)
  })

  it('splits a mixed invoice between Sales and Service Income', () => {
    const lines = postSalesInvoice(ctx, {
      customerAccountId: 'acc:cust-3',
      taxable: toPaise(100000),
      serviceTaxable: toPaise(40000),
      cgst: toPaise(9000),
      sgst: toPaise(9000),
      igst: 0,
      total: toPaise(118000),
    })

    expectBalanced(lines)
    // Goods land in Sales, services in Service Income, and the two together
    // still equal the invoice's taxable value.
    expect(creditTotalOf(lines, A(ACC.SALES))).toBe(6_000_000)
    expect(creditTotalOf(lines, A(ACC.SERVICE_INCOME))).toBe(4_000_000)
  })

  it('posts a pure-service invoice entirely to Service Income', () => {
    const lines = postSalesInvoice(ctx, {
      customerAccountId: 'acc:cust-4',
      taxable: toPaise(4500),
      serviceTaxable: toPaise(4500),
      cgst: toPaise(405),
      sgst: toPaise(405),
      igst: 0,
      total: toPaise(5310),
    })

    expectBalanced(lines)
    expect(creditTotalOf(lines, A(ACC.SERVICE_INCOME))).toBe(450_000)
    expect(lines.some((line) => line.accountId === A(ACC.SALES))).toBe(false)
  })
})

describe('returns', () => {
  it('posts a sales return as a Credit Note', () => {
    const lines = postSalesReturn(ctx, {
      customerAccountId: 'acc:cust-1',
      taxable: toPaise(5000),
      cgst: toPaise(450),
      sgst: toPaise(450),
      igst: 0,
      total: toPaise(5900),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.SALES_RETURNS))).toBe(500_000)
    expect(debitTotalOf(lines, A(ACC.OUTPUT_CGST))).toBe(45_000)
    expect(creditTotalOf(lines, 'acc:cust-1')).toBe(590_000)
  })

  it('posts a purchase return as a Debit Note', () => {
    const lines = postPurchaseReturn(ctx, {
      supplierAccountId: 'acc:sup-1',
      taxable: toPaise(5000),
      cgst: toPaise(450),
      sgst: toPaise(450),
      igst: 0,
      total: toPaise(5900),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, 'acc:sup-1')).toBe(590_000)
    // Periodic method: a return simply reduces the period's purchases, so the
    // taxable value is credited back to Purchases.
    expect(creditTotalOf(lines, A(ACC.PURCHASES))).toBe(500_000)
    expect(creditTotalOf(lines, A(ACC.INPUT_CGST))).toBe(45_000)
  })
})

describe('inventory closing (periodic)', () => {
  it('charges opening stock and purchases to COGS and carries closing stock forward', () => {
    const lines = postInventoryClosing(ctx, {
      openingStock: toPaise(40000),
      purchases: toPaise(100000),
      closingStock: toPaise(30000),
    })

    expectBalanced(lines)
    // COGS nets to opening + purchases − closing = 40,000 + 100,000 − 30,000 =
    // 110,000; the debit side carries the 140,000 gross charge.
    expect(debitTotalOf(lines, A(ACC.COGS))).toBe(14_000_000)
    expect(creditTotalOf(lines, A(ACC.COGS))).toBe(3_000_000)
    // Purchases is cleared to nil, Inventory is left holding the closing stock.
    expect(creditTotalOf(lines, A(ACC.PURCHASES))).toBe(10_000_000)
    expect(debitTotalOf(lines, A(ACC.INVENTORY))).toBe(3_000_000)
    expect(creditTotalOf(lines, A(ACC.INVENTORY))).toBe(4_000_000)
  })

  it('returns nothing when the period is empty', () => {
    expect(
      postInventoryClosing(ctx, { openingStock: 0, purchases: 0, closingStock: 0 }),
    ).toHaveLength(0)
  })
})

describe('receipts, payments and contra', () => {
  it('posts a receipt against a customer', () => {
    const lines = postReceipt(ctx, {
      partyAccountId: 'acc:cust-1',
      partyId: 'cust-1',
      cashOrBankAccountId: `acc:${ACC.BANK}`,
      amount: toPaise(94400),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.BANK))).toBe(9_440_000)
    expect(creditTotalOf(lines, 'acc:cust-1')).toBe(9_440_000)
  })

  it('posts a payment to a supplier', () => {
    const lines = postPayment(ctx, {
      partyAccountId: 'acc:sup-1',
      partyId: 'sup-1',
      cashOrBankAccountId: `acc:${ACC.BANK}`,
      amount: toPaise(59000),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, 'acc:sup-1')).toBe(5_900_000)
    expect(creditTotalOf(lines, A(ACC.BANK))).toBe(5_900_000)
  })

  it('posts cash deposited into bank as a contra', () => {
    const lines = postContra(ctx, {
      fromAccountId: `acc:${ACC.CASH}`,
      toAccountId: `acc:${ACC.BANK}`,
      amount: toPaise(25000),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.BANK))).toBe(2_500_000)
    expect(creditTotalOf(lines, A(ACC.CASH))).toBe(2_500_000)
  })

  it('refuses a receipt of zero', () => {
    expect(() =>
      postReceipt(ctx, {
        partyAccountId: 'acc:cust-1',
        cashOrBankAccountId: `acc:${ACC.BANK}`,
        amount: 0,
      }),
    ).toThrow(PostingError)
  })
})

describe('postExpense', () => {
  it('withholds TDS and credits the net to the bank', () => {
    const lines = postExpense(ctx, {
      expenseAccountId: `acc:${ACC.RENT}`,
      amount: toPaise(20000),
      tdsAmount: toPaise(2000),
      creditAccountId: `acc:${ACC.BANK}`,
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.RENT))).toBe(2_000_000)
    expect(creditTotalOf(lines, A(ACC.TDS_PAYABLE))).toBe(200_000)
    expect(creditTotalOf(lines, A(ACC.BANK))).toBe(1_800_000)
  })

  it('rejects TDS larger than the expense', () => {
    expect(() =>
      postExpense(ctx, {
        expenseAccountId: `acc:${ACC.RENT}`,
        amount: toPaise(1000),
        tdsAmount: toPaise(2000),
        creditAccountId: `acc:${ACC.BANK}`,
      }),
    ).toThrow(PostingError)
  })
})

describe('postPayroll', () => {
  it('posts gross salary, employer PF and every deduction', () => {
    const lines = postPayroll(ctx, {
      gross: toPaise(50000),
      pfEmployee: toPaise(6000),
      pfEmployer: toPaise(6000),
      pt: toPaise(200),
      tds: toPaise(3000),
      otherDeductions: 0,
      net: toPaise(40800),
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.SALARIES))).toBe(5_000_000)
    expect(debitTotalOf(lines, A(ACC.EMPLOYER_PF))).toBe(600_000)
    expect(creditTotalOf(lines, A(ACC.PF_PAYABLE))).toBe(1_200_000)
    expect(creditTotalOf(lines, A(ACC.PT_PAYABLE))).toBe(20_000)
    expect(creditTotalOf(lines, A(ACC.TDS_PAYABLE))).toBe(300_000)
    expect(creditTotalOf(lines, A(ACC.SALARY_PAYABLE))).toBe(4_080_000)
  })

  it('refuses a payslip that does not reconcile', () => {
    expect(() =>
      postPayroll(ctx, {
        gross: toPaise(50000),
        pfEmployee: toPaise(6000),
        pfEmployer: toPaise(6000),
        pt: toPaise(200),
        tds: toPaise(3000),
        otherDeductions: 0,
        net: toPaise(99999),
      }),
    ).toThrow(/reconcile/)
  })

  it('posts the salary payment out of the bank', () => {
    const lines = postSalaryPayment(ctx, { amount: toPaise(40800), bankAccountId: `acc:${ACC.BANK}` })
    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.SALARY_PAYABLE))).toBe(4_080_000)
    expect(creditTotalOf(lines, A(ACC.BANK))).toBe(4_080_000)
  })
})

describe('postDepreciation', () => {
  it('charges depreciation against accumulated depreciation', () => {
    const lines = postDepreciation(ctx, toPaise(12500))
    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.DEPRECIATION))).toBe(1_250_000)
    expect(creditTotalOf(lines, A(ACC.ACCUM_DEPRECIATION))).toBe(1_250_000)
  })
})

describe('postGstSettlement', () => {
  it('clears output GST, claims input credit and books the net payable', () => {
    const lines = postGstSettlement(ctx, {
      outputCgst: toPaise(7200),
      outputSgst: toPaise(7200),
      outputIgst: 0,
      inputCgst: toPaise(4500),
      inputSgst: toPaise(4500),
      inputIgst: 0,
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.OUTPUT_CGST))).toBe(720_000)
    expect(creditTotalOf(lines, A(ACC.INPUT_CGST))).toBe(450_000)
    expect(creditTotalOf(lines, A(ACC.GST_PAYABLE))).toBe(540_000)
  })

  it('carries forward a negative net as input credit', () => {
    const lines = postGstSettlement(ctx, {
      outputCgst: 0,
      outputSgst: 0,
      outputIgst: 0,
      inputCgst: toPaise(4500),
      inputSgst: toPaise(4500),
      inputIgst: 0,
    })

    expectBalanced(lines)
    expect(debitTotalOf(lines, A(ACC.GST_PAYABLE))).toBe(900_000)
  })
})

describe('engine guard rails', () => {
  it('rejects an unbalanced journal', () => {
    expect(() =>
      postJournal(ctx, [
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 99 },
      ]),
    ).toThrow(/Unbalanced/)
  })

  it('rejects a line that is both a debit and a credit', () => {
    expect(() =>
      postJournal(ctx, [
        { accountId: 'a', debit: 100, credit: 100 },
        { accountId: 'b', debit: 0, credit: 0 },
      ]),
    ).toThrow(/both a debit and a credit/)
  })

  it('rejects a zero-amount line', () => {
    expect(() =>
      postJournal(ctx, [
        { accountId: 'a', debit: 0, credit: 0 },
        { accountId: 'b', debit: 100, credit: 0 },
      ]),
    ).toThrow(/zero amount/)
  })

  it('rejects an empty voucher', () => {
    expect(() => postJournal(ctx, [])).toThrow(PostingError)
  })

  it('accepts a balanced journal', () => {
    const lines = postJournal(ctx, [
      { accountId: 'a', debit: 500, credit: 0 },
      { accountId: 'b', debit: 0, credit: 500 },
    ])
    expectBalanced(lines)
  })
})
