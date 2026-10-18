import { ACC } from '@/db/coa'
import {
  db,
  type Allocation,
  type Voucher,
} from '@/db/schema'
import { getSetting, loadResolver, makeContext, setSetting, writeTx } from '@/db/tx'
import { postContra, postExpense, postPayment, postReceipt } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import type { Paise } from '@/lib/money'
import {
  ageingBucket,
  applyAllocations,
  openInvoices,
  settlementPlanKey,
  type SettlementPlan,
} from './allocations'
import { writeAudit } from './audit'
import { approveVoucher, createPendingVoucher, createVoucher, postVoucher, type Actor } from './ledger'

export type PaymentMode = 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'NEFT'

export const PAYMENT_MODES: PaymentMode[] = ['CASH', 'BANK', 'UPI', 'CHEQUE', 'NEFT']

export function isCashMode(mode: PaymentMode): boolean {
  return mode === 'CASH'
}

/**
 * Re-exported from `./allocations` so the cash screens can keep importing the
 * settlement helpers from `@/services/cashbank`.
 */
export {
  allocatedTo,
  ageingBucket,
  daysOverdue,
  openInvoices,
  outstandingOf,
  planOldestFirst,
} from './allocations'
export type { OpenInvoice } from './allocations'

/* ==========================================================================
 * Duplicate receipt / payment warning
 * ========================================================================== */

export interface DuplicateWarning {
  duplicate: boolean
  message?: string
  voucherNumber?: string
}

/**
 * The same party, amount and date is suspicious but not necessarily wrong, so
 * the operator is warned and asked to confirm rather than blocked outright.
 * (The hard block is reserved for duplicate *supplier invoices*.)
 */
export async function checkDuplicateSettlement(
  type: 'RECEIPT' | 'PAYMENT',
  partyId: string,
  amount: Paise,
  date: string,
  reference: string,
): Promise<DuplicateWarning> {
  const vouchers = await db.vouchers.where('type').equals(type).toArray()
  const candidates = vouchers.filter(
    (voucher) => voucher.partyId === partyId && voucher.amount === amount && voucher.date === date,
  )

  if (candidates.length === 0) return { duplicate: false }

  const withReference = reference
    ? candidates.find((voucher) => voucher.narration.toLowerCase().includes(reference.trim().toLowerCase()))
    : undefined

  const match = withReference ?? candidates[0]

  return {
    duplicate: true,
    voucherNumber: match.number,
    message: `A ${type.toLowerCase()} for the same party and amount already exists on this date (${match.number}). Post it only if this is genuinely a second transaction.`,
  }
}

/* ==========================================================================
 * Receipts and payments
 * ========================================================================== */

export interface SettlementOptions {
  partyId: string
  date: string
  amount: Paise
  mode: PaymentMode
  reference: string
  narration: string
  /** Explicit allocation; when omitted the amount settles oldest invoices first */
  allocateTo?: Array<{ invoiceId: string; amount: Paise }>
  /** Confirms the operator has seen a duplicate warning */
  acknowledgeDuplicate?: boolean
  /**
   * Raise the payment as a request that must be approved (and posted) by a
   * different, authorised user. Honoured by `createPayment`; receipts always
   * post immediately.
   */
  requireApproval?: boolean
}

export interface SettlementResult {
  voucher: Voucher
  allocations: Allocation[]
  unallocated: Paise
}

async function requirePartyAccount(
  type: 'CUSTOMER' | 'SUPPLIER',
  partyId: string,
): Promise<{ accountId: string; name: string }> {
  if (type === 'CUSTOMER') {
    const customer = await db.customers.get(partyId)
    if (!customer) throw new PostingError('Select a customer')
    return { accountId: customer.ledgerAccountId, name: customer.name }
  }
  const supplier = await db.suppliers.get(partyId)
  if (!supplier) throw new PostingError('Select a supplier')
  return { accountId: supplier.ledgerAccountId, name: supplier.name }
}

