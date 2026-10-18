import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ACC } from '@/db/coa'
import { db, type Invoice } from '@/db/schema'
import { seedDatabase } from '@/db/seed'
import { todayISO } from '@/lib/format'
import {
  createExpense,
  createPayment,
  outstandingOf,
  releaseSettlement,
  settlementPlanFor,
} from '@/services/cashbank'
import { entriesForVoucher, type Actor } from '@/services/ledger'
import {
  approveInvoice,
  createPurchaseInvoice,
  submitInvoice,
  type PurchaseInvoiceInput,
} from '@/services/purchase'

/**
 * The cash payment pathway: a payment (or expense) is raised as a request, a
 * different authorised user approves it — enforcing maker–checker and the
 * ₹25,000 threshold — and only then does it post to the ledger and settle the
 * supplier's invoices.
 *
 * The demo data gives us a company, a chart of accounts, suppliers and users;
 * the documents under test are then built through the real services, so this
 * proves the pathway end to end rather than in isolation.
 */

const RUPEE = 100

let accountant: Actor
let admin: Actor
let manager: Actor
let supplierId: string
let today: string
let serial = 0

async function actorFor(username: string): Promise<Actor> {
  const user = await db.users.where('username').equals(username).first()
  if (!user) throw new Error(`seeded user ${username} is missing`)
  return { userId: user.id, username: user.username, role: user.role }
}

async function ledgerIsBalanced(): Promise<boolean> {
  const rows = await db.ledgerEntries.toArray()
  const debit = rows.reduce((total, row) => total + row.debit, 0)
  const credit = rows.reduce((total, row) => total + row.credit, 0)
  return debit === credit
}

/** A ₹taxableRupees + 18% intra-state purchase invoice input. */
function purchaseInvoice(
  partyInvoiceNumber: string,
  taxableRupees: number,
): PurchaseInvoiceInput {
  return {
    supplierId,
    partyInvoiceNumber,
    date: today,
    narration: `Test purchase ${partyInvoiceNumber}`,
    lines: [
      {
        itemId: null,
        description: 'Test goods',
        hsn: '8528',
        qty: 1,
        rate: taxableRupees * RUPEE,
        gstRate: 18,
      },
    ],
  }
}

/** Records, submits and approves a purchase invoice so it is open for settlement. */
async function postedPurchaseInvoice(partyInvoiceNumber: string, taxableRupees: number): Promise<Invoice> {
  const invoice = await createPurchaseInvoice(accountant, purchaseInvoice(partyInvoiceNumber, taxableRupees))
  await submitInvoice(accountant, invoice.id)
  return approveInvoice(admin, invoice.id)
}

beforeAll(async () => {
  await seedDatabase({ reset: true })
  accountant = await actorFor('accountant')
  admin = await actorFor('admin')
  manager = await actorFor('manager')
  today = todayISO()

  const supplier = await db.suppliers.where('code').equals('S001').first()
  if (!supplier) throw new Error('seeded supplier S001 is missing')
  supplierId = supplier.id
}, 600_000)

// Each test starts from clean transactional tables (masters, accounts, company,
// users and sequences survive), so a test never inherits another's ledger.
beforeEach(async () => {
  await Promise.all([
    db.vouchers.clear(),
    db.ledgerEntries.clear(),
    db.allocations.clear(),
    db.invoices.clear(),
    db.invoiceLines.clear(),
    db.settings.clear(),
    db.auditLog.clear(),
  ])
})

