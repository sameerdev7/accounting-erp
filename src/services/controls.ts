import type { PeriodLock, UserRole } from '@/db/schema'
import { financialYearOf, monthKey } from '@/lib/dates'
import type { Paise } from '@/lib/money'
import { PostingError } from '@/engine/types'

/**
 * Approval hierarchy (section 11). A manager may authorise routine spending;
 * anything larger must go to the Finance Head, who holds the ADMIN role.
 */
export const APPROVAL_THRESHOLD: Paise = 2_500_000 // ₹25,000

export function approverRolesFor(amount: Paise): UserRole[] {
  return amount <= APPROVAL_THRESHOLD ? ['APPROVER', 'ADMIN'] : ['ADMIN']
}

export function canApproveAmount(role: UserRole, amount: Paise): boolean {
  if (role === 'ADMIN') return true
  if (role === 'APPROVER') return amount <= APPROVAL_THRESHOLD
  return false
}

export function approvalLimitDescription(role: UserRole): string {
  if (role === 'ADMIN') return 'Unlimited approval authority (Finance Head)'
  if (role === 'APPROVER') return 'Approval authority up to ₹25,000'
  return 'No approval authority'
}

/* ==========================================================================
 * Maker–checker
 * ========================================================================== */

/**
 * The golden control: whoever prepared a document can never be the one who
 * approves it. This is checked in code, not merely described in the manual.
 */
export function assertMakerChecker(preparedBy: string, approverUserId: string): void {
  if (preparedBy === approverUserId) {
    throw new PostingError(
      'Maker–checker violation: a voucher cannot be approved by the person who prepared it.',
    )
  }
}

/* ==========================================================================
 * Period lock
 * ========================================================================== */

export function isDateLocked(date: string, locks: PeriodLock[], fyStartMonth: number): boolean {
  const key = monthKey(date)
  const fyKey = financialYearOf(date, fyStartMonth).key

  return locks.some((lock) => {
    if (lock.type === 'MONTH') return lock.period === key
    return lock.period === fyKey
  })
}

export function lockCoveringDate(
  date: string,
  locks: PeriodLock[],
  fyStartMonth: number,
): PeriodLock | undefined {
  const key = monthKey(date)
  const fyKey = financialYearOf(date, fyStartMonth).key

  return locks.find((lock) =>
    lock.type === 'MONTH' ? lock.period === key : lock.period === fyKey,
  )
}

export function describePeriodLock(lock: PeriodLock): string {
  return lock.type === 'MONTH' ? `Month ${lock.period}` : `Financial year ${lock.period}`
}

/* ==========================================================================
 * Duplicate detection
 * ========================================================================== */

/**
 * Duplicate supplier invoice prevention. A supplier's invoice number is unique
 * for that supplier — the same number must never be entered twice. The database
 * enforces this with a unique compound index; this helper produces the message
 * shown to the operator before the write is attempted.
 */
export function duplicateInvoiceMessage(
  existingNumber: string,
  supplierName: string,
): string {
  return `Invoice ${existingNumber} has already been recorded for ${supplierName}. Duplicate supplier invoices are blocked to prevent double payment.`
}

/**
 * Soft duplicate warning for receipts: the same party, amount and date is
 * suspicious but not necessarily wrong, so the operator is warned rather than
 * blocked.
 */
export function looksLikeDuplicateReceipt(
  candidate: { partyId: string; amount: Paise; date: string; reference: string },
  existing: Array<{ partyId: string; amount: Paise; date: string }>,
): boolean {
  return existing.some(
    (row) =>
      row.partyId === candidate.partyId &&
      row.amount === candidate.amount &&
      row.date === candidate.date,
  )
}
