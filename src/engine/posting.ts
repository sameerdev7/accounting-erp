import type { Paise } from '@/lib/money'
import { ACC } from '@/db/coa'
import {
  PostingError,
  type JournalLine,
  type PostingContext,
} from './types'
import { assertBalanced, balanceWithRoundOff, dropEmptyLines, validateLines } from './validators'

/* ==========================================================================
 * Line builders
 * ========================================================================== */

export function dr(
  accountId: string,
  amount: Paise,
  partyId?: string | null,
  narration?: string,
): JournalLine {
  return { accountId, debit: amount, credit: 0, partyId: partyId ?? null, narration }
}

export function cr(
  accountId: string,
  amount: Paise,
  partyId?: string | null,
  narration?: string,
): JournalLine {
  return { accountId, debit: 0, credit: amount, partyId: partyId ?? null, narration }
}

/**
 * Compose a voucher from a plain list of debits and credits. Unlike the
 * transaction-specific posters, the caller's lines are validated as supplied —
 * a hand-entered zero-amount line is an operator mistake, not an optional leg,
 * so it is rejected rather than silently dropped.
 */
export function postJournal(_ctx: PostingContext, lines: JournalLine[]): JournalLine[] {
  validateLines(lines)
  const cleaned = dropEmptyLines(lines)
  assertBalanced(cleaned)
  return cleaned
}

/* ==========================================================================
 * Opening balances
 * ========================================================================== */

export interface OpeningBalanceInput {
  accountId: string
  debit: Paise
  credit: Paise
  partyId?: string | null
  narration?: string
}

/**
 * The opening-balance voucher. It is the one posting allowed to carry many
 * lines of unrelated accounts, because it establishes every balance at once.
 */
export function postOpeningBalances(
  _ctx: PostingContext,
  lines: OpeningBalanceInput[],
): JournalLine[] {
  const cleaned = dropEmptyLines(
    lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      partyId: line.partyId ?? null,
      narration: line.narration,
    })),
  )

  if (cleaned.length === 0) {
    throw new PostingError('The opening balance voucher has no lines')
  }
  assertBalanced(cleaned)
  return cleaned
}

/* ==========================================================================
 * Purchases
 * ========================================================================== */

export interface PurchaseInvoiceInput {
  /** Supplier sub-ledger account (credited) */
  supplierAccountId: string
  /**
   * Normally the Purchases account (periodic method). A capital purchase passes
   * the fixed-asset account instead.
   */
  debitAccountId: string
  supplierPartyId?: string | null
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  /** Rounded invoice total actually payable */
  total: Paise
}

/**
 * Dr Purchases (or Fixed Asset), Dr Input CGST/SGST/IGST  ·  Cr Supplier
 * Any rounding difference goes to the Round-off account.
 */
export function postPurchaseInvoice(ctx: PostingContext, input: PurchaseInvoiceInput): JournalLine[] {
  const lines: JournalLine[] = [
    dr(input.debitAccountId, input.taxable, null, ctx.narration),
    dr(ctx.resolve(ACC.INPUT_CGST), input.cgst, null, 'Input CGST'),
    dr(ctx.resolve(ACC.INPUT_SGST), input.sgst, null, 'Input SGST'),
    dr(ctx.resolve(ACC.INPUT_IGST), input.igst, null, 'Input IGST'),
    cr(input.supplierAccountId, input.total, input.supplierPartyId ?? null, ctx.narration),
  ]

  return balanceWithRoundOff(
    dropEmptyLines(lines),
    ctx.resolve(ACC.ROUND_OFF),
    'purchase invoice',
  )
}

export interface PurchaseReturnInput {
  supplierAccountId: string
  supplierPartyId?: string | null
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  total: Paise
}

/**
 * Purchase return (Debit Note):
 * Dr Supplier  ·  Cr Purchases, Cr Input CGST/SGST/IGST
 *
 * Under the periodic method a return simply reduces the purchases of the
 * period, so the taxable value is credited back to Purchases — the account the
 * purchase invoice debited. Stock quantity is corrected separately through the
 * goods movement, and the closing-stock entry values whatever remains.
 */
export function postPurchaseReturn(ctx: PostingContext, input: PurchaseReturnInput): JournalLine[] {
  const lines: JournalLine[] = [
    dr(input.supplierAccountId, input.total, input.supplierPartyId ?? null, ctx.narration),
    cr(ctx.resolve(ACC.PURCHASES), input.taxable, null, `${ctx.narration} — purchases returned`),
    cr(ctx.resolve(ACC.INPUT_CGST), input.cgst, null, 'Input CGST reversed'),
    cr(ctx.resolve(ACC.INPUT_SGST), input.sgst, null, 'Input SGST reversed'),
    cr(ctx.resolve(ACC.INPUT_IGST), input.igst, null, 'Input IGST reversed'),
  ]

  return balanceWithRoundOff(dropEmptyLines(lines), ctx.resolve(ACC.ROUND_OFF), 'purchase return')
}