describe('payment requests', () => {
  it('raises a request as PENDING, with no ledger entries, plan stored and no allocation', async () => {
    const invoice = await postedPurchaseInvoice(`REQ-${++serial}`, 10_000)
    const amount = 1_000 * RUPEE

    const result = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount,
      mode: 'BANK',
      reference: `REQ-${serial}`,
      narration: 'Raise a request',
      requireApproval: true,
      acknowledgeDuplicate: true,
    })

    expect(result.voucher.status).toBe('PENDING')
    expect(result.allocations).toEqual([])
    expect(result.unallocated).toBe(amount)
    expect(await entriesForVoucher(result.voucher.id)).toHaveLength(0)

    const plan = await settlementPlanFor(result.voucher.id)
    expect(plan).not.toBeNull()
    expect(plan?.type).toBe('PURCHASE')
    expect(plan?.partyId).toBe(supplierId)
    expect(plan?.amount).toBe(amount)

    expect(await db.allocations.where('voucherId').equals(result.voucher.id).toArray()).toHaveLength(0)
    // The invoice is untouched until the request is released.
    expect(await outstandingOf(invoice)).toBe(invoice.total)
  })

  it('releases a request: approves, posts balanced entries, allocates and reduces the invoice outstanding', async () => {
    const invoice = await postedPurchaseInvoice(`APR-${++serial}`, 10_000)
    const outstandingBefore = await outstandingOf(invoice)
    const amount = 1_000 * RUPEE

    const created = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount,
      mode: 'BANK',
      reference: `APR-${serial}`,
      narration: 'Approve and settle',
      requireApproval: true,
      acknowledgeDuplicate: true,
      allocateTo: [{ invoiceId: invoice.id, amount }],
    })
    expect(created.voucher.status).toBe('PENDING')

    const released = await releaseSettlement(admin, created.voucher.id)
    expect(released.status).toBe('POSTED')

    const entries = await entriesForVoucher(created.voucher.id)
    expect(entries.length).toBeGreaterThan(0)
    const debit = entries.reduce((total, entry) => total + entry.debit, 0)
    const credit = entries.reduce((total, entry) => total + entry.credit, 0)
    expect(debit).toBe(credit)
    expect(debit).toBe(amount)

    const allocations = await db.allocations.where('voucherId').equals(created.voucher.id).toArray()
    expect(allocations).toHaveLength(1)
    expect(allocations[0].invoiceId).toBe(invoice.id)
    expect(allocations[0].amount).toBe(amount)

    expect(await outstandingOf(invoice)).toBe(outstandingBefore - amount)
    // The plan is consumed once the request is released.
    expect(await settlementPlanFor(created.voucher.id)).toBeNull()
    expect(await ledgerIsBalanced()).toBe(true)
  })

  it('refuses an APPROVER above the ₹25,000 threshold', async () => {
    // ₹30,000 is above the manager's ₹25,000 limit. A larger amount also leaves
    // plenty of headroom for the advance case (no open invoice needed).
    const created = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount: 3_000_000,
      mode: 'BANK',
      reference: `THR-${++serial}`,
      narration: 'Too big for a manager',
      requireApproval: true,
      acknowledgeDuplicate: true,
    })

    await expect(releaseSettlement(manager, created.voucher.id)).rejects.toThrow(/threshold/i)

    const stillPending = await db.vouchers.get(created.voucher.id)
    expect(stillPending?.status).toBe('PENDING')
    expect(await entriesForVoucher(created.voucher.id)).toHaveLength(0)
  })

  it('blocks the preparer from releasing their own request (maker–checker)', async () => {
    const created = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount: 500 * RUPEE,
      mode: 'BANK',
      reference: `MC-${++serial}`,
      narration: 'Self approval attempt',
      requireApproval: true,
      acknowledgeDuplicate: true,
    })

    await expect(releaseSettlement(accountant, created.voucher.id)).rejects.toThrow(/Maker–checker/i)
    expect(await entriesForVoucher(created.voucher.id)).toHaveLength(0)
  })

  it('is a no-op when releasing an already POSTED voucher', async () => {
    const created = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount: 1_000 * RUPEE,
      mode: 'BANK',
      reference: `NOOP-${++serial}`,
      narration: 'Already posted',
      acknowledgeDuplicate: true,
    })
    expect(created.voucher.status).toBe('POSTED')

    const entriesBefore = await entriesForVoucher(created.voucher.id)
    const released = await releaseSettlement(admin, created.voucher.id)

    expect(released.status).toBe('POSTED')
    expect(released.id).toBe(created.voucher.id)
    expect(await entriesForVoucher(created.voucher.id)).toHaveLength(entriesBefore.length)
    expect(await ledgerIsBalanced()).toBe(true)
  })
})

describe('expense requests', () => {
  it('raises an expense as PENDING and releases it to balanced ledger entries', async () => {
    const rent = await db.accounts.where('code').equals(ACC.RENT).first()
    if (!rent) throw new Error('chart of accounts is missing Rent')

    const created = await createExpense(accountant, {
      date: today,
      expenseAccountId: rent.id,
      amount: 2_000 * RUPEE,
      mode: 'BANK',
      narration: 'Office rent for the month',
      requireApproval: true,
    })
    expect(created.status).toBe('PENDING')
    expect(await entriesForVoucher(created.id)).toHaveLength(0)

    const released = await releaseSettlement(admin, created.id)
    expect(released.status).toBe('POSTED')

    const entries = await entriesForVoucher(created.id)
    expect(entries.length).toBeGreaterThan(0)
    const debit = entries.reduce((total, entry) => total + entry.debit, 0)
    const credit = entries.reduce((total, entry) => total + entry.credit, 0)
    expect(debit).toBe(credit)
    expect(debit).toBe(2_000 * RUPEE)
    expect(await ledgerIsBalanced()).toBe(true)
  })
})

describe('payment posting regression', () => {
  it('still posts immediately when requireApproval is not set', async () => {
    const created = await createPayment(accountant, {
      partyId: supplierId,
      date: today,
      amount: 1_000 * RUPEE,
      mode: 'CASH',
      reference: `DIRECT-${++serial}`,
      narration: 'Immediate payment',
      acknowledgeDuplicate: true,
    })

    expect(created.voucher.status).toBe('POSTED')
    expect(await entriesForVoucher(created.voucher.id)).toHaveLength(2)
    expect(await ledgerIsBalanced()).toBe(true)
  })
})
