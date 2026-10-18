import { ACC } from '@/db/coa'
import {
  db,
  type Delivery,
  type DeliveryLine,
  type Invoice,
  type InvoiceLine,
  type SalesOrder,
  type SalesOrderLine,
  type StockMovement,
} from '@/db/schema'
import { getCompany, loadResolver, makeContext, writeTx } from '@/db/tx'
import { computeInvoiceGst, isInterState, lineTax } from '@/engine/gst'
import { allocateSequence } from '@/engine/numbering'
import { postSalesInvoice, postSalesReturn } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { financialYearOf } from '@/lib/dates'
import { newId } from '@/lib/id'
import type { Paise } from '@/lib/money'
import { writeAudit } from './audit'
import { stockPositionFor, valueIssue } from './inventory'
import { approveVoucher, createVoucher, submitVoucher, type Actor } from './ledger'

/* ==========================================================================
 * Sales orders
 * ========================================================================== */

export interface SalesOrderLineInput {
  itemId: string
  qty: number
  rate: Paise
  gstRate: number
}

export async function createSalesOrder(
  actor: Actor,
  input: {
    customerId: string
    date: string
    expectedDate: string
    narration: string
    lines: SalesOrderLineInput[]
  },
): Promise<SalesOrder> {
  if (input.lines.length === 0) throw new PostingError('A sales order needs at least one line')

  return writeTx(async () => {
    const company = await getCompany()
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.SALES_ORDER ?? 'SO',
      fyKey: fy.key,
    })

    const now = Date.now()
    const order: SalesOrder = {
      id: newId('so'),
      number: allocated.number,
      date: input.date,
      customerId: input.customerId,
      expectedDate: input.expectedDate,
      status: 'DRAFT',
      narration: input.narration,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.salesOrders.add(order)

    const lines: SalesOrderLine[] = input.lines.map((line) => ({
      id: newId('sol'),
      soId: order.id,
      itemId: line.itemId,
      qty: line.qty,
      rate: line.rate,
      gstRate: line.gstRate,
      createdAt: now,
      createdBy: actor.userId,
    }))
    await db.salesOrderLines.bulkAdd(lines)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'salesOrders',
      entityId: order.id,
      summary: `Raised sales order ${order.number} for ${lines.length} item(s)`,
      after: order,
    })

    return order
  })
}

export async function salesOrderLines(soId: string): Promise<SalesOrderLine[]> {
  return db.salesOrderLines.where('soId').equals(soId).toArray()
}

export async function setSalesOrderStatus(
  actor: Actor,
  soId: string,
  status: SalesOrder['status'],
): Promise<SalesOrder> {
  return writeTx(async () => {
    const order = await db.salesOrders.get(soId)
    if (!order) throw new PostingError(`Sales order ${soId} not found`)

    await db.salesOrders.update(soId, { status })
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: status,
      entity: 'salesOrders',
      entityId: soId,
      summary: `Sales order ${order.number} marked ${status}`,
      before: { status: order.status },
      after: { status },
    })
    return { ...order, status }
  })
}

/* ==========================================================================
 * Stock availability
 * ========================================================================== */

export interface Shortfall {
  itemId: string
  required: number
  available: number
  shortBy: number
}

/**
 * Checks every line against stock on hand. The specification says a short line
 * should either be blocked or back-ordered; this application blocks by default
 * and reports exactly what is missing so the operator can split the delivery.
 */
export async function checkAvailability(
  lines: Array<{ itemId: string; qty: number }>,
): Promise<Shortfall[]> {
  const shortfalls: Shortfall[] = []
  const required = new Map<string, number>()

  for (const line of lines) {
    required.set(line.itemId, (required.get(line.itemId) ?? 0) + line.qty)
  }

  for (const [itemId, qty] of required) {
    const position = await stockPositionFor(itemId)
    if (position.qty < qty) {
      shortfalls.push({ itemId, required: qty, available: position.qty, shortBy: qty - position.qty })
    }
  }

  return shortfalls
}

/* ==========================================================================
 * Deliveries
 * ========================================================================== */

export interface DeliveryLineInput {
  itemId: string
  soLineId?: string | null
  qty: number
  rate: Paise
}