/* ==========================================================================
 * Sales
 * ========================================================================== */

export interface SalesInvoiceInput {
  customerAccountId: string
  customerPartyId?: string | null
  /** Total taxable value (goods + services) */
  taxable: Paise
  /**
   * The part of `taxable` that is services. It is credited to Service Income
   * (4003) rather than Sales (4001), so the two revenue streams stay separable
   * in the profit and loss account. Defaults to zero.
   */
  serviceTaxable?: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  total: Paise
}

/**
 * Dr Customer  ·  Cr Sales / Service Income, Cr Output CGST/SGST/IGST
 */
export function postSalesInvoice(ctx: PostingContext, input: SalesInvoiceInput): JournalLine[] {
  const serviceTaxable = input.serviceTaxable ?? 0
  const goodsTaxable = input.taxable - serviceTaxable
  const lines: JournalLine[] = [
    dr(input.customerAccountId, input.total, input.customerPartyId ?? null, ctx.narration),
    cr(ctx.resolve(ACC.SALES), goodsTaxable, null, ctx.narration),
    cr(ctx.resolve(ACC.SERVICE_INCOME), serviceTaxable, null, `${ctx.narration} — services`),
    cr(ctx.resolve(ACC.OUTPUT_CGST), input.cgst, null, 'Output CGST'),
    cr(ctx.resolve(ACC.OUTPUT_SGST), input.sgst, null, 'Output SGST'),
    cr(ctx.resolve(ACC.OUTPUT_IGST), input.igst, null, 'Output IGST'),
  ]

  return balanceWithRoundOff(dropEmptyLines(lines), ctx.resolve(ACC.ROUND_OFF), 'sales invoice')
}

export interface SalesReturnInput {
  customerAccountId: string
  customerPartyId?: string | null
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  total: Paise
}

/**
 * Sales return (Credit Note):
 * Dr Sales Returns, Dr Output CGST/SGST/IGST  ·  Cr Customer
 */
export function postSalesReturn(ctx: PostingContext, input: SalesReturnInput): JournalLine[] {
  const lines: JournalLine[] = [
    dr(ctx.resolve(ACC.SALES_RETURNS), input.taxable, null, ctx.narration),
    dr(ctx.resolve(ACC.OUTPUT_CGST), input.cgst, null, 'Output CGST reversed'),
    dr(ctx.resolve(ACC.OUTPUT_SGST), input.sgst, null, 'Output SGST reversed'),
    dr(ctx.resolve(ACC.OUTPUT_IGST), input.igst, null, 'Output IGST reversed'),
    cr(input.customerAccountId, input.total, input.customerPartyId ?? null, ctx.narration),
  ]

  return balanceWithRoundOff(dropEmptyLines(lines), ctx.resolve(ACC.ROUND_OFF), 'credit note')
}

/**
 * Period-end inventory closing (periodic method).
 *
 * Until the close, purchases are held in the Purchases account and inventory is
 * not carried in the ledger. This one entry converts the period's activity into
 * a cost of sales and carries the unsold goods forward as an asset:
 *
 *   Dr Cost of Goods Sold   opening stock   ·  Cr Inventory        opening stock
 *   Dr Cost of Goods Sold   purchases       ·  Cr Purchases        purchases
 *   Dr Inventory            closing stock   ·  Cr Cost of Goods Sold closing stock
 *
 * Net effect: COGS = opening + purchases − closing, Purchases returns to nil,
 * and Inventory holds exactly the closing stock. Run once per period, after the
 * period's goods movements have been recorded.
 */
export interface InventoryClosingInput {
  /** Stock value brought forward (the Inventory balance before the close) */
  openingStock: Paise
  /** Net purchases for the period */
  purchases: Paise
  /** Stock value carried forward, from the goods movements */
  closingStock: Paise
}

