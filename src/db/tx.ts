import type { Table } from 'dexie'
import { PostingError, type AccountResolver, type PostingContext } from '@/engine/types'
import { db, type Account, type Company } from './schema'

/**
 * Every table in the database. Registering all of them on write transactions
 * keeps the transaction scopes simple and, at this data volume, costs nothing —
 * correctness beats micro-optimisation at this data volume.
 */
export const ALL_TABLES: Table<any>[] = [
  db.company,
  db.accounts,
  db.customers,
  db.suppliers,
  db.items,
  db.employees,
  db.attendance,
  db.purchaseRequisitions,
  db.purchaseRequisitionLines,
  db.purchaseOrders,
  db.purchaseOrderLines,
  db.grns,
  db.grnLines,
  db.salesOrders,
  db.salesOrderLines,
  db.deliveries,
  db.deliveryLines,
  db.invoices,
  db.invoiceLines,
  db.vouchers,
  db.ledgerEntries,
  db.stockMovements,
  db.allocations,
  db.assets,
  db.depreciationEntries,
  db.payrollRuns,
  db.payslips,
  db.users,
  db.auditLog,
  db.sequences,
  db.periodLocks,
  db.settings,
]

/**
 * Runs `work` inside one read-write transaction covering every table, so a
 * failure anywhere rolls the whole unit back. Every multi-step business action
 * in the application is wrapped in exactly one of these.
 */
export function writeTx<T>(work: () => Promise<T>): Promise<T> {
  return db.transaction('rw', ALL_TABLES, work)
}

/* ==========================================================================
 * Chart of accounts access
 * ========================================================================== */

export async function loadAccounts(): Promise<Account[]> {
  return db.accounts.toArray()
}

export function accountsByCode(accounts: Account[]): Map<string, Account> {
  const map = new Map<string, Account>()
  for (const account of accounts) map.set(account.code, account)
  return map
}

/**
 * Turns the engine's account-code lookups into real database ids. A missing
 * account is a programming error, so it throws rather than silently posting to
 * the wrong place.
 */
export function buildResolver(byCode: Map<string, Account>): AccountResolver {
  return (code: string) => {
    const account = byCode.get(code)
    if (!account) {
      throw new PostingError(`Chart of accounts is missing account code ${code}`)
    }
    return account.id
  }
}

export async function loadResolver(): Promise<AccountResolver> {
  return buildResolver(accountsByCode(await loadAccounts()))
}

export async function accountIdByCode(code: string): Promise<string> {
  const account = await db.accounts.where('code').equals(code).first()
  if (!account) throw new PostingError(`Chart of accounts is missing account code ${code}`)
  return account.id
}

export async function accountByCode(code: string): Promise<Account | undefined> {
  return db.accounts.where('code').equals(code).first()
}

/** Builds the `PostingContext` the engine expects. */
export function makeContext(resolve: AccountResolver, narration: string): PostingContext {
  return { resolve, narration }
}

/* ==========================================================================
 * Company
 * ========================================================================== */

export async function getCompany(): Promise<Company> {
  const company = await db.company.get('company')
  if (!company) {
    throw new PostingError('The company master has not been set up. Reload the application to reseed.')
  }
  return company
}

export async function getFyStartMonth(): Promise<number> {
  const company = await db.company.get('company')
  return company?.financialYearStartMonth ?? 4
}

/* ==========================================================================
 * Settings
 * ========================================================================== */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