export async function createDelivery(
  actor: Actor,
  input: {
    customerId: string
    date: string
    soId?: string | null
    deliveredBy: string
    narration: string
    lines: DeliveryLineInput[]
    /** Allow the delivery even when stock is short (back-order) */
    allowShortfall?: boolean
  },
): Promise<Delivery> {
  if (input.lines.length === 0) throw new PostingError('A delivery needs at least one line')

  return writeTx(async () => {
    const shortfalls = await checkAvailability(input.lines)
    if (shortfalls.length > 0 && !input.allowShortfall) {
      const detail = shortfalls
        .map((row) => `${row.itemId} is short by ${row.shortBy}`)
        .join('; ')
      throw new PostingError(`Insufficient stock: ${detail}. Split the delivery or back-order the balance.`)
    }

    const company = await getCompany()
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.DELIVERY ?? 'DC',
      fyKey: fy.key,
    })

    const now = Date.now()
    const delivery: Delivery = {
      id: newId('dlv'),
      number: allocated.number,
      date: input.date,
      soId: input.soId ?? null,
      customerId: input.customerId,
      status: 'DRAFT',
      deliveredBy: input.deliveredBy,
      invoiceId: null,
      narration: input.narration,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.deliveries.add(delivery)

    // The weighted-average cost is captured now, at despatch, so the period-end
    // inventory close can value what left the warehouse.
    const lines: DeliveryLine[] = []
    for (const line of input.lines) {
      const movements = await db.stockMovements.where('itemId').equals(line.itemId).toArray()
      const { unitCost } = valueIssue(line.itemId, movements, line.qty, input.date)
      lines.push({
        id: newId('dlvl'),
        deliveryId: delivery.id,
        soLineId: line.soLineId ?? null,
        itemId: line.itemId,
        qty: line.qty,
        rate: line.rate,
        costRate: unitCost,
        createdAt: now,
        createdBy: actor.userId,
      })
    }
    await db.deliveryLines.bulkAdd(lines)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'deliveries',
      entityId: delivery.id,
      summary: `Prepared delivery ${delivery.number} for ${lines.length} item(s)`,
      after: delivery,
    })

    return delivery
  })
}

export async function deliveryLines(deliveryId: string): Promise<DeliveryLine[]> {
  return db.deliveryLines.where('deliveryId').equals(deliveryId).toArray()
}

/**
 * Posts a delivery: stock leaves the warehouse, which is all the ledger needs
 * to know — under the periodic method the cost of goods sold is recognised once
 * at the period-end inventory close, not delivery by delivery. The quantity and
 * its weighted-average value are recorded here so that close is accurate.
 */
export async function postDelivery(actor: Actor, deliveryId: string): Promise<Delivery> {
  return writeTx(async () => {
    const delivery = await db.deliveries.get(deliveryId)
    if (!delivery) throw new PostingError(`Delivery ${deliveryId} not found`)
    if (delivery.status !== 'DRAFT') {
      throw new PostingError(`Delivery ${delivery.number} has already been ${delivery.status.toLowerCase()}.`)
    }

    const lines = await deliveryLines(deliveryId)
    const now = Date.now()

    const movements: StockMovement[] = lines.map((line) => ({
      id: newId('stk'),
      itemId: line.itemId,
      date: delivery.date,
      type: 'DELIVERY',
      qtyIn: 0,
      qtyOut: line.qty,
      rate: line.costRate,
      refDocId: delivery.id,
      refDocType: 'DELIVERY',
      narration: `Delivered on ${delivery.number}`,
      createdAt: now,
      createdBy: actor.userId,
    }))
    await db.stockMovements.bulkAdd(movements)

    const costValue = lines.reduce((total, line) => total + Math.round(line.qty * line.costRate), 0)

    await db.deliveries.update(deliveryId, { status: 'POSTED' })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'deliveries',
      entityId: deliveryId,
      summary: `Posted delivery ${delivery.number} — stock out, cost value ${costValue}`,
      before: { status: 'DRAFT' },
      after: { status: 'POSTED', costValue },
    })

    return { ...delivery, status: 'POSTED' }
  })
}

/* ==========================================================================
 * Sales invoices
 * ========================================================================== */

export interface SalesInvoiceLineInput {
  itemId: string | null
  description: string
  hsn: string
  qty: number
  rate: Paise
  gstRate: number
}

export interface SalesInvoiceInput {
  customerId: string
  date: string
  dueDate?: string
  deliveryId?: string | null
  soId?: string | null
  narration: string
  lines: SalesInvoiceLineInput[]
}

