import { ACC } from '@/db/coa'
import { db } from '@/db/schema'
import { getSetting, loadResolver, makeContext, setSetting, writeTx } from '@/db/tx'
import { postInventoryClosing } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { monthEndISO, monthStartISO } from '@/lib/dates'
import { todayISO } from '@/lib/format'
import type { Paise } from '@/lib/money'
import { buildBalanceMap, loadAccounts, loadLedger, netForAccount } from '@/reports/core'
import { inventoryValueAsOf } from './inventory'
import { createVoucher, reverseVoucher, type Actor } from './ledger'

/**
 * Period-end procedures.
 *
 * This application values inventory under the *periodic* method: goods bought
 * for resale are debited to Purchases, and the cost of what was sold is only
 * worked out when a period is closed. Closing a period posts one balanced
 * journal that
 *
 *   • charges opening stock and the period's purchases to Cost of Goods Sold,
 *   • clears the Purchases account back to nil, and
 *   • carries the closing stock (from the goods movements) into Inventory,
 *
 * so that COGS = opening + purchases − closing, and the Inventory ledger equals
 * the warehouse valuation at every period end.
 */

const closeKey = (month: string): string => `inventory.close.${month}`

export interface InventoryCloseResult {
  month: string
  /** The date the closing journal was posted (month end, or today if mid-month) */
  date: string
  openingStock: Paise
  purchases: Paise
  closingStock: Paise
  voucherId: string
  voucherNumber: string
}

/** The closing voucher already recorded for a month, if any. */
export async function inventoryCloseForMonth(month: string): Promise<string | null> {
  return getSetting<string | null>(closeKey(month), null)
}

/** Every month that has been closed, oldest first. */
export async function closedInventoryMonths(): Promise<string[]> {
  const rows = await db.settings.toArray()
  return rows
    .filter((row) => row.key.startsWith('inventory.close.'))
    .map((row) => row.key.replace('inventory.close.', ''))
    .sort()
}

export interface CloseInventoryOptions {
  /** 'YYYY-MM' */
  month: string
  /** Override the closing date; defaults to the month end, or today if the month is still running */
  date?: string
  /** Reverse a previous close and post a fresh one */
  reopen?: boolean
}

/**
 * Closes an inventory period. Idempotent in the sense that a month is closed at
 * most once: closing an already-closed month throws unless `reopen` is set, in
 * which case the previous closing journal is reversed (never edited) and a new
 * one is posted.
 */
export async function closeInventoryPeriod(
  actor: Actor,
  input: CloseInventoryOptions,
): Promise<InventoryCloseResult> {
  const { month } = input
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new PostingError('An inventory period must be a YYYY-MM month.')
  }

  const monthStart = monthStartISO(month)
  const monthEnd = monthEndISO(month)
  const today = todayISO()
  const closeDate = input.date ?? (monthEnd <= today ? monthEnd : today)

  if (closeDate < monthStart) {
    throw new PostingError(
      `Cannot close ${month}: the closing date ${closeDate} falls before the period began.`,
    )
  }

  return writeTx(async () => {
    const existing = await inventoryCloseForMonth(month)
    if (existing) {
      if (!input.reopen) {
        throw new PostingError(
          `${month} has already been closed. Use "re-open and reclose" if the period's movements have changed since.`,
        )
      }
      const prior = await db.vouchers.get(existing)
      if (prior && prior.status === 'POSTED') {
        await reverseVoucher(actor, existing, `Re-opening the inventory close for ${month}`)
      } else if (prior && prior.status !== 'REVERSED') {
        throw new PostingError(
          `The existing close for ${month} is ${prior.status.toLowerCase()} and cannot be re-opened.`,
        )
      }
      await db.settings.delete(closeKey(month))
    }

    const [accounts, ledger] = await Promise.all([loadAccounts(), loadLedger()])
    const balance = buildBalanceMap(ledger)

    const inventoryAccount = accounts.find((account) => account.code === ACC.INVENTORY)
    const purchasesAccount = accounts.find((account) => account.code === ACC.PURCHASES)
    if (!inventoryAccount || !purchasesAccount) {
      throw new PostingError('The chart of accounts is missing the Inventory or Purchases account.')
    }

    // The Inventory account balance before the close is the opening stock,
    // because Inventory only ever moves through the close itself.
    const openingStock = netForAccount(inventoryAccount, balance)

    // Purchases for the period, by date, so the entry is correct even if older
    // periods were closed after the fact.
    let purchases = 0
    for (const entry of ledger) {
      if (entry.accountId !== purchasesAccount.id) continue
      if (entry.date < monthStart || entry.date > closeDate) continue
      purchases += entry.debit - entry.credit
    }

    const closingStock = await inventoryValueAsOf(closeDate)

    const resolver = await loadResolver()
    const lines = postInventoryClosing(makeContext(resolver, `Inventory close for ${month}`), {
      openingStock,
      purchases,
      closingStock,
    })

    if (lines.length === 0) {
      throw new PostingError(
        `Nothing to close for ${month}: no opening stock, purchases or closing stock.`,
      )
    }

    const { voucher } = await createVoucher(actor, {
      type: 'JOURNAL',
      date: closeDate,
      narration: `Inventory closing for ${month} — closing stock ${closingStock}`,
      lines,
      refDocType: 'INVENTORY_CLOSE',
    })

    await setSetting(closeKey(month), voucher.id)

    return {
      month,
      date: closeDate,
      openingStock,
      purchases,
      closingStock,
      voucherId: voucher.id,
      voucherNumber: voucher.number,
    }
  })
}
