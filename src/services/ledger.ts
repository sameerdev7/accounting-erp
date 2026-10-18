import {
  db,
  type LedgerEntry,
  type UserRole,
  type Voucher,
  type VoucherStatus,
  type VoucherType,
} from '@/db/schema'
import { writeTx } from '@/db/tx'
import { allocateSequence } from '@/engine/numbering'
import { PostingError, type JournalLine } from '@/engine/types'
import { assertBalanced, reverseLines } from '@/engine/validators'
import { financialYearOf } from '@/lib/dates'
import { newId } from '@/lib/id'
import { applyAllocations, settlementPlanKey, type SettlementPlan } from './allocations'
import { writeAudit } from './audit'
import { assertMakerChecker, canApproveAmount, isDateLocked } from './controls'

export interface Actor {
  userId: string
  username: string
  role: UserRole
}

/** Fallback voucher prefixes; overridden by `company.prefixes` when present. */
export const DEFAULT_PREFIXES: Record<VoucherType, string> = {
  RECEIPT: 'RV',
  PAYMENT: 'PYV',
  SALES: 'INV',
  PURCHASE: 'PIV',
  JOURNAL: 'JV',
  CONTRA: 'CV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  PAYROLL: 'PRV',
  DEPRECIATION: 'DEP',
  OPENING: 'OB',
}

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  RECEIPT: 'Receipt',
  PAYMENT: 'Payment',
  SALES: 'Sales',
  PURCHASE: 'Purchase',
  JOURNAL: 'Journal',
  CONTRA: 'Contra',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
  PAYROLL: 'Payroll',
  DEPRECIATION: 'Depreciation',
  OPENING: 'Opening Balance',
}

/* ==========================================================================
 * Helpers
 * ========================================================================== */

export async function companyFyStartMonth(): Promise<number> {
  const company = await db.company.get('company')
  return company?.financialYearStartMonth ?? 4
}

async function prefixFor(type: VoucherType): Promise<string> {
  const company = await db.company.get('company')
  return company?.prefixes?.[type] ?? DEFAULT_PREFIXES[type] ?? 'VCH'
}

/**
 * Blocks postings into a closed period. Must run inside a transaction.
 */
export async function assertPeriodOpen(date: string): Promise<void> {
  const [locks, startMonth] = await Promise.all([
    db.periodLocks.toArray(),
    companyFyStartMonth(),
  ])

  if (isDateLocked(date, locks, startMonth)) {
    throw new PostingError(
      `The period containing ${date} is locked. Re-open the period before posting into it.`,
    )
  }
}

export async function entriesForVoucher(voucherId: string): Promise<LedgerEntry[]> {
  return db.ledgerEntries.where('voucherId').equals(voucherId).toArray()
}

/* ==========================================================================
 * Creating a voucher
 * ========================================================================== */

export interface CreateVoucherInput {
  type: VoucherType
  date: string
  narration: string
  /** Must already balance — the engine is the only source of these lines */
  lines: JournalLine[]
  partyId?: string | null
  refDocId?: string | null
  refDocType?: string | null
  /**
   * POSTED writes the ledger entries immediately. DRAFT and PENDING park the
   * voucher until it clears approval.
   */
  status?: Extract<VoucherStatus, 'DRAFT' | 'PENDING' | 'POSTED'>
  /** Supply the number when the document already owns one (e.g. an invoice) */
  number?: string
  reversalOf?: string | null
  approvedBy?: string | null
  /**
   * The seeder builds historical postings directly and must not be stopped by
   * a period lock that an operator later applied to those months.
   */
  ignorePeriodLock?: boolean
  /** Skip the audit row — used only when rebuilding the books wholesale */
  skipAudit?: boolean
}

export interface CreatedVoucher {
  voucher: Voucher
  entries: LedgerEntry[]
}

/**
 * The ONLY function in the application that writes to `ledgerEntries`.
 *
 * Everything else — screens, services, the seeder — goes through here, which is
 * what makes "every posting is balanced" a property of the system rather than a
 * convention people are asked to follow.
 */