export async function createSalesInvoice(
  actor: Actor,
  input: SalesInvoiceInput,
): Promise<Invoice> {
  if (input.lines.length === 0) throw new PostingError('A sales invoice needs at least one line')

  return writeTx(async () => {
    const customer = await db.customers.get(input.customerId)
    if (!customer) throw new PostingError('Select a customer for this invoice')

    const company = await getCompany()
    const resolver = await loadResolver()
    const interState = isInterState(company.state, customer.state)

    const valued = input.lines.map((line) => {
      const taxable = Math.round(line.qty * line.rate)
      return { line, taxable, ...lineTax(taxable, line.gstRate, interState) }
    })

    const gst = computeInvoiceGst(
      valued.map((row) => ({ taxable: row.taxable, gstRate: row.line.gstRate })),
      interState,
    )

    // Service lines are billed straight to Service Income; goods lines to Sales.
    // A line with no item is treated as goods so free-text lines still post to
    // Sales, which is where an ad-hoc product line belongs.
    const itemIds = Array.from(
      new Set(input.lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))),
    )
    const itemRows = await db.items.bulkGet(itemIds)
    const serviceItemIds = new Set(
      itemRows.filter((item) => item?.kind === 'SERVICE').map((item) => item!.id),
    )
    const serviceTaxable = valued.reduce(
      (sum, row) =>
        row.line.itemId && serviceItemIds.has(row.line.itemId) ? sum + row.taxable : sum,
      0,
    )

    const lines = postSalesInvoice(makeContext(resolver, `Sale to ${customer.name}`), {
      customerAccountId: customer.ledgerAccountId,
      customerPartyId: customer.id,
      taxable: gst.taxable,
      serviceTaxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    })

    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.SALES_INVOICE ?? 'INV',
      fyKey: fy.key,
    })

    const now = Date.now()
    const invoiceId = newId('inv')

    const dueDate =
      input.dueDate ??
      new Date(Date.parse(`${input.date}T00:00:00`) + customer.creditDays * 86_400_000)
        .toISOString()
        .slice(0, 10)

    const invoice: Invoice = {
      id: invoiceId,
      type: 'SALES',
      number: allocated.number,
      // For our own sales invoices the "party invoice number" is our number,
      // which keeps the unique index meaningful for both directions.
      partyInvoiceNumber: allocated.number,
      partyId: customer.id,
      date: input.date,
      dueDate,
      placeOfSupply: customer.state,
      interState,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      roundOff: gst.roundOff,
      total: gst.total,
      status: 'DRAFT',
      sourceDocId: input.deliveryId ?? input.soId ?? null,
      sourceDocType: input.deliveryId ? 'DELIVERY' : input.soId ? 'SO' : null,
      voucherId: null,
      narration: input.narration,
      preparedBy: actor.userId,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.invoices.add(invoice)

    const invoiceLines: InvoiceLine[] = valued.map((row) => ({
      id: newId('invl'),
      invoiceId,
      itemId: row.line.itemId,
      description: row.line.description,
      hsn: row.line.hsn,
      qty: row.line.qty,
      rate: row.line.rate,
      gstRate: row.line.gstRate,
      taxable: row.taxable,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      createdAt: now,
      createdBy: actor.userId,
    }))
    await db.invoiceLines.bulkAdd(invoiceLines)

    const { voucher } = await createVoucher(actor, {
      type: 'SALES',
      date: input.date,
      narration: `Sales invoice ${allocated.number} — ${customer.name}`,
      lines,
      number: allocated.number,
      partyId: customer.id,
      refDocId: invoiceId,
      refDocType: 'INVOICE',
      status: 'DRAFT',
    })

    await db.invoices.update(invoiceId, { voucherId: voucher.id })

    if (input.deliveryId) {
      await db.deliveries.update(input.deliveryId, { status: 'INVOICED', invoiceId })
    }

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'invoices',
      entityId: invoiceId,
      summary: `Raised sales invoice ${allocated.number} on ${customer.name} for ${gst.total}`,
      after: { total: gst.total, interState },
    })

    return { ...invoice, voucherId: voucher.id }
  })
}

export async function submitSalesInvoice(actor: Actor, invoiceId: string): Promise<Invoice> {
  return writeTx(async () => {
    const invoice = await db.invoices.get(invoiceId)
    if (!invoice) throw new PostingError(`Invoice ${invoiceId} not found`)
    if (!invoice.voucherId) throw new PostingError('This invoice has no voucher attached.')

    await submitVoucher(actor, invoice.voucherId)
    await db.invoices.update(invoiceId, { status: 'PENDING' })
    return { ...invoice, status: 'PENDING' }
  })
}