/** Customer receipt: Dr Bank/Cash, Cr Customer, then settle open invoices. */
export async function createReceipt(actor: Actor, options: SettlementOptions): Promise<SettlementResult> {
  return writeTx(async () => {
    if (options.amount <= 0) throw new PostingError('A receipt must be for a positive amount')

    const warning = await checkDuplicateSettlement(
      'RECEIPT',
      options.partyId,
      options.amount,
      options.date,
      options.reference,
    )
    if (warning.duplicate && !options.acknowledgeDuplicate) {
      throw new PostingError(warning.message ?? 'Possible duplicate receipt.')
    }

    const customer = await requirePartyAccount('CUSTOMER', options.partyId)
    const resolver = await loadResolver()

    const lines = postReceipt(makeContext(resolver, options.narration), {
      partyAccountId: customer.accountId,
      partyId: options.partyId,
      cashOrBankAccountId: resolver(isCashMode(options.mode) ? ACC.CASH : ACC.BANK),
      amount: options.amount,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'RECEIPT',
      date: options.date,
      narration: options.narration || `Received from ${customer.name}`,
      lines,
      partyId: options.partyId,
      refDocId: options.reference || null,
      refDocType: 'RECEIPT',
    })

    const { allocations, unallocated } = await applyAllocations(actor, {
      type: 'SALES',
      partyId: options.partyId,
      voucherId: voucher.id,
      voucherDate: voucher.date,
      amount: options.amount,
      allocateTo: options.allocateTo,
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Receipt ${voucher.number} from ${customer.name} for ${options.amount} (${options.mode})`,
      after: { amount: options.amount, allocated: options.amount - unallocated, unallocated },
    })

    return { voucher, allocations, unallocated }
  })
}

/** Supplier payment: Dr Supplier, Cr Bank/Cash, then settle open invoices. */
export async function createPayment(actor: Actor, options: SettlementOptions): Promise<SettlementResult> {
  return writeTx(async () => {
    if (options.amount <= 0) throw new PostingError('A payment must be for a positive amount')

    const warning = await checkDuplicateSettlement(
      'PAYMENT',
      options.partyId,
      options.amount,
      options.date,
      options.reference,
    )
    if (warning.duplicate && !options.acknowledgeDuplicate) {
      throw new PostingError(warning.message ?? 'Possible duplicate payment.')
    }

    const supplier = await requirePartyAccount('SUPPLIER', options.partyId)
    const resolver = await loadResolver()

    const lines = postPayment(makeContext(resolver, options.narration), {
      partyAccountId: supplier.accountId,
      partyId: options.partyId,
      cashOrBankAccountId: resolver(isCashMode(options.mode) ? ACC.CASH : ACC.BANK),
      amount: options.amount,
    })

    // The payment pathway: raise the payment as a pending request instead of
    // posting it. The voucher journeys DRAFT/PENDING -> APPROVED -> POSTED via
    // `releaseSettlement`, at which point the stored plan settles the invoices.
    if (options.requireApproval) {
      const voucher = await createPendingVoucher(actor, {
        type: 'PAYMENT',
        date: options.date,
        narration: options.narration || `Paid to ${supplier.name}`,
        lines,
        partyId: options.partyId,
        refDocId: options.reference || null,
        refDocType: 'PAYMENT',
      })

      // Park the settlement intent; the allocations are applied only once an
      // approver releases the request.
      await setSetting(settlementPlanKey(voucher.id), {
        type: 'PURCHASE',
        partyId: options.partyId,
        amount: options.amount,
        allocateTo: options.allocateTo,
      } satisfies SettlementPlan)

      return { voucher, allocations: [], unallocated: options.amount }
    }

    const { voucher } = await createVoucher(actor, {
      type: 'PAYMENT',
      date: options.date,
      narration: options.narration || `Paid to ${supplier.name}`,
      lines,
      partyId: options.partyId,
      refDocId: options.reference || null,
      refDocType: 'PAYMENT',
    })

    const { allocations, unallocated } = await applyAllocations(actor, {
      type: 'PURCHASE',
      partyId: options.partyId,
      voucherId: voucher.id,
      voucherDate: voucher.date,
      amount: options.amount,
      allocateTo: options.allocateTo,
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Payment ${voucher.number} to ${supplier.name} for ${options.amount} (${options.mode})`,
      after: { amount: options.amount, allocated: options.amount - unallocated, unallocated },
    })

    return { voucher, allocations, unallocated }
  })
}

/* ==========================================================================
 * Payment requests: approve, post and settle in one step
 * ========================================================================== */

/** The settlement intent stored for a pending payment request, if any. */
export async function settlementPlanFor(voucherId: string): Promise<SettlementPlan | null> {
  return getSetting<SettlementPlan | null>(settlementPlanKey(voucherId), null)
}

/**
 * Releases a payment request: an approver approves it (maker–checker and the
 * ₹25,000 threshold are enforced by `approveVoucher`), posts it, and settles the
 * invoices named in its stored plan. Safe to call when there is no plan — it then
 * behaves as a plain approve-and-post.
 */
export async function releaseSettlement(actor: Actor, voucherId: string): Promise<Voucher> {
  return writeTx(async () => {
    const voucher = await db.vouchers.get(voucherId)
    if (!voucher) throw new PostingError(`Voucher ${voucherId} was not found.`)
    if (voucher.status === 'POSTED') return voucher

    if (voucher.status === 'PENDING') {
      await approveVoucher(actor, voucherId)
    }

    // `postVoucher` applies the stored settlement plan as part of the same
    // transaction, so the ledger entries and the allocations commit together.
    const posted = await postVoucher(actor, voucherId)

    // Defensive second pass for a plan that a posting path did not consume.
    const plan = await settlementPlanFor(voucherId)
    if (plan) {
      await applyAllocations(actor, {
        type: plan.type,
        partyId: plan.partyId,
        voucherId,
        voucherDate: posted.date,
        amount: plan.amount,
        allocateTo: plan.allocateTo,
      })
      await db.settings.delete(settlementPlanKey(voucherId))
    }

    return posted
  })
}

