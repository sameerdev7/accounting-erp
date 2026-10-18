import { db, type Allocation, type Invoice } from '@/db/schema'
import { PostingError } from '@/engine/types'
import { newId } from '@/lib/id'
import type { Paise } from '@/lib/money'

/* ==========================================================================
 * Settlement / allocation
 *
 * Outstanding position is derived from invoices less allocations, and a receipt
 * or payment may be spread across the party's open invoices. These helpers are
 * pure data access over `invoices` and `allocations`.
 *
 * They deliberately do NOT import the ledger service: `ledger.postVoucher`
 * applies a stored settlement plan after it writes its entries, and importing
 * `cashbank` (which imports `ledger`) from here would create an import cycle.
 * ========================================================================== */

export interface OpenInvoice {
  invoice: Invoice
  outstanding: Paise
  daysOverdue: number
}

/**
 * The settlement intent raised with a payment request. It is stashed in
 * `settings` under `settlement.plan.${voucherId}` and applied only once the
 * request has been approved and posted.
 */
export interface SettlementPlan {
  type: 'SALES' | 'PURCHASE'
  partyId: string
  amount: Paise
  allocateTo?: Array<{ invoiceId: string; amount: Paise }>
}

/** The settings key under which a voucher's pending settlement plan is stored. */
export function settlementPlanKey(voucherId: string): string {
  return `settlement.plan.${voucherId}`
}

/**
 * The actor fields the allocation writer needs. Declared locally rather than
 * importing `Actor` from `./ledger`, to keep this module free of a ledger import.
 */
export interface AllocationActor {
  userId: string
}

export function daysOverdue(dueDate: string, asOn: string): number {
  return Math.floor((Date.parse(`${asOn}T00:00:00`) - Date.parse(`${dueDate}T00:00:00`)) / 86_400_000)
}

export function ageingBucket(days: number): string {
  if (days <= 0) return 'Not due'
  if (days <= 30) return '0-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return 'Over 90 days'
}

/** Sum of allocations already applied to an invoice. */
export async function allocatedTo(invoiceId: string): Promise<Paise> {
  const rows = await db.allocations.where('invoiceId').equals(invoiceId).toArray()
  return rows.reduce((total, row) => total + row.amount, 0)
}

export async function outstandingOf(invoice: Invoice): Promise<Paise> {
  return invoice.total - (await allocatedTo(invoice.id))
}

/**
 * Every invoice of the given type that still has money owing, oldest first so
 * that receipts and payments settle the longest-standing debt first.
 */
export async function openInvoices(
  type: 'SALES' | 'PURCHASE',
  partyId?: string,
  asOn: string = new Date().toISOString().slice(0, 10),
): Promise<OpenInvoice[]> {
  const rows = await db.invoices.where('type').equals(type).toArray()
  const allocations = await db.allocations.toArray()

  const allocatedByInvoice = new Map<string, Paise>()
  for (const row of allocations) {
    allocatedByInvoice.set(row.invoiceId, (allocatedByInvoice.get(row.invoiceId) ?? 0) + row.amount)
  }

  return rows
    .filter((invoice) => invoice.status === 'POSTED')
    .filter((invoice) => (partyId ? invoice.partyId === partyId : true))
    .map((invoice) => {
      const outstanding = invoice.total - (allocatedByInvoice.get(invoice.id) ?? 0)
      return { invoice, outstanding, daysOverdue: daysOverdue(invoice.dueDate, asOn) }
    })
    .filter((row) => row.outstanding !== 0)
    .sort((a, b) => (a.invoice.dueDate === b.invoice.dueDate ? 0 : a.invoice.dueDate < b.invoice.dueDate ? -1 : 1))
}

/**
 * Spreads an amount across the oldest unpaid invoices first — the standard
 * accounting practice, and the behaviour the UI offers as "settle oldest first".
 */
export function planOldestFirst(open: OpenInvoice[], amount: Paise): Array<{ invoiceId: string; amount: Paise }> {
  let remaining = amount
  const plan: Array<{ invoiceId: string; amount: Paise }> = []

  for (const row of open) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, row.outstanding)
    if (applied > 0) {
      plan.push({ invoiceId: row.invoice.id, amount: applied })
      remaining -= applied
    }
  }

  return plan
}

/**
 * Writes the allocation rows that settle a receipt or payment against open
 * invoices. When no explicit split is supplied the oldest invoices are settled
 * first; whatever is left over is treated as an advance and returned as
 * `unallocated`.
 */
export async function applyAllocations(
  actor: AllocationActor,
  options: {
    type: 'SALES' | 'PURCHASE'
    partyId: string
    voucherId: string
    voucherDate: string
    amount: Paise
    allocateTo?: Array<{ invoiceId: string; amount: Paise }>
  },
): Promise<{ allocations: Allocation[]; unallocated: Paise }> {
  const open = await openInvoices(options.type, options.partyId, options.voucherDate)

  const plan =
    options.allocateTo && options.allocateTo.length > 0
      ? options.allocateTo
      : planOldestFirst(open, options.amount)

  const openById = new Map(open.map((row) => [row.invoice.id, row]))
  const now = Date.now()
  const allocations: Allocation[] = []
  let allocated = 0

  for (const item of plan) {
    const invoice = openById.get(item.invoiceId)
    if (!invoice) {
      throw new PostingError('That invoice is not open against this party any more. Refresh and try again.')
    }
    if (item.amount <= 0) continue
    if (item.amount > invoice.outstanding) {
      throw new PostingError(
        `Cannot allocate ${item.amount} to ${invoice.invoice.number} — only ${invoice.outstanding} is outstanding.`,
      )
    }

    allocations.push({
      id: newId('alloc'),
      invoiceId: item.invoiceId,
      voucherId: options.voucherId,
      partyId: options.partyId,
      amount: item.amount,
      createdAt: now,
      createdBy: actor.userId,
    })
    allocated += item.amount
  }

  if (allocated > options.amount) {
    throw new PostingError('Allocations exceed the amount of the receipt or payment.')
  }

  if (allocations.length > 0) await db.allocations.bulkAdd(allocations)

  return { allocations, unallocated: options.amount - allocated }
}
