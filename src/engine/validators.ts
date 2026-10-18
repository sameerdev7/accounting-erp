import { assertIntegerPaise, sumPaise, type Paise } from '@/lib/money'
import { PostingError, type JournalLine } from './types'

/** Structural checks applied to every set of lines before they are posted. */
export function validateLines(lines: JournalLine[]): void {
  if (lines.length === 0) {
    throw new PostingError('A voucher must contain at least one line')
  }

  for (const [index, line] of lines.entries()) {
    if (!line.accountId) {
      throw new PostingError(`Line ${index + 1} has no account`)
    }
    assertIntegerPaise(line.debit, `Line ${index + 1} debit`)
    assertIntegerPaise(line.credit, `Line ${index + 1} credit`)

    if (line.debit < 0 || line.credit < 0) {
      throw new PostingError(`Line ${index + 1} has a negative amount`)
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new PostingError(`Line ${index + 1} is both a debit and a credit`)
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new PostingError(`Line ${index + 1} is for a zero amount`)
    }
  }
}

export function totalDebit(lines: JournalLine[]): Paise {
  return sumPaise(lines.map((line) => line.debit))
}

export function totalCredit(lines: JournalLine[]): Paise {
  return sumPaise(lines.map((line) => line.credit))
}

export function isBalanced(lines: JournalLine[]): boolean {
  return totalDebit(lines) === totalCredit(lines)
}

/** Golden rule #1: total debit must equal total credit, always. */
export function assertBalanced(lines: JournalLine[]): void {
  validateLines(lines)
  const debit = totalDebit(lines)
  const credit = totalCredit(lines)
  if (debit !== credit) {
    throw new PostingError(
      `Unbalanced voucher: debits ${debit} do not equal credits ${credit} (difference ${debit - credit})`,
    )
  }
}

/**
 * Absorbs the paise difference created when an invoice total has been rounded
 * to the nearest rupee. The difference is posted to the Round-off account so
 * the voucher still balances to the paisa.
 */
export function balanceWithRoundOff(
  lines: JournalLine[],
  roundOffAccountId: string,
  narration: string,
): JournalLine[] {
  const debit = totalDebit(lines)
  const credit = totalCredit(lines)
  const difference = debit - credit

  const balanced = [...lines]

  if (difference > 0) {
    balanced.push({
      accountId: roundOffAccountId,
      debit: 0,
      credit: difference,
      narration: `Round-off ${narration}`.trim(),
    })
  } else if (difference < 0) {
    balanced.push({
      accountId: roundOffAccountId,
      debit: -difference,
      credit: 0,
      narration: `Round-off ${narration}`.trim(),
    })
  }

  assertBalanced(balanced)
  return balanced
}

/** Mirror a set of lines — used when a posted voucher is reversed. */
export function reverseLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
    narration: line.narration ? `Reversal: ${line.narration}` : 'Reversal',
  }))
}

/** Drop lines that ended up with a zero amount (e.g. a 0% GST leg). */
export function dropEmptyLines(lines: JournalLine[]): JournalLine[] {
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0)
}
