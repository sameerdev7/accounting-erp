import { db, type StockMovement } from '@/db/schema'
import type { Paise } from '@/lib/money'

/**
 * Inventory valuation, derived rather than stored.
 *
 * Stock movements are the single source of truth for both quantity and value.
 * Nothing caches an "on hand" figure, so the warehouse and the period-end
 * inventory close always agree. Under the periodic method the Inventory ledger
 * account is written only at the close, from the figure this module derives.
 */

export interface StockPosition {
  itemId: string
  qty: number
  /** Total inventory value in paise at weighted-average cost */
  value: Paise
  /** Weighted average cost per unit in paise */
  avgCost: Paise
  lastMovementDate: string
}

export function sortMovements(movements: StockMovement[]): StockMovement[] {
  return [...movements].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return a.createdAt - b.createdAt
  })
}

/**
 * Replays movements in date order applying the weighted-average method:
 * each receipt re-averages the unit cost, each issue is valued at the average
 * cost prevailing at that moment.
 */
export function replayMovements(itemId: string, movements: StockMovement[]): StockPosition {
  let qty = 0
  let value = 0
  let lastMovementDate = ''

  for (const movement of sortMovements(movements)) {
    if (movement.qtyIn > 0) {
      qty += movement.qtyIn
      value += movement.qtyIn * movement.rate
    }
    if (movement.qtyOut > 0) {
      // An outbound movement may state its own unit cost (returns do, because
      // they are valued at the price they were bought or sold at). When no rate
      // is given — the normal despatch case — the running weighted average is
      // used, which is what the delivery service captures as `costRate`.
      const unitCost =
        movement.rate > 0 ? movement.rate : qty > 0 ? Math.round(value / qty) : 0
      const issued = Math.min(movement.qtyOut, qty)
      qty -= issued
      value -= issued * unitCost
      // Anything issued beyond what we held has no cost basis; keep qty from
      // going negative and let the discrepancy show up as a negative value.
      qty -= movement.qtyOut - issued
    }
    lastMovementDate = movement.date
  }

  return {
    itemId,
    qty: round3(qty),
    value: Math.round(value),
    avgCost: qty > 0 ? Math.round(value / qty) : 0,
    lastMovementDate,
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Values an issue of `qty` units at the weighted-average cost prevailing at
 * `date`. Used by the delivery service to compute COGS before the outbound
 * movement is written.
 */
export function valueIssue(
  itemId: string,
  movements: StockMovement[],
  qty: number,
  date: string,
): { unitCost: Paise; totalCost: Paise } {
  const upToDate = movements.filter((movement) => movement.date <= date)
  const position = replayMovements(itemId, upToDate)
  const unitCost = position.avgCost
  return { unitCost, totalCost: Math.round(unitCost * qty) }
}

export interface StockRow {
  itemId: string
  qty: number
  value: Paise
  avgCost: Paise
  lastMovementDate: string
}

/** Stock position for every item that has ever moved. */
export async function stockPositions(): Promise<Map<string, StockPosition>> {
  const movements = await db.stockMovements.toArray()
  const grouped = groupByItem(movements)
  const result = new Map<string, StockPosition>()

  for (const [itemId, rows] of grouped) {
    result.set(itemId, replayMovements(itemId, rows))
  }
  return result
}

export async function stockPositionFor(itemId: string): Promise<StockPosition> {
  const movements = await db.stockMovements.where('itemId').equals(itemId).toArray()
  return replayMovements(itemId, movements)
}

export async function stockPositionsFor(itemIds: string[]): Promise<Map<string, StockPosition>> {
  const all = await stockPositions()
  const result = new Map<string, StockPosition>()
  for (const itemId of itemIds) {
    const position = all.get(itemId)
    if (position) result.set(itemId, position)
  }
  return result
}

export function groupByItem(movements: StockMovement[]): Map<string, StockMovement[]> {
  const grouped = new Map<string, StockMovement[]>()
  for (const movement of movements) {
    const list = grouped.get(movement.itemId)
    if (list) list.push(movement)
    else grouped.set(movement.itemId, [movement])
  }
  return grouped
}

/** Total value of inventory on hand — the closing stock of the current books. */
export async function totalInventoryValue(): Promise<Paise> {
  const positions = await stockPositions()
  let total = 0
  for (const position of positions.values()) total += position.value
  return total
}

/**
 * Inventory value as at the end of `date`, valued by replaying only the
 * movements on or before that day. Used by the period-end close to determine
 * closing stock, and by the reports.
 */
export async function inventoryValueAsOf(date: string): Promise<Paise> {
  const movements = await db.stockMovements.toArray()
  let total = 0
  for (const [itemId, rows] of groupByItem(movements)) {
    const upToDate = rows.filter((movement) => movement.date <= date)
    if (upToDate.length === 0) continue
    total += replayMovements(itemId, upToDate).value
  }
  return total
}