export async function approveSalesInvoice(actor: Actor, invoiceId: string): Promise<Invoice> {
  return writeTx(async () => {
    const invoice = await db.invoices.get(invoiceId)
    if (!invoice) throw new PostingError(`Invoice ${invoiceId} not found`)
    if (!invoice.voucherId) throw new PostingError('This invoice has no voucher attached.')

    const voucher = await db.vouchers.get(invoice.voucherId)
    if (!voucher) throw new PostingError('This invoice voucher has gone missing.')

    if (voucher.status === 'PENDING') {
      await approveVoucher(actor, invoice.voucherId)
    }

    const { postVoucher } = await import('./ledger')
    await postVoucher(actor, invoice.voucherId)

    const patch = { status: 'POSTED' as const, approvedBy: actor.userId, approvedAt: Date.now() }
    await db.invoices.update(invoiceId, patch)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'APPROVE',
      entity: 'invoices',
      entityId: invoiceId,
      summary: `Approved and posted sales invoice ${invoice.number}`,
      before: { status: invoice.status },
      after: { status: 'POSTED' },
    })

    return { ...invoice, ...patch }
  })
}

export async function listSalesInvoices(): Promise<Invoice[]> {
  const rows = await db.invoices.where('type').equals('SALES').toArray()
  return rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
}

export async function listDeliveries(): Promise<Delivery[]> {
  const rows = await db.deliveries.toArray()
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
}

export async function listSalesOrders(): Promise<SalesOrder[]> {
  const rows = await db.salesOrders.toArray()
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
}

/* ==========================================================================
 * Sales returns (Credit Note)
 * ========================================================================== */

export async function createSalesReturn(
  actor: Actor,
  input: {
    customerId: string
    date: string
    narration: string
    lines: Array<{ itemId: string | null; description: string; qty: number; rate: Paise; gstRate: number }>
    /** Reinstate the returned goods into stock at this cost per unit */
    reinstateStock?: boolean
  },
): Promise<{ voucherId: string; number: string; total: Paise }> {
  if (input.lines.length === 0) throw new PostingError('A credit note needs at least one line')

  return writeTx(async () => {
    const customer = await db.customers.get(input.customerId)
    if (!customer) throw new PostingError('Select a customer for this return')

    const company = await getCompany()
    const resolver = await loadResolver()
    const interState = isInterState(company.state, customer.state)

    const valued = input.lines.map((line) => {
      const taxable = Math.round(line.qty * line.rate)
      return { line, taxable, ...lineTax(taxable, line.gstRate, interState) }
    })

    const gst = computeInvoiceGst(
      valued.map((row) => ({ taxable: row.taxable, gstRate: row.line.gstRate })),
      interState,
    )

    const lines = postSalesReturn(makeContext(resolver, `Sales return from ${customer.name}`), {
      customerAccountId: customer.ledgerAccountId,
      customerPartyId: customer.id,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'CREDIT_NOTE',
      date: input.date,
      narration: input.narration || `Sales return from ${customer.name}`,
      lines,
      partyId: customer.id,
      refDocType: 'SALES_RETURN',
    })

    const now = Date.now()

    if (input.reinstateStock) {
      const movements: StockMovement[] = []

      // Services were never issued from stock, so they are never put back.
      const returnedIds = Array.from(
        new Set(valued.map((row) => row.line.itemId).filter((id): id is string => Boolean(id))),
      )
      const returnedItems = await db.items.bulkGet(returnedIds)
      const serviceIds = new Set(
        returnedItems.filter((item) => item?.kind === 'SERVICE').map((item) => item!.id),
      )

      for (const row of valued) {
        if (!row.line.itemId || serviceIds.has(row.line.itemId)) continue

        // Returned goods go back into stock at the weighted-average cost that
        // applied when they left — never at the selling price — so the quantity
        // ledger keeps a sensible valuation for the period-end inventory close.
        const existing = await db.stockMovements.where('itemId').equals(row.line.itemId).toArray()
        const { unitCost } = valueIssue(row.line.itemId, existing, row.line.qty, input.date)

        movements.push({
          id: newId('stk'),
          itemId: row.line.itemId,
          date: input.date,
          type: 'RETURN_IN',
          qtyIn: row.line.qty,
          qtyOut: 0,
          rate: unitCost,
          refDocId: voucher.id,
          refDocType: 'CREDIT_NOTE',
          narration: `Returned by ${customer.name}`,
          createdAt: now,
          createdBy: actor.userId,
        })
      }

      if (movements.length > 0) await db.stockMovements.bulkAdd(movements)
    }

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Credit note ${voucher.number} issued to ${customer.name} for ${gst.total}`,
      after: { total: gst.total },
    })

    return { voucherId: voucher.id, number: voucher.number, total: gst.total }
  })
}

/** Receivable-type helper reused by the receivables screens. */
export function creditDaysOverdue(dueDate: string, asOn: string): number {
  const due = Date.parse(`${dueDate}T00:00:00`)
  const on = Date.parse(`${asOn}T00:00:00`)
  return Math.floor((on - due) / 86_400_000)
}

export { ACC }
