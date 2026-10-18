import { beforeAll, describe, expect, it } from 'vitest'
import { format, subMonths } from 'date-fns'
import { ACC } from '@/db/coa'
import { db } from '@/db/schema'
import { seedDatabase } from '@/db/seed'
import { todayISO } from '@/lib/format'
import { lockPeriod, unlockPeriod } from '@/services/admin'
import { createReceipt, openInvoices } from '@/services/cashbank'
import { assertMakerChecker } from '@/services/controls'
import {
  approveVoucher,
  createManualJournal,
  entriesForVoucher,
  reverseVoucher,
  submitVoucher,
  type Actor,
} from '@/services/ledger'
import {
  approveInvoice,
  createPurchaseInvoice,
  submitInvoice,
  type PurchaseInvoiceInput,
} from '@/services/purchase'

/**
 * Section 11's controls and section 12b's step-8 assertions, exercised through
 * the real services rather than the UI. The UI enforces nothing on its own, so
 * proving it here proves it everywhere.
 */

const RUPEE = 100

let accountant: Actor
let admin: Actor
let manager: Actor
let supplierId: string
let supplierLedgerId: string
let inputCgstId: string
let today: string
let serial = 0

async function actorFor(username: string): Promise<Actor> {
  const user = await db.users.where('username').equals(username).first()
  if (!user) throw new Error(`seeded user ${username} is missing`)
  return { userId: user.id, username: user.username, role: user.role }
}

async function accountIdOf(code: string): Promise<string> {
  const account = await db.accounts.where('code').equals(code).first()
  if (!account) throw new Error(`missing account ${code}`)
  return account.id
}

/** Net debit (debit − credit) for one account across the whole ledger. */
async function netDebit(accountId: string): Promise<number> {
  const rows = await db.ledgerEntries.where('accountId').equals(accountId).toArray()
  return rows.reduce((total, row) => total + row.debit - row.credit, 0)
}

async function ledgerIsBalanced(): Promise<boolean> {
  const rows = await db.ledgerEntries.toArray()
  const debit = rows.reduce((total, row) => total + row.debit, 0)
  const credit = rows.reduce((total, row) => total + row.credit, 0)
  return debit === credit
}

/** A ₹50,000 + 18% intra-state purchase invoice (₹59,000 all in). */
function intraStateInvoice(partyInvoiceNumber: string, taxableRupees: number): PurchaseInvoiceInput {
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

async function raiseAndSubmit(input: PurchaseInvoiceInput) {
  const invoice = await createPurchaseInvoice(accountant, input)
  await submitInvoice(accountant, invoice.id)
  return invoice
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
  supplierLedgerId = supplier.ledgerAccountId
  inputCgstId = await accountIdOf(ACC.INPUT_CGST)
}, 600_000)

describe('approval hierarchy (section 11)', () => {
  it('posts a ₹50,000 purchase as CGST/SGST and a ₹59,000 payable', async () => {
    const payableBefore = await netDebit(supplierLedgerId)
    const inputBefore = await netDebit(inputCgstId)

    const invoice = await raiseAndSubmit(intraStateInvoice(`HIER-${++serial}`, 50_000))
    expect(invoice.taxable).toBe(5_000_000)
    expect(invoice.cgst).toBe(450_000)
    expect(invoice.sgst).toBe(450_000)
    expect(invoice.igst).toBe(0)
    expect(invoice.total).toBe(5_900_000)

    const approved = await approveInvoice(admin, invoice.id)
    expect(approved.status).toBe('POSTED')

    // A payable reduces the debit balance of the supplier sub-ledger, i.e. the
    // supplier is credited ₹59,000; input CGST rises by ₹4,500.
    expect((await netDebit(supplierLedgerId)) - payableBefore).toBe(-5_900_000)
    expect((await netDebit(inputCgstId)) - inputBefore).toBe(450_000)
    expect(await ledgerIsBalanced()).toBe(true)
  })

  it('refuses a manager an above-threshold invoice but allows the Finance Head', async () => {
    const invoice = await raiseAndSubmit(intraStateInvoice(`HIER-${++serial}`, 50_000))

    await expect(approveInvoice(manager, invoice.id)).rejects.toThrow(/threshold/i)

    // Still pending, and the Finance Head can clear it.
    const stillPending = await db.invoices.get(invoice.id)
    expect(stillPending?.status).toBe('PENDING')
    const approved = await approveInvoice(admin, invoice.id)
    expect(approved.status).toBe('POSTED')
  })

  it('allows a manager to approve within the ₹25,000 threshold', async () => {
    // ₹20,000 + 18% = ₹23,600, comfortably inside the manager's limit.
    const invoice = await raiseAndSubmit(intraStateInvoice(`HIER-${++serial}`, 20_000))
    const approved = await approveInvoice(manager, invoice.id)
    expect(approved.status).toBe('POSTED')
  })
})