export function postInventoryClosing(
  ctx: PostingContext,
  input: InventoryClosingInput,
): JournalLine[] {
  const lines: JournalLine[] = [
    dr(ctx.resolve(ACC.COGS), input.openingStock, null, 'Opening stock charged to cost of sales'),
    cr(ctx.resolve(ACC.INVENTORY), input.openingStock, null, 'Opening stock cleared'),
    dr(ctx.resolve(ACC.COGS), input.purchases, null, 'Purchases transferred to cost of sales'),
    cr(ctx.resolve(ACC.PURCHASES), input.purchases, null, 'Purchases cleared for the period'),
    dr(ctx.resolve(ACC.INVENTORY), input.closingStock, null, 'Closing stock carried forward'),
    cr(ctx.resolve(ACC.COGS), input.closingStock, null, 'Closing stock credited to cost of sales'),
  ]

  const cleaned = dropEmptyLines(lines)
  if (cleaned.length === 0) return []
  assertBalanced(cleaned)
  return cleaned
}

/* ==========================================================================
 * Receipts, payments and contra entries
 * ========================================================================== */

export interface SettlementInput {
  /** Customer sub-ledger for a receipt, supplier sub-ledger for a payment */
  partyAccountId: string
  partyId?: string | null
  /** Cash in Hand or the bank account */
  cashOrBankAccountId: string
  amount: Paise
}