export async function createVoucher(
  actor: Actor,
  input: CreateVoucherInput,
): Promise<CreatedVoucher> {
  assertBalanced(input.lines)

  const status = input.status ?? 'POSTED'

  if (!input.ignorePeriodLock && status !== 'DRAFT') {
    await assertPeriodOpen(input.date)
  }

  const company = await db.company.get('company')
  const fy = financialYearOf(input.date, company?.financialYearStartMonth ?? 4)

  let number = input.number
  if (!number) {
    const prefix = await prefixFor(input.type)
    const allocated = await allocateSequence(db.sequences, { prefix, fyKey: fy.key })
    number = allocated.number
  }

  const now = Date.now()
  const voucher: Voucher = {
    id: newId('vch'),
    type: input.type,
    number,
    date: input.date,
    narration: input.narration,
    status,
    amount: totalOf(input.lines),
    preparedBy: actor.userId,
    submittedBy: status === 'PENDING' || status === 'POSTED' ? actor.userId : undefined,
    approvedBy: input.approvedBy ?? (status === 'POSTED' ? actor.userId : undefined),
    approvedAt: status === 'POSTED' ? now : undefined,
    postedAt: status === 'POSTED' ? now : undefined,
    reversalOf: input.reversalOf ?? null,
    reversedBy: null,
    refDocId: input.refDocId ?? null,
    refDocType: input.refDocType ?? null,
    partyId: input.partyId ?? null,
    createdAt: now,
    createdBy: actor.userId,
  }

  await db.vouchers.add(voucher)

  // A voucher that has not been posted yet keeps its lines stashed so that
  // `postVoucher` can write them once an approver has signed off.
  if (status !== 'POSTED') {
    await db.settings.put({ key: `voucher.lines.${voucher.id}`, value: input.lines })
  }

  const entries: LedgerEntry[] = []

  if (status === 'POSTED') {
    for (const line of input.lines) {
      const entry: LedgerEntry = {
        id: newId('led'),
        voucherId: voucher.id,
        date: voucher.date,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        partyId: line.partyId ?? input.partyId ?? null,
        narration: line.narration ?? input.narration,
        createdAt: now,
        createdBy: actor.userId,
      }
      entries.push(entry)
    }
    await db.ledgerEntries.bulkAdd(entries)
  }

  if (!input.skipAudit) {
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: status === 'POSTED' ? 'POST' : 'CREATE',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `${VOUCHER_TYPE_LABELS[input.type]} voucher ${number} — ${input.narration}`,
      after: { number, amount: voucher.amount, status },
    })
  }

  return { voucher, entries }
}

function totalOf(lines: JournalLine[]): number {
  return lines.reduce((sum, line) => sum + line.debit, 0)
}

/* ==========================================================================
 * Approval lifecycle:  DRAFT -> PENDING -> APPROVED -> POSTED -> REVERSED
 * ========================================================================== */

export async function submitVoucher(actor: Actor, voucherId: string): Promise<Voucher> {
  const voucher = await requireVoucher(voucherId)

  if (voucher.status !== 'DRAFT') {
    throw new PostingError(`Only a draft voucher can be submitted (this one is ${voucher.status}).`)
  }

  await db.vouchers.update(voucherId, { status: 'PENDING', submittedBy: actor.userId })
  await writeAudit({
    userId: actor.userId,
    username: actor.username,
    action: 'SUBMIT',
    entity: 'vouchers',
    entityId: voucherId,
    summary: `Submitted ${voucher.number} for approval`,
    before: { status: 'DRAFT' },
    after: { status: 'PENDING' },
  })

  return { ...voucher, status: 'PENDING', submittedBy: actor.userId }
}

/**
 * Approving a voucher enforces both segregation controls:
 *   1. the approver must not be the preparer (maker–checker), and
 *   2. the approver's role must carry enough authority for the amount.
 */
export async function approveVoucher(actor: Actor, voucherId: string): Promise<Voucher> {
  const voucher = await requireVoucher(voucherId)

  if (voucher.status !== 'PENDING') {
    throw new PostingError(`Only a submitted voucher can be approved (this one is ${voucher.status}).`)
  }

  assertMakerChecker(voucher.preparedBy, actor.userId)

  if (!canApproveAmount(actor.role, voucher.amount)) {
    throw new PostingError(
      `Voucher ${voucher.number} is for ${formatAmountForError(voucher.amount)}. Your role cannot approve above the ₹25,000 threshold — this must go to the Finance Head.`,
    )
  }

  const now = Date.now()
  await db.vouchers.update(voucherId, { status: 'APPROVED', approvedBy: actor.userId, approvedAt: now })

  await writeAudit({
    userId: actor.userId,
    username: actor.username,
    action: 'APPROVE',
    entity: 'vouchers',
    entityId: voucherId,
    summary: `Approved ${voucher.number}`,
    before: { status: 'PENDING' },
    after: { status: 'APPROVED', approvedBy: actor.username },
  })

  return { ...voucher, status: 'APPROVED', approvedBy: actor.userId, approvedAt: now }
}