/* ==========================================================================
 * Contra — moving money between cash and bank
 * ========================================================================== */

export async function createContra(
  actor: Actor,
  options: { date: string; fromAccountId: string; toAccountId: string; amount: Paise; narration: string },
): Promise<Voucher> {
  return writeTx(async () => {
    const resolver = await loadResolver()

    const lines = postContra(makeContext(resolver, options.narration), {
      fromAccountId: options.fromAccountId,
      toAccountId: options.toAccountId,
      amount: options.amount,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'CONTRA',
      date: options.date,
      narration: options.narration,
      lines,
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Contra ${voucher.number} for ${options.amount}: ${options.narration}`,
      after: { amount: options.amount },
    })

    return voucher
  })
}

/* ==========================================================================
 * Read models for the cash & bank screens
 * ========================================================================== */

export async function cashAndBankAccounts(): Promise<Array<{ id: string; code: string; name: string }>> {
  const rows = await db.accounts.toArray()
  return rows
    .filter((account) => account.isCash || account.isBank)
    .map((account) => ({ id: account.id, code: account.code, name: account.name }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

export async function balanceOfAccount(accountId: string): Promise<Paise> {
  const entries = await db.ledgerEntries.where('accountId').equals(accountId).toArray()
  return entries.reduce((total, entry) => total + entry.debit - entry.credit, 0)
}

/** Ageing summary used by the receivables and payables dashboards. */
export async function ageingSummary(
  type: 'SALES' | 'PURCHASE',
  asOn: string,
): Promise<{ bucket: string; amount: Paise; count: number }[]> {
  const open = await openInvoices(type, undefined, asOn)
  const buckets = new Map<string, { amount: Paise; count: number }>()

  for (const row of open) {
    const key = ageingBucket(row.daysOverdue)
    const current = buckets.get(key) ?? { amount: 0, count: 0 }
    current.amount += row.outstanding
    current.count += 1
    buckets.set(key, current)
  }

  const order = ['Not due', '0-30 days', '31-60 days', '61-90 days', 'Over 90 days']
  return order
    .filter((bucket) => buckets.has(bucket))
    .map((bucket) => ({ bucket, ...(buckets.get(bucket) as { amount: Paise; count: number }) }))
}

export async function allocationsForVoucher(voucherId: string): Promise<Allocation[]> {
  return db.allocations.where('voucherId').equals(voucherId).toArray()
}

/* ==========================================================================
 * Expenses
 * ========================================================================== */

export interface ExpenseOptions {
  date: string
  expenseAccountId: string
  /** Gross expense before withholding */
  amount: Paise
  tdsAmount?: Paise
  mode: PaymentMode
  reference?: string
  narration: string
  /** Credit an explicit account (e.g. a landlord's payable) instead of cash/bank */
  creditAccountId?: string
  creditPartyId?: string | null
  /** Raise the expense as a request that must be approved before it posts */
  requireApproval?: boolean
}

/**
 * Records a revenue expense paid from cash or bank, withholding TDS where the
 * payment attracts it. Example: rent of ₹20,000 with 10% TDS posts Dr Rent
 * 20,000, Cr TDS Payable 2,000, Cr Bank 18,000.
 *
 * With `requireApproval` the voucher is parked as a PENDING payment request;
 * `releaseSettlement` then approves, posts and (there being no plan) simply
 * leaves the ledger entries behind.
 */
export async function createExpense(actor: Actor, options: ExpenseOptions): Promise<Voucher> {
  return writeTx(async () => {
    const resolver = await loadResolver()

    const lines = postExpense(makeContext(resolver, options.narration), {
      expenseAccountId: options.expenseAccountId,
      amount: options.amount,
      tdsAmount: options.tdsAmount ?? 0,
      creditAccountId:
        options.creditAccountId ?? resolver(isCashMode(options.mode) ? ACC.CASH : ACC.BANK),
      creditPartyId: options.creditPartyId ?? null,
    })

    if (options.requireApproval) {
      return createPendingVoucher(actor, {
        type: 'PAYMENT',
        date: options.date,
        narration: options.narration,
        lines,
        partyId: options.creditPartyId ?? null,
        refDocId: options.reference || null,
        refDocType: 'EXPENSE',
      })
    }

    const { voucher } = await createVoucher(actor, {
      type: 'PAYMENT',
      date: options.date,
      narration: options.narration,
      lines,
      partyId: options.creditPartyId ?? null,
      refDocId: options.reference || null,
      refDocType: 'EXPENSE',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Expense ${voucher.number}: ${options.narration} for ${options.amount}${
        options.tdsAmount ? ` (TDS withheld ${options.tdsAmount})` : ''
      }`,
      after: { amount: options.amount, tds: options.tdsAmount ?? 0 },
    })

    return voucher
  })
}