describe('maker–checker (section 11)', () => {
  it('blocks a voucher from being approved by the person who prepared it', async () => {
    const cash = await accountIdOf(ACC.CASH)
    const bank = await accountIdOf(ACC.BANK)

    const voucher = await createManualJournal(admin, {
      date: today,
      narration: 'Self-approval attempt',
      // Dr Bank / Cr Cash — a balanced contra journal.
      lines: [
        { accountId: bank, debit: 1_000 * RUPEE, credit: 0 },
        { accountId: cash, debit: 0, credit: 1_000 * RUPEE },
      ],
      postNow: false,
    })

    await submitVoucher(admin, voucher.id)
    await expect(approveVoucher(admin, voucher.id)).rejects.toThrow(/Maker–checker/i)

    // The control is also available as a pure predicate.
    expect(() => assertMakerChecker('user-1', 'user-1')).toThrow()
    expect(() => assertMakerChecker('user-1', 'user-2')).not.toThrow()
  })
})

describe('duplicate prevention (section 11)', () => {
  it('blocks recording the same supplier invoice number twice', async () => {
    const reference = `DUP-${++serial}`
    await createPurchaseInvoice(accountant, intraStateInvoice(reference, 10_000))

    await expect(
      createPurchaseInvoice(accountant, intraStateInvoice(reference, 10_000)),
    ).rejects.toThrow(/already been recorded/i)
  })
})

describe('voucher immutability (section 11)', () => {
  it('corrects a posted voucher by reversal and keeps the books balanced', async () => {
    const invoice = await raiseAndSubmit(intraStateInvoice(`REV-${++serial}`, 30_000))
    await approveInvoice(admin, invoice.id)

    const voucherId = invoice.voucherId
    expect(voucherId).toBeTruthy()

    const payableBefore = await netDebit(supplierLedgerId)
    const entriesBefore = await entriesForVoucher(voucherId!)

    // The voucher exists in the ledger and cannot be un-posted by any API.
    expect(entriesBefore.length).toBeGreaterThan(0)

    const reversal = await reverseVoucher(admin, voucherId!, 'Goods returned to supplier')

    const original = await db.vouchers.get(voucherId!)
    expect(original?.status).toBe('REVERSED')
    expect(original?.reversedBy).toBe(reversal.id)
    expect(reversal.reversalOf).toBe(voucherId)

    // The mirror entry cancels the original's effect on the supplier ledger.
    const payableAfter = await netDebit(supplierLedgerId)
    expect(payableAfter - payableBefore).toBe(3_540_000) // it was credited 3,540,000

    // Reversing again is refused — the original is no longer POSTED.
    await expect(reverseVoucher(admin, voucherId!, 'again')).rejects.toThrow(
      /only a posted voucher can be reversed|already been reversed/i,
    )

    expect(await ledgerIsBalanced()).toBe(true)
  })

  it('refuses to post a voucher that has already been reversed', async () => {
    const invoice = await raiseAndSubmit(intraStateInvoice(`REV2-${++serial}`, 5_000))
    await approveInvoice(admin, invoice.id)
    await reverseVoucher(admin, invoice.voucherId!, 'test')
    await expect(approveVoucher(admin, invoice.voucherId!)).rejects.toThrow()
  })
})

describe('settlement and ageing', () => {
  it('clears a debtors invoice when a receipt is allocated to it', async () => {
    const open = await openInvoices('SALES', undefined, today)
    expect(open.length).toBeGreaterThan(0)

    const target = open[0]
    const result = await createReceipt(accountant, {
      partyId: target.invoice.partyId,
      date: today,
      amount: target.outstanding,
      mode: 'BANK',
      reference: `RCPT-TEST-${++serial}`,
      narration: 'Clears the oldest open invoice',
      allocateTo: [{ invoiceId: target.invoice.id, amount: target.outstanding }],
      acknowledgeDuplicate: true,
    })

    expect(result.allocations).toHaveLength(1)

    const after = await openInvoices('SALES', target.invoice.partyId, today)
    expect(after.find((row) => row.invoice.id === target.invoice.id)).toBeUndefined()
  })
})

describe('period lock (section 11)', () => {
  it('blocks a posting into a closed period until it is re-opened', async () => {
    const closedMonth = format(subMonths(new Date(), 8), 'yyyy-MM')
    const closedDate = `${closedMonth}-15`

    const lock = await lockPeriod(admin, {
      period: closedMonth,
      type: 'MONTH',
      note: 'Test closure',
    })

    const cash = await accountIdOf(ACC.CASH)
    const bank = await accountIdOf(ACC.BANK)

    await expect(
      createManualJournal(accountant, {
        date: closedDate,
        narration: 'Back-dated entry',
        lines: [
          { accountId: bank, debit: 100 * RUPEE, credit: 0 },
          { accountId: cash, debit: 0, credit: 100 * RUPEE },
        ],
      }),
    ).rejects.toThrow(/locked/i)

    await unlockPeriod(admin, lock.id)

    // With the lock removed the same entry posts cleanly.
    const voucher = await createManualJournal(accountant, {
      date: closedDate,
      narration: 'Back-dated entry after re-opening',
      lines: [
        { accountId: bank, debit: 100 * RUPEE, credit: 0 },
        { accountId: cash, debit: 0, credit: 100 * RUPEE },
      ],
    })
    expect(voucher.status).toBe('POSTED')
  })
})