/**
 * Posts an approved voucher, writing its ledger entries in one transaction.
 * A voucher posted directly at creation never passes through here.
 *
 * If the voucher carries a stored settlement plan (a payment request), the plan
 * is applied here too, so a request posted from any screen settles the party's
 * open invoices atomically with its ledger entries.
 */
export async function postVoucher(actor: Actor, voucherId: string): Promise<Voucher> {
  return writeTx(async () => {
    const voucher = await requireVoucher(voucherId)

    if (voucher.status === 'POSTED') return voucher
    if (voucher.status === 'REVERSED') {
      throw new PostingError(`Voucher ${voucher.number} has been reversed and cannot be posted.`)
    }
    if (voucher.status === 'DRAFT') {
      throw new PostingError(`Voucher ${voucher.number} must be submitted and approved before posting.`)
    }
    if (voucher.status === 'PENDING') {
      throw new PostingError(`Voucher ${voucher.number} is still awaiting approval.`)
    }

    const existing = await entriesForVoucher(voucherId)
    if (existing.length > 0) {
      throw new PostingError(`Voucher ${voucher.number} already has ledger entries.`)
    }

    const stored = await db.settings.get(`voucher.lines.${voucherId}`)
    const lines = (stored?.value as JournalLine[] | undefined) ?? []
    if (lines.length === 0) {
      throw new PostingError(
        `Voucher ${voucher.number} has no stored lines to post. Recreate the voucher with its lines attached.`,
      )
    }

    assertBalanced(lines)
    await assertPeriodOpen(voucher.date)

    const now = Date.now()
    await db.ledgerEntries.bulkAdd(
      lines.map((line) => ({
        id: newId('led'),
        voucherId,
        date: voucher.date,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        partyId: line.partyId ?? voucher.partyId ?? null,
        narration: line.narration ?? voucher.narration,
        createdAt: now,
        createdBy: actor.userId,
      })),
    )

    await db.vouchers.update(voucherId, { status: 'POSTED', postedAt: now })
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucherId,
      summary: `Posted ${voucher.number} to the ledger`,
      before: { status: 'APPROVED' },
      after: { status: 'POSTED' },
    })

    // A payment request carries its settlement intent in `settings`; apply it now
    // so posting and settlement commit as a single unit, then clear it.
    const plan = (await db.settings.get(settlementPlanKey(voucherId)))?.value as
      | SettlementPlan
      | undefined
    if (plan) {
      await applyAllocations(actor, {
        type: plan.type,
        partyId: plan.partyId,
        voucherId,
        voucherDate: voucher.date,
        amount: plan.amount,
        allocateTo: plan.allocateTo,
      })
      await db.settings.delete(settlementPlanKey(voucherId))
    }

    return { ...voucher, status: 'POSTED', postedAt: now }
  })
}

/**
 * A posted voucher is immutable. The only permitted correction is a reversal,
 * which creates a mirror voucher — the original stays in the ledger forever so
 * the audit trail is preserved.
 */
