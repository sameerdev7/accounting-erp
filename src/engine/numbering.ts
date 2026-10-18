import type { Table } from 'dexie'
import type { Sequence } from '@/db/schema'
import { PostingError } from './types'

/** How each document type is numbered. Width is the zero-padded digit count. */
export const DOC_WIDTH = 4

export function formatDocNumber(
  prefix: string,
  fyKey: string,
  sequence: number,
  width = DOC_WIDTH,
): string {
  return `${prefix}/${fyKey}/${String(sequence).padStart(width, '0')}`
}

export interface AllocatedNumber {
  key: string
  number: string
  sequence: number
}

/**
 * Allocates the next number in a gapless sequence.
 *
 * MUST be called inside a Dexie transaction — the read-modify-write on the
 * `sequences` table is only atomic within one. Because cancelled documents are
 * deleted rather than skipped, and allocations never roll back to a lower
 * value, the resulting numbering has no gaps.
 */
export async function allocateSequence(
  sequences: Table<Sequence, string>,
  options: { prefix: string; fyKey: string; width?: number },
): Promise<AllocatedNumber> {
  const width = options.width ?? DOC_WIDTH
  const key = `${options.prefix}/${options.fyKey}`

  const existing = await sequences.get(key)
  const next = existing ? existing.next : 1

  if (existing) {
    await sequences.update(key, { next: next + 1 })
  } else {
    await sequences.put({ key, prefix: options.prefix, fyKey: options.fyKey, next: next + 1, width })
  }

  return { key, number: formatDocNumber(options.prefix, options.fyKey, next, width), sequence: next }
}

/**
 * Peeks at the next number without consuming it — used to show the operator
 * what the number will be before they save.
 */
export async function peekSequence(
  sequences: Table<Sequence, string>,
  prefix: string,
  fyKey: string,
  width = DOC_WIDTH,
): Promise<string> {
  const existing = await sequences.get(`${prefix}/${fyKey}`)
  return formatDocNumber(prefix, fyKey, existing ? existing.next : 1, width)
}

/** Resets every sequence — used when the data is regenerated. */
export async function clearSequences(sequences: Table<Sequence, string>): Promise<void> {
  const all = await sequences.toArray()
  if (all.length === 0) return
  for (const row of all) {
    await sequences.update(row.key, { next: 1 })
  }
}

export function assertSequenceKey(key: string): void {
  if (!key.includes('/')) {
    throw new PostingError(`Malformed sequence key: ${key}`)
  }
}
