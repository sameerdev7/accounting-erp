import { db, type Account, type AccountType, type LedgerEntry } from '@/db/schema'
import type { Paise } from '@/lib/money'

/**
 * Shared primitives for every report.
 *
 * Reports are pure functions over the ledger. No report ever reads a stored
 * balance, because none is stored — the ledger is the only source of truth and
 * the trial balance is recomputed from it on every request.
 */

export interface BalanceEntry {
  debit: Paise
  credit: Paise
}

export type BalanceMap = Map<string, BalanceEntry>

export async function loadAccounts(): Promise<Account[]> {
  return db.accounts.toArray()
}

export async function loadLedger(): Promise<LedgerEntry[]> {
  return db.ledgerEntries.toArray()
}

export function sortAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => a.code.localeCompare(b.code))
}

export function accountsOfType(accounts: Account[], type: AccountType): Account[] {
  return sortAccounts(accounts.filter((account) => account.type === type))
}

export function inRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

export function filterEntries(entries: LedgerEntry[], from?: string, to?: string): LedgerEntry[] {
  if (!from && !to) return entries
  return entries.filter((entry) => inRange(entry.date, from, to))
}

export function buildBalanceMap(entries: LedgerEntry[]): BalanceMap {
  const map: BalanceMap = new Map()
  for (const entry of entries) {
    const current = map.get(entry.accountId)
    if (current) {
      current.debit += entry.debit
      current.credit += entry.credit
    } else {
      map.set(entry.accountId, { debit: entry.debit, credit: entry.credit })
    }
  }
  return map
}

export function balanceOf(map: BalanceMap, accountId: string): BalanceEntry {
  return map.get(accountId) ?? { debit: 0, credit: 0 }
}

/**
 * The balance of an account expressed in its own natural direction, so that a
 * positive number always means "normal". Assets and expenses give debit-minus-
 * credit; liabilities, equity and income give credit-minus-debit.
 */
export function netForAccount(account: Account, map: BalanceMap): Paise {
  const { debit, credit } = balanceOf(map, account.id)
  return account.normalBalance === 'DEBIT' ? debit - credit : credit - debit
}

/** Raw signed amount (debit positive), independent of the account's nature. */
export function signedForAccount(account: Account, map: BalanceMap): Paise {
  const { debit, credit } = balanceOf(map, account.id)
  return debit - credit
}

/** Trial-balance presentation: whichever side the account actually sits on. */
export function trialBalanceColumns(map: BalanceMap, accountId: string): {
  debit: Paise
  credit: Paise
} {
  const { debit, credit } = balanceOf(map, accountId)
  const net = debit - credit
  return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net }
}

export function mapTotals(map: BalanceMap): { debit: Paise; credit: Paise } {
  let debit = 0
  let credit = 0
  for (const entry of map.values()) {
    debit += entry.debit
    credit += entry.credit
  }
  return { debit, credit }
}

/* ==========================================================================
 * Account hierarchy (control accounts and party sub-ledgers)
 * ========================================================================== */

export function childrenOf(accounts: Account[], parentId: string): Account[] {
  return sortAccounts(accounts.filter((account) => account.parentId === parentId))
}

export function childrenByParent(accounts: Account[]): Map<string, Account[]> {
  const map = new Map<string, Account[]>()
  for (const account of accounts) {
    if (!account.parentId) continue
    const list = map.get(account.parentId)
    if (list) list.push(account)
    else map.set(account.parentId, [account])
  }
  for (const list of map.values()) list.sort((a, b) => a.code.localeCompare(b.code))
  return map
}

export function descendantsOf(
  accountId: string,
  byParent: Map<string, Account[]>,
  seen = new Set<string>(),
): Account[] {
  if (seen.has(accountId)) return []
  seen.add(accountId)
  const result: Account[] = []
  for (const child of byParent.get(accountId) ?? []) {
    result.push(child, ...descendantsOf(child.id, byParent, seen))
  }
  return result
}

/** The account's own balance plus every sub-ledger beneath it. */
export function rollupNet(
  account: Account,
  byParent: Map<string, Account[]>,
  map: BalanceMap,
): Paise {
  let total = netForAccount(account, map)
  for (const child of descendantsOf(account.id, byParent)) {
    total += netForAccount(child, map)
  }
  return total
}

/** Top-level accounts only — those without a parent. */
export function rootAccounts(accounts: Account[]): Account[] {
  return sortAccounts(accounts.filter((account) => account.parentId === null))
}

export function accountLabel(account: Account): string {
  return `${account.code} · ${account.name}`
}

export function isContraAccount(account: Account): boolean {
  return account.isContra
}

/* ==========================================================================
 * Transaction detail
 * ========================================================================== */

export interface LedgerLineDetail {
  entry: LedgerEntry
  account?: Account
}

export function entriesForAccount(entries: LedgerEntry[], accountId: string): LedgerEntry[] {
  return entries
    .filter((entry) => entry.accountId === accountId)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
}

export function entriesForParty(entries: LedgerEntry[], partyId: string): LedgerEntry[] {
  return entries
    .filter((entry) => entry.partyId === partyId)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
}

export function sumDebit(entries: LedgerEntry[]): Paise {
  return entries.reduce((total, entry) => total + entry.debit, 0)
}

export function sumCredit(entries: LedgerEntry[]): Paise {
  return entries.reduce((total, entry) => total + entry.credit, 0)
}

/** Groups entries by 'YYYY-MM', preserving chronological order. */
export function groupByMonth(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const map = new Map<string, LedgerEntry[]>()
  for (const entry of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const key = entry.date.slice(0, 7)
    const list = map.get(key)
    if (list) list.push(entry)
    else map.set(key, [entry])
  }
  return map
}

/** Accounts that moved during the period, useful for both books and GST. */
export function activeAccountIds(entries: LedgerEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.accountId))
}