export async function reverseVoucher(
  actor: Actor,
  voucherId: string,
  reason: string,
): Promise<Voucher> {
  const voucher = await requireVoucher(voucherId)

  if (voucher.status !== 'POSTED') {
    throw new PostingError(`Only a posted voucher can be reversed (this one is ${voucher.status}).`)
  }
  if (voucher.reversedBy) {
    throw new PostingError(`Voucher ${voucher.number} has already been reversed.`)
  }
  if (!reason.trim()) {
    throw new PostingError('A reason is required to reverse a voucher.')
  }

  const original = await entriesForVoucher(voucherId)
  if (original.length === 0) {
    throw new PostingError(`Voucher ${voucher.number} has no ledger entries to reverse.`)
  }

  const mirrored = reverseLines(
    original.map((entry) => ({
      accountId: entry.accountId,
      debit: entry.debit,
      credit: entry.credit,
      partyId: entry.partyId ?? null,
      narration: entry.narration,
    })),
  )

  await assertPeriodOpen(voucher.date)

  const prefix = await prefixFor(voucher.type)
  const company = await db.company.get('company')
  const fy = financialYearOf(voucher.date, company?.financialYearStartMonth ?? 4)
  const allocated = await allocateSequence(db.sequences, { prefix, fyKey: fy.key })

  const now = Date.now()
  const reversal: Voucher = {
    id: newId('vch'),
    type: voucher.type,
    number: allocated.number,
    date: voucher.date,
    narration: `Reversal of ${voucher.number}: ${reason}`,
    status: 'POSTED',
    amount: voucher.amount,
    preparedBy: actor.userId,
    approvedBy: actor.userId,
    approvedAt: now,
    postedAt: now,
    reversalOf: voucher.id,
    reversedBy: null,
    refDocId: voucher.refDocId ?? null,
    refDocType: voucher.refDocType ?? null,
    partyId: voucher.partyId ?? null,
    createdAt: now,
    createdBy: actor.userId,
  }

  await db.vouchers.add(reversal)
  await db.ledgerEntries.bulkAdd(
    mirrored.map((line) => ({
      id: newId('led'),
      voucherId: reversal.id,
      date: reversal.date,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      partyId: line.partyId ?? null,
      narration: line.narration ?? reversal.narration,
      createdAt: now,
      createdBy: actor.userId,
    })),
  )

  await db.vouchers.update(voucherId, { status: 'REVERSED', reversedBy: reversal.id })

  await writeAudit({
    userId: actor.userId,
    username: actor.username,
    action: 'REVERSE',
    entity: 'vouchers',
    entityId: reversal.id,
    summary: `Reversed ${voucher.number} with ${allocated.number} — ${reason}`,
    before: { status: 'POSTED', voucher: voucher.number },
    after: { status: 'REVERSED', reversal: allocated.number, reason },
  })

  return reversal
}

async function requireVoucher(voucherId: string): Promise<Voucher> {
  const voucher = await db.vouchers.get(voucherId)
  if (!voucher) throw new PostingError(`Voucher ${voucherId} was not found.`)
  return voucher
}

function formatAmountForError(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

/**
 * Convenience wrapper used by services for vouchers that need to travel through
 * the approval chain: the lines are stashed so that `postVoucher` can write them
 * later, once an approver has signed off.
 */
export async function createPendingVoucher(
  actor: Actor,
  input: Omit<CreateVoucherInput, 'status'>,
): Promise<Voucher> {
  const { voucher } = await createVoucher(actor, { ...input, status: 'PENDING' })
  return voucher
}

/** Same as above but parked as a draft, awaiting submission. */
export async function createDraftVoucher(
  actor: Actor,
  input: Omit<CreateVoucherInput, 'status'>,
): Promise<Voucher> {
  const { voucher } = await createVoucher(actor, { ...input, status: 'DRAFT' })
  return voucher
}

/** Submits a draft voucher for approval and returns its current state. */
export async function submitOrApprove(
  actor: Actor,
  voucherId: string,
  action: 'submit' | 'approve',
): Promise<Voucher> {
  if (action === 'submit') return submitVoucher(actor, voucherId)
  const approved = await approveVoucher(actor, voucherId)
  await postVoucher(actor, voucherId)
  return approved
}

/* ==========================================================================
 * Manual journal entries
 * ========================================================================== */

export interface ManualJournalInput {
  date: string
  narration: string
  lines: JournalLine[]
  partyId?: string | null
  /** Post immediately rather than parking the voucher for approval */
  postNow?: boolean
}

/**
 * A hand-written journal. The lines are validated by the engine, so an
 * unbalanced manual entry is rejected before it can reach the ledger.
 */
export async function createManualJournal(
  actor: Actor,
  input: ManualJournalInput,
): Promise<Voucher> {
  const created = await createVoucher(actor, {
    type: 'JOURNAL',
    date: input.date,
    narration: input.narration,
    lines: input.lines,
    partyId: input.partyId ?? null,
    refDocType: 'MANUAL',
    status: input.postNow === false ? 'DRAFT' : 'POSTED',
  })
  return created.voucher
}
