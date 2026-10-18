import type { Paise } from '@/lib/money'

/** A single debit or credit proposed by the posting engine. */
export interface JournalLine {
  accountId: string
  debit: Paise
  credit: Paise
  /** Set when the line belongs to a party sub-ledger, enabling party reports */
  partyId?: string | null
  narration?: string
}

/**
 * The engine never knows database ids for the chart of accounts; callers hand
 * it a resolver that maps a stable account code (see `db/coa.ts`) to a real
 * account id. This keeps the engine pure and unit-testable.
 */
export type AccountResolver = (code: string) => string

export interface PostingContext {
  resolve: AccountResolver
  /** Default narration attached to generated lines */
  narration: string
}

export class PostingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostingError'
  }
}
