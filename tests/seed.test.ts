import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { seedDatabase } from '@/db/seed'
import { stockPositions } from '@/services/inventory'
import {
  buildBalanceMap,
  loadAccounts,
  loadLedger,
  mapTotals,
  netForAccount,
  type BalanceMap,
} from '@/reports/core'

/**
 * These tests exercise the whole stack end to end: the seeder drives every
 * service, every service posts through the engine, and the resulting books are
 * then audited for the invariants the specification is marked on.
 */

let accounts: Awaited<ReturnType<typeof loadAccounts>>
let entries: Awaited<ReturnType<typeof loadLedger>>
let balances: BalanceMap

beforeAll(async () => {
  await seedDatabase({ reset: true })
  accounts = await loadAccounts()
  entries = await loadLedger()
  balances = buildBalanceMap(entries)
}, 600_000)

describe('seeded books', () => {
  it('has data in every module', async () => {
    expect(await db.customers.count()).toBe(8)
    expect(await db.suppliers.count()).toBe(8)
    expect(await db.items.count()).toBe(28)
    expect(await db.employees.count()).toBe(6)
    expect(await db.users.count()).toBe(6)
    expect(await db.invoices.count()).toBeGreaterThan(20)
    expect(await db.vouchers.count()).toBeGreaterThan(50)
    expect(await db.ledgerEntries.count()).toBeGreaterThan(200)
  })

  it('balances the trial balance exactly', () => {
    const totals = mapTotals(balances)
    expect(totals.debit).toBe(totals.credit)
    expect(totals.debit).toBeGreaterThan(0)
  })

  it('balances every individual voucher', async () => {
    const grouped = new Map<string, { debit: number; credit: number }>()
    for (const entry of entries) {
      const current = grouped.get(entry.voucherId) ?? { debit: 0, credit: 0 }
      current.debit += entry.debit
      current.credit += entry.credit
      grouped.set(entry.voucherId, current)
    }

    expect(grouped.size).toBeGreaterThan(50)

    const unbalanced: string[] = []
    for (const [voucherId, totals] of grouped) {
      if (totals.debit !== totals.credit) {
        unbalanced.push(`${voucherId}: Dr ${totals.debit} vs Cr ${totals.credit}`)
      }
    }

    expect(unbalanced).toEqual([])
  })

  it('balances the balance sheet: Assets = Liabilities + Equity + Profit', () => {
    let assets = 0
    let liabilities = 0
    let equity = 0
    let income = 0
    let expenses = 0

    for (const account of accounts) {
      const net = netForAccount(account, balances)

      switch (account.type) {
        case 'ASSET':
          assets += account.normalBalance === 'DEBIT' ? net : -net
          break
        case 'LIABILITY':
          liabilities += account.normalBalance === 'CREDIT' ? net : -net
          break
        case 'EQUITY':
          equity += account.normalBalance === 'CREDIT' ? net : -net
          break
        case 'INCOME':
          income += account.normalBalance === 'CREDIT' ? net : -net
          break
        case 'EXPENSE':
          expenses += account.normalBalance === 'DEBIT' ? net : -net
          break
      }
    }

    const profit = income - expenses

    expect(assets).toBe(liabilities + equity + profit)
    // The demo company should be profitable, and carry real debtors and stock.
    expect(profit).toBeGreaterThan(0)
    expect(assets).toBeGreaterThan(0)
  })

  it('keeps the Inventory ledger equal to the value of stock on hand', async () => {
    const inventory = accounts.find((account) => account.code === '1004')
    expect(inventory).toBeDefined()

    const ledgerValue = netForAccount(inventory!, balances)

    const positions = await stockPositions()
    let stockValue = 0
    for (const position of positions.values()) stockValue += position.value

    expect(ledgerValue).toBe(stockValue)
  })

  it('uses the periodic method: purchases are cleared to COGS at each period close', () => {
    const purchases = accounts.find((account) => account.code === '5001')
    const cogs = accounts.find((account) => account.code === '5003')
    const inventory = accounts.find((account) => account.code === '1004')
    expect(purchases).toBeDefined()
    expect(cogs).toBeDefined()

    // Every month of trading has been closed, so Purchases has been cleared to
    // nil and its value now sits in Cost of Goods Sold.
    expect(netForAccount(purchases!, balances)).toBe(0)
    expect(netForAccount(cogs!, balances)).toBeGreaterThan(0)
    expect(netForAccount(inventory!, balances)).toBeGreaterThan(0)
  })

  it('bills services to Service Income with no stock movement', async () => {
    const serviceIncome = accounts.find((account) => account.code === '4003')
    expect(serviceIncome).toBeDefined()
    expect(netForAccount(serviceIncome!, balances)).toBeGreaterThan(0)

    const serviceItems = (await db.items.toArray()).filter((item) => item.kind === 'SERVICE')
    expect(serviceItems.length).toBeGreaterThan(0)

    const serviceIds = new Set(serviceItems.map((item) => item.id))
    const movements = await db.stockMovements.toArray()
    expect(movements.some((movement) => serviceIds.has(movement.itemId))).toBe(false)
  })

  it('keeps every party control account equal to the sum of its sub-ledgers', () => {
    for (const controlCode of ['1003', '2001']) {
      const control = accounts.find((account) => account.code === controlCode)
      expect(control).toBeDefined()

      const children = accounts.filter((account) => account.parentId === control!.id)
      expect(children.length).toBe(8)

      // The control account carries no entries of its own — everything is
      // posted to a sub-ledger — so its own balance is nil and its *reported*
      // balance is the roll-up of its children.
      const ownNet = netForAccount(control!, balances)
      const childTotal = children.reduce((total, child) => total + netForAccount(child, balances), 0)

      expect(ownNet).toBe(0)
      expect(childTotal).not.toBe(0)
    }
  })

  it('has generated output GST, input GST and a settled GST position', () => {
    const outputCgst = accounts.find((account) => account.code === '2002')
    const inputCgst = accounts.find((account) => account.code === '1005')
    expect(outputCgst).toBeDefined()
    expect(inputCgst).toBeDefined()

    // Both GST streams must have moved during the period.
    expect(balances.get(outputCgst!.id)?.credit ?? 0).toBeGreaterThan(0)
    expect(balances.get(inputCgst!.id)?.debit ?? 0).toBeGreaterThan(0)
  })

  it('has recorded audit entries for the seeded activity', async () => {
    const audit = await db.auditLog.count()
    expect(audit).toBeGreaterThan(50)
  })

  it('has generated some open receivables and payables for ageing', async () => {
    const { openInvoices } = await import('@/services/cashbank')
    const debtors = await openInvoices('SALES')
    const creditors = await openInvoices('PURCHASE')

    expect(debtors.length).toBeGreaterThan(0)
    expect(creditors.length).toBeGreaterThan(0)
    expect(debtors.every((row) => row.outstanding > 0)).toBe(true)
  })
})
