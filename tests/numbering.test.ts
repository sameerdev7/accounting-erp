import type { Table } from 'dexie'
import { describe, expect, it } from 'vitest'
import type { Sequence } from '@/db/schema'
import {
  allocateSequence,
  clearSequences,
  formatDocNumber,
  peekSequence,
} from '@/engine/numbering'

/** Minimal stand-in for a Dexie table, supporting only what numbering needs. */
class FakeSequenceTable {
  private rows = new Map<string, Sequence>()

  async get(key: string): Promise<Sequence | undefined> {
    return this.rows.get(key)
  }

  async update(key: string, changes: Partial<Sequence>): Promise<number> {
    const existing = this.rows.get(key)
    if (!existing) return 0
    this.rows.set(key, { ...existing, ...changes })
    return 1
  }

  async put(row: Sequence): Promise<string> {
    this.rows.set(row.key, row)
    return row.key
  }

  async toArray(): Promise<Sequence[]> {
    return [...this.rows.values()]
  }
}

function table(): Table<Sequence, string> {
  return new FakeSequenceTable() as unknown as Table<Sequence, string>
}

describe('formatDocNumber', () => {
  it('zero-pads the sequence and includes the financial year', () => {
    expect(formatDocNumber('SV', '2526', 7)).toBe('SV/2526/0007')
    expect(formatDocNumber('PV', '2526', 1234)).toBe('PV/2526/1234')
  })
})

describe('allocateSequence', () => {
  it('produces a gapless series', async () => {
    const sequences = table()
    const numbers: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const allocated = await allocateSequence(sequences, { prefix: 'SV', fyKey: '2526' })
      numbers.push(allocated.number)
    }

    expect(numbers).toEqual([
      'SV/2526/0001',
      'SV/2526/0002',
      'SV/2526/0003',
      'SV/2526/0004',
      'SV/2526/0005',
    ])
  })

  it('keeps series independent per prefix and per financial year', async () => {
    const sequences = table()
    const sales = await allocateSequence(sequences, { prefix: 'SV', fyKey: '2526' })
    const purchase = await allocateSequence(sequences, { prefix: 'PV', fyKey: '2526' })
    const nextYear = await allocateSequence(sequences, { prefix: 'SV', fyKey: '2627' })
    const salesAgain = await allocateSequence(sequences, { prefix: 'SV', fyKey: '2526' })

    expect(sales.number).toBe('SV/2526/0001')
    expect(purchase.number).toBe('PV/2526/0001')
    expect(nextYear.number).toBe('SV/2627/0001')
    expect(salesAgain.number).toBe('SV/2526/0002')
  })

  it('never issues the same number twice', async () => {
    const sequences = table()
    const issued = new Set<string>()
    for (let index = 0; index < 50; index += 1) {
      const allocated = await allocateSequence(sequences, { prefix: 'RV', fyKey: '2526' })
      issued.add(allocated.number)
    }
    expect(issued.size).toBe(50)
  })
})

describe('peekSequence', () => {
  it('shows the next number without consuming it', async () => {
    const sequences = table()
    expect(await peekSequence(sequences, 'JV', '2526')).toBe('JV/2526/0001')
    expect(await peekSequence(sequences, 'JV', '2526')).toBe('JV/2526/0001')
    await allocateSequence(sequences, { prefix: 'JV', fyKey: '2526' })
    expect(await peekSequence(sequences, 'JV', '2526')).toBe('JV/2526/0002')
  })
})

describe('clearSequences', () => {
  it('restarts every series', async () => {
    const sequences = table()
    await allocateSequence(sequences, { prefix: 'SV', fyKey: '2526' })
    await allocateSequence(sequences, { prefix: 'SV', fyKey: '2526' })
    await clearSequences(sequences)
    expect(await peekSequence(sequences, 'SV', '2526')).toBe('SV/2526/0001')
  })
})