/** Dr Bank/Cash  ·  Cr Customer */
export function postReceipt(ctx: PostingContext, input: SettlementInput): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('A receipt must be for a positive amount')
  const lines = [
    dr(input.cashOrBankAccountId, input.amount, null, ctx.narration),
    cr(input.partyAccountId, input.amount, input.partyId ?? null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

/** Dr Supplier  ·  Cr Bank/Cash */
export function postPayment(ctx: PostingContext, input: SettlementInput): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('A payment must be for a positive amount')
  const lines = [
    dr(input.partyAccountId, input.amount, input.partyId ?? null, ctx.narration),
    cr(input.cashOrBankAccountId, input.amount, null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

export interface ContraInput {
  fromAccountId: string
  toAccountId: string
  amount: Paise
}

/** Cash deposited into bank: Dr Bank  ·  Cr Cash */
export function postContra(ctx: PostingContext, input: ContraInput): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('A contra entry must be for a positive amount')
  const lines = [
    dr(input.toAccountId, input.amount, null, ctx.narration),
    cr(input.fromAccountId, input.amount, null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

/* ==========================================================================
 * Expenses
 * ========================================================================== */

export interface ExpenseInput {
  expenseAccountId: string
  /** Gross expense before withholding */
  amount: Paise
  /** TDS withheld at source */
  tdsAmount: Paise
  /** Account that actually pays: bank, cash, or a party payable */
  creditAccountId: string
  creditPartyId?: string | null
}

/**
 * Dr Expense (gross)  ·  Cr TDS Payable, Cr Bank/Cash or party
 * Example: rent of ₹20,000 with 10% TDS -> Dr Rent 20,000, Cr TDS Payable 2,000,
 * Cr Bank 18,000.
 */
export function postExpense(ctx: PostingContext, input: ExpenseInput): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('An expense must be for a positive amount')
  if (input.tdsAmount < 0 || input.tdsAmount > input.amount) {
    throw new PostingError('TDS cannot be negative or exceed the expense amount')
  }

  const lines: JournalLine[] = [
    dr(input.expenseAccountId, input.amount, null, ctx.narration),
    cr(ctx.resolve(ACC.TDS_PAYABLE), input.tdsAmount, null, 'TDS withheld'),
    cr(input.creditAccountId, input.amount - input.tdsAmount, input.creditPartyId ?? null, ctx.narration),
  ]

  assertBalanced(dropEmptyLines(lines))
  return dropEmptyLines(lines)
}

/* ==========================================================================
 * Payroll
 * ========================================================================== */

export interface PayrollInput {
  /** Gross salary = basic + hra + allowances */
  gross: Paise
  /** Employee's own PF contribution, withheld from salary */
  pfEmployee: Paise
  /** Company's matching PF contribution, an additional cost */
  pfEmployer: Paise
  pt: Paise
  tds: Paise
  otherDeductions: Paise
  /** Take-home pay = gross - pfEmployee - pt - tds - otherDeductions */
  net: Paise
}

/**
 * Dr Salaries & Wages (gross), Dr Employer PF Contribution
 *   ·  Cr PF Payable, Cr Professional Tax Payable, Cr TDS Payable,
 *      Cr Expenses Payable (other deductions), Cr Salary Payable (net)
 */
export function postPayroll(ctx: PostingContext, input: PayrollInput): JournalLine[] {
  const expectedNet =
    input.gross - input.pfEmployee - input.pt - input.tds - input.otherDeductions

  if (expectedNet !== input.net) {
    throw new PostingError(
      `Payslip does not reconcile: gross ${input.gross} less deductions gives ${expectedNet}, but net was ${input.net}`,
    )
  }

  const lines: JournalLine[] = [
    dr(ctx.resolve(ACC.SALARIES), input.gross, null, ctx.narration),
    dr(ctx.resolve(ACC.EMPLOYER_PF), input.pfEmployer, null, 'Employer PF contribution'),
    cr(ctx.resolve(ACC.PF_PAYABLE), input.pfEmployee + input.pfEmployer, null, 'PF payable'),
    cr(ctx.resolve(ACC.PT_PAYABLE), input.pt, null, 'Professional tax payable'),
    cr(ctx.resolve(ACC.TDS_PAYABLE), input.tds, null, 'TDS payable'),
    cr(ctx.resolve(ACC.EXPENSES_PAYABLE), input.otherDeductions, null, 'Other deductions'),
    cr(ctx.resolve(ACC.SALARY_PAYABLE), input.net, null, 'Net salary payable'),
  ]

  const cleaned = dropEmptyLines(lines)
  assertBalanced(cleaned)
  return cleaned
}

/** Dr Salary Payable  ·  Cr Bank */
export function postSalaryPayment(
  ctx: PostingContext,
  input: { amount: Paise; bankAccountId: string },
): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('A salary payment must be for a positive amount')
  const lines = [
    dr(ctx.resolve(ACC.SALARY_PAYABLE), input.amount, null, ctx.narration),
    cr(input.bankAccountId, input.amount, null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

/** Statutory remittance: Dr PF Payable / TDS Payable / PT Payable  ·  Cr Bank */
export function postStatutoryPayment(
  ctx: PostingContext,
  input: { liabilityCode: string; amount: Paise; bankAccountId: string },
): JournalLine[] {
  if (input.amount <= 0) throw new PostingError('A statutory payment must be for a positive amount')
  const lines = [
    dr(ctx.resolve(input.liabilityCode), input.amount, null, ctx.narration),
    cr(input.bankAccountId, input.amount, null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

/* ==========================================================================
 * Fixed assets
 * ========================================================================== */

/** Dr Depreciation Expense  ·  Cr Accumulated Depreciation */
export function postDepreciation(ctx: PostingContext, amount: Paise): JournalLine[] {
  if (amount <= 0) throw new PostingError('Depreciation must be for a positive amount')
  const lines = [
    dr(ctx.resolve(ACC.DEPRECIATION), amount, null, ctx.narration),
    cr(ctx.resolve(ACC.ACCUM_DEPRECIATION), amount, null, ctx.narration),
  ]
  assertBalanced(lines)
  return lines
}

/* ==========================================================================
 * GST settlement
 * ========================================================================== */

export interface GstSettlementInput {
  outputCgst: Paise
  outputSgst: Paise
  outputIgst: Paise
  inputCgst: Paise
  inputSgst: Paise
  inputIgst: Paise
}

/**
 * Clears the GST control accounts for a period:
 *   Dr Output CGST/SGST/IGST   (extinguishes the liability)
 *   Cr Input CGST/SGST/IGST    (claims the credit)
 *   Dr/Cr GST Payable          (the net position)
 *
 * A positive net is payable to the government; a negative net is an input
 * credit carried forward.
 */
export function postGstSettlement(ctx: PostingContext, input: GstSettlementInput): JournalLine[] {
  const lines: JournalLine[] = [
    dr(ctx.resolve(ACC.OUTPUT_CGST), input.outputCgst, null, 'Output CGST cleared'),
    dr(ctx.resolve(ACC.OUTPUT_SGST), input.outputSgst, null, 'Output SGST cleared'),
    dr(ctx.resolve(ACC.OUTPUT_IGST), input.outputIgst, null, 'Output IGST cleared'),
    cr(ctx.resolve(ACC.INPUT_CGST), input.inputCgst, null, 'Input CGST claimed'),
    cr(ctx.resolve(ACC.INPUT_SGST), input.inputSgst, null, 'Input SGST claimed'),
    cr(ctx.resolve(ACC.INPUT_IGST), input.inputIgst, null, 'Input IGST claimed'),
  ]

  const outputTotal = input.outputCgst + input.outputSgst + input.outputIgst
  const inputTotal = input.inputCgst + input.inputSgst + input.inputIgst
  const net = outputTotal - inputTotal

  if (net > 0) {
    lines.push(cr(ctx.resolve(ACC.GST_PAYABLE), net, null, 'Net GST payable'))
  } else if (net < 0) {
    lines.push(dr(ctx.resolve(ACC.GST_PAYABLE), -net, null, 'Input credit carried forward'))
  }

  const cleaned = dropEmptyLines(lines)
  if (cleaned.length === 0) {
    throw new PostingError('Nothing to settle — both output and input GST are zero')
  }
  assertBalanced(cleaned)
  return cleaned
}
