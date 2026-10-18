import { ACC } from '@/db/coa'
import {
  db,
  type Grn,
  type GrnLine,
  type Invoice,
  type InvoiceLine,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseRequisition,
  type PurchaseRequisitionLine,
  type StockMovement,
} from '@/db/schema'
import { getCompany, loadResolver, makeContext, writeTx } from '@/db/tx'
import { allocateSequence } from '@/engine/numbering'
import { computeInvoiceGst, isInterState, lineTax } from '@/engine/gst'
import { postPurchaseInvoice, postPurchaseReturn } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { financialYearOf } from '@/lib/dates'
import { newId } from '@/lib/id'
import { toPaise, type Paise } from '@/lib/money'
import { writeAudit } from './audit'
import { duplicateInvoiceMessage } from './controls'
import {
  approveVoucher,
  createVoucher,
  entriesForVoucher,
  submitVoucher,
  type Actor,
} from './ledger'

/* ==========================================================================
 * Purchase requisitions
 * ========================================================================== */

export interface RequisitionLineInput {
  itemId: string
  qty: number
  estimatedRate: Paise
}

export async function createRequisition(
  actor: Actor,
  input: { date: string; department: string; narration: string; lines: RequisitionLineInput[] },
): Promise<PurchaseRequisition> {
  if (input.lines.length === 0) throw new PostingError('A requisition needs at least one line')

  return writeTx(async () => {
    const company = await getCompany()
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.REQUISITION ?? 'PR',
      fyKey: fy.key,
    })

    const now = Date.now()
    const requisition: PurchaseRequisition = {
      id: newId('pr'),
      number: allocated.number,
      date: input.date,
      department: input.department,
      requestedBy: actor.userId,
      status: 'DRAFT',
      narration: input.narration,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.purchaseRequisitions.add(requisition)

    const lines: PurchaseRequisitionLine[] = input.lines.map((line) => ({
      id: newId('prl'),
      prId: requisition.id,
      itemId: line.itemId,
      qty: line.qty,
      estimatedRate: line.estimatedRate,
      createdAt: now,
      createdBy: actor.userId,
    }))
    await db.purchaseRequisitionLines.bulkAdd(lines)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'purchaseRequisitions',
      entityId: requisition.id,
      summary: `Raised requisition ${requisition.number} for ${lines.length} item(s)`,
      after: requisition,
    })

    return requisition
  })
}

export async function setRequisitionStatus(
  actor: Actor,
  requisitionId: string,
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED',
  reason?: string,
): Promise<PurchaseRequisition> {
  return writeTx(async () => {
    const requisition = await db.purchaseRequisitions.get(requisitionId)
    if (!requisition) throw new PostingError(`Requisition ${requisitionId} not found`)

    const patch: Partial<PurchaseRequisition> = { status }

    if (status === 'SUBMITTED') {
      if (requisition.status !== 'DRAFT') {
        throw new PostingError(`Only a draft requisition can be submitted (this one is ${requisition.status}).`)
      }
    } else {
      if (requisition.status !== 'SUBMITTED') {
        throw new PostingError(`Only a submitted requisition can be decided on (this one is ${requisition.status}).`)
      }
      // Segregation of duties: the person who raised it cannot approve it.
      if (requisition.requestedBy === actor.userId) {
        throw new PostingError('Segregation of duties: you cannot approve a requisition you raised yourself.')
      }
      patch.approvedBy = actor.userId
      patch.approvedAt = Date.now()
      if (status === 'REJECTED') patch.rejectionReason = reason ?? 'Not approved'
    }

    await db.purchaseRequisitions.update(requisitionId, patch)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: status,
      entity: 'purchaseRequisitions',
      entityId: requisitionId,
      summary: `${status} requisition ${requisition.number}${reason ? ` — ${reason}` : ''}`,
      before: { status: requisition.status },
      after: patch,
    })

    return { ...requisition, ...patch }
  })
}

export async function requisitionLines(requisitionId: string): Promise<PurchaseRequisitionLine[]> {
  return db.purchaseRequisitionLines.where('prId').equals(requisitionId).toArray()
}

/* ==========================================================================
 * Purchase orders
 * ========================================================================== */

export interface PurchaseOrderLineInput {
  itemId: string
  qty: number
  rate: Paise
  gstRate: number
}

export async function createPurchaseOrder(
  actor: Actor,
  input: {
    date: string
    supplierId: string
    expectedDate: string
    prId?: string | null
    narration: string
    lines: PurchaseOrderLineInput[]
  },
): Promise<PurchaseOrder> {
  if (input.lines.length === 0) throw new PostingError('A purchase order needs at least one line')

  return writeTx(async () => {
    const company = await getCompany()
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.PURCHASE_ORDER ?? 'PO',
      fyKey: fy.key,
    })

    const now = Date.now()
    const order: PurchaseOrder = {
      id: newId('po'),
      number: allocated.number,
      date: input.date,
      supplierId: input.supplierId,
      prId: input.prId ?? null,
      expectedDate: input.expectedDate,
      status: 'DRAFT',
      narration: input.narration,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.purchaseOrders.add(order)

    const lines: PurchaseOrderLine[] = input.lines.map((line) => ({
      id: newId('pol'),
      poId: order.id,
      itemId: line.itemId,
      qty: line.qty,
      rate: line.rate,
      gstRate: line.gstRate,
      createdAt: now,
      createdBy: actor.userId,
    }))
    await db.purchaseOrderLines.bulkAdd(lines)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'purchaseOrders',
      entityId: order.id,
      summary: `Raised purchase order ${order.number} for ${lines.length} item(s)`,
      after: order,
    })

    return order
  })
}

export async function approvePurchaseOrder(
  actor: Actor,
  orderId: string,
): Promise<PurchaseOrder> {
  return writeTx(async () => {
    const order = await db.purchaseOrders.get(orderId)
    if (!order) throw new PostingError(`Purchase order ${orderId} not found`)
    if (order.status !== 'DRAFT') {
      throw new PostingError(`Only a draft purchase order can be approved (this one is ${order.status}).`)
    }

    const patch: Partial<PurchaseOrder> = {
      status: 'APPROVED',
      approvedBy: actor.userId,
      approvedAt: Date.now(),
    }
    await db.purchaseOrders.update(orderId, patch)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'APPROVE',
      entity: 'purchaseOrders',
      entityId: orderId,
      summary: `Approved purchase order ${order.number}`,
      before: { status: order.status },
      after: patch,
    })

    return { ...order, ...patch }
  })
}

export async function purchaseOrderLines(orderId: string): Promise<PurchaseOrderLine[]> {
  return db.purchaseOrderLines.where('poId').equals(orderId).toArray()
}

/* ==========================================================================
 * Goods receipt notes
 * ========================================================================== */

export interface GrnLineInput {
  poLineId: string
  itemId: string
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  rate: Paise
}

export async function createGrn(
  actor: Actor,
  input: { date: string; poId: string; receivedBy: string; vehicleNo?: string; narration: string; lines: GrnLineInput[] },
): Promise<Grn> {
  if (input.lines.length === 0) throw new PostingError('A goods receipt needs at least one line')

  return writeTx(async () => {
    const order = await db.purchaseOrders.get(input.poId)
    if (!order) throw new PostingError(`Purchase order ${input.poId} not found`)
    if (order.status === 'DRAFT' || order.status === 'CANCELLED') {
      throw new PostingError(`Goods cannot be received against a ${order.status} purchase order.`)
    }

    const company = await getCompany()
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.GRN ?? 'GRN',
      fyKey: fy.key,
    })

    const now = Date.now()
    const grn: Grn = {
      id: newId('grn'),
      number: allocated.number,
      date: input.date,
      poId: input.poId,
      supplierId: order.supplierId,
      status: 'DRAFT',
      receivedBy: input.receivedBy,
      vehicleNo: input.vehicleNo,
      narration: input.narration,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.grns.add(grn)

    const alreadyReceived = await receivedQtyByPoLine(input.poId)

    const lines: GrnLine[] = input.lines.map((line) => {
      const acceptedQty = line.receivedQty - line.rejectedQty
      if (acceptedQty < 0) {
        throw new PostingError('Rejected quantity cannot exceed the quantity received.')
      }
      const previously = alreadyReceived.get(line.poLineId) ?? 0
      if (previously + acceptedQty > line.orderedQty) {
        throw new PostingError(
          `Over-receipt blocked: ${acceptedQty} accepted plus ${previously} already received exceeds the ${line.orderedQty} ordered.`,
        )
      }

      return {
        id: newId('grnl'),
        grnId: grn.id,
        poLineId: line.poLineId,
        itemId: line.itemId,
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        rejectedQty: line.rejectedQty,
        acceptedQty,
        rate: line.rate,
        createdAt: now,
        createdBy: actor.userId,
      }
    })
    await db.grnLines.bulkAdd(lines)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'grns',
      entityId: grn.id,
      summary: `Recorded goods receipt ${grn.number} against ${order.number}`,
      after: grn,
    })

    return grn
  })
}

export async function grnLines(grnId: string): Promise<GrnLine[]> {
  return db.grnLines.where('grnId').equals(grnId).toArray()
}

/** Quantity already accepted on posted goods receipts, per PO line. */
export async function receivedQtyByPoLine(poId: string): Promise<Map<string, number>> {
  const grns = await db.grns.where('poId').equals(poId).toArray()
  const postedIds = grns.filter((grn) => grn.status === 'POSTED').map((grn) => grn.id)
  const map = new Map<string, number>()
  if (postedIds.length === 0) return map

  const lines = await db.grnLines.where('grnId').anyOf(postedIds).toArray()
  for (const line of lines) {
    map.set(line.poLineId, (map.get(line.poLineId) ?? 0) + line.acceptedQty)
  }
  return map
}

/**
 * Posts a goods receipt: the accepted quantity enters stock.
 *
 * Under the periodic method implemented here the ledger is not touched at
 * receipt at all — the purchase invoice debits Purchases, and the stock ledger
 * (goods movements) alone tracks quantity and valuation until the period-end
 * inventory close. That keeps a single valuation event per receipt and keeps
 * the warehouse honest. Documented as an assumption in the README.
 */
export async function postGrn(actor: Actor, grnId: string): Promise<Grn> {
  return writeTx(async () => {
    const grn = await db.grns.get(grnId)
    if (!grn) throw new PostingError(`Goods receipt ${grnId} not found`)
    if (grn.status !== 'DRAFT') {
      throw new PostingError(`Goods receipt ${grn.number} has already been ${grn.status.toLowerCase()}.`)
    }

    const lines = await grnLines(grnId)
    const now = Date.now()

    const movements: StockMovement[] = lines
      .filter((line) => line.acceptedQty > 0)
      .map((line) => ({
        id: newId('stk'),
        itemId: line.itemId,
        date: grn.date,
        type: 'GRN',
        qtyIn: line.acceptedQty,
        qtyOut: 0,
        rate: line.rate,
        refDocId: grn.id,
        refDocType: 'GRN',
        narration: `Received on ${grn.number}`,
        createdAt: now,
        createdBy: actor.userId,
      }))

    if (movements.length > 0) await db.stockMovements.bulkAdd(movements)
    await db.grns.update(grnId, { status: 'POSTED' })
    await refreshPurchaseOrderStatus(grn.poId)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'grns',
      entityId: grnId,
      summary: `Posted goods receipt ${grn.number} — ${movements.length} item(s) into stock`,
      before: { status: 'DRAFT' },
      after: { status: 'POSTED' },
    })

    return { ...grn, status: 'POSTED' }
  })
}

/** Recomputes a PO's PARTIAL / RECEIVED status from its posted receipts. */
export async function refreshPurchaseOrderStatus(poId: string): Promise<void> {
  const order = await db.purchaseOrders.get(poId)
  if (!order) return
  if (order.status === 'DRAFT' || order.status === 'CANCELLED' || order.status === 'CLOSED') return

  const lines = await db.purchaseOrderLines.where('poId').equals(poId).toArray()
  const received = await receivedQtyByPoLine(poId)

  let complete = true
  let any = false

  for (const line of lines) {
    const got = received.get(line.id) ?? 0
    if (got > 0) any = true
    if (got < line.qty) complete = false
  }

  const next: PurchaseOrder['status'] = complete && lines.length > 0 ? 'RECEIVED' : any ? 'PARTIAL' : order.status
  if (next !== order.status) await db.purchaseOrders.update(poId, { status: next })
}

/* ==========================================================================
 * Three-way match:  Purchase Order  vs  Goods Receipt  vs  Invoice
 * ========================================================================== */

export interface ThreeWayMatchResult {
  ok: boolean
  problems: string[]
}

/**
 * Pure so it can be tested directly. The invoice may never exceed what was
 * accepted at the gate, and the gate may never exceed what was ordered.
 */
export function threeWayMatch(input: {
  po: Array<{ itemId: string; qty: number }>
  grn: Array<{ itemId: string; acceptedQty: number }>
  invoiced: Array<{ itemId: string; qty: number }>
  itemNames?: Map<string, string>
}): ThreeWayMatchResult {
  const problems: string[] = []
  const nameOf = (itemId: string) => input.itemNames?.get(itemId) ?? itemId

  const ordered = sumByItem(input.po.map((line) => ({ itemId: line.itemId, qty: line.qty })))
  const received = sumByItem(input.grn.map((line) => ({ itemId: line.itemId, qty: line.acceptedQty })))
  const billed = sumByItem(input.invoiced.map((line) => ({ itemId: line.itemId, qty: line.qty })))

  for (const [itemId, qty] of received) {
    const alreadyOrdered = ordered.get(itemId) ?? 0
    if (qty > alreadyOrdered) {
      problems.push(
        `Received ${qty} × ${nameOf(itemId)} against a purchase order for only ${alreadyOrdered}.`,
      )
    }
  }

  for (const [itemId, qty] of billed) {
    const accepted = received.get(itemId) ?? 0
    if (qty > accepted) {
      problems.push(
        `Invoiced ${qty} × ${nameOf(itemId)} but only ${accepted} passed inspection at goods receipt.`,
      )
    }
  }

  return { ok: problems.length === 0, problems }
}

function sumByItem(rows: Array<{ itemId: string; qty: number }>): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.itemId, (map.get(row.itemId) ?? 0) + row.qty)
  return map
}

/* ==========================================================================
 * Purchase invoices
 * ========================================================================== */

export interface PurchaseInvoiceLineInput {
  itemId: string | null
  description: string
  hsn: string
  qty: number
  rate: Paise
  gstRate: number
}

export interface PurchaseInvoiceInput {
  supplierId: string
  /** The supplier's own invoice number — unique per supplier */
  partyInvoiceNumber: string
  date: string
  dueDate?: string
  poId?: string | null
  grnId?: string | null
  narration: string
  lines: PurchaseInvoiceLineInput[]
  /** Capitalise to a fixed-asset account instead of Purchases */
  capitaliseToAccountId?: string | null
}

/**
 * Records a purchase invoice and raises its voucher.
 *
 * The voucher starts as a DRAFT; it reaches the ledger only after it has been
 * approved by someone other than the preparer (`approvePurchaseInvoice`).
 */
export async function createPurchaseInvoice(
  actor: Actor,
  input: PurchaseInvoiceInput,
  options: { postImmediately?: boolean } = {},
): Promise<Invoice> {
  if (input.lines.length === 0) throw new PostingError('A purchase invoice needs at least one line')

  return writeTx(async () => {
    const supplier = await db.suppliers.get(input.supplierId)
    if (!supplier) throw new PostingError('Select a supplier for this invoice')

    const company = await getCompany()
    const resolver = await loadResolver()

    // --- Duplicate supplier invoice control -------------------------------
    if (input.partyInvoiceNumber.trim()) {
      const duplicate = await db.invoices
        .where('[type+partyId+partyInvoiceNumber]')
        .equals(['PURCHASE', input.supplierId, input.partyInvoiceNumber.trim()])
        .first()

      if (duplicate) {
        throw new PostingError(duplicateInvoiceMessage(duplicate.partyInvoiceNumber, supplier.name))
      }
    }

    // --- Value the lines ---------------------------------------------------
    const interState = isInterState(company.state, supplier.state)
    const valued = input.lines.map((line) => {
      const taxable = Math.round(line.qty * line.rate)
      const tax = lineTax(taxable, line.gstRate, interState)
      return { line, taxable, ...tax }
    })

    const gst = computeInvoiceGst(
      valued.map((row) => ({ taxable: row.taxable, gstRate: row.line.gstRate })),
      interState,
    )

    // --- Posting engine ----------------------------------------------------
    const debitAccountId = input.capitaliseToAccountId ?? resolver(ACC.PURCHASES)
    const lines = postPurchaseInvoice(makeContext(resolver, `Purchase from ${supplier.name}`), {
      supplierAccountId: supplier.ledgerAccountId,
      supplierPartyId: supplier.id,
      debitAccountId,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    })

    // --- Number, invoice record and voucher --------------------------------
    const fy = financialYearOf(input.date, company.financialYearStartMonth)
    const allocated = await allocateSequence(db.sequences, {
      prefix: company.prefixes.PURCHASE_INVOICE ?? 'PIV',
      fyKey: fy.key,
    })

    const now = Date.now()
    const invoiceId = newId('inv')

    const dueDate =
      input.dueDate ??
      new Date(Date.parse(`${input.date}T00:00:00`) + supplier.paymentTermsDays * 86_400_000)
        .toISOString()
        .slice(0, 10)

    const invoice: Invoice = {
      id: invoiceId,
      type: 'PURCHASE',
      number: allocated.number,
      partyInvoiceNumber: input.partyInvoiceNumber.trim(),
      partyId: supplier.id,
      date: input.date,
      dueDate,
      placeOfSupply: supplier.state,
      interState,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      roundOff: gst.roundOff,
      total: gst.total,
      status: 'DRAFT',
      sourceDocId: input.grnId ?? input.poId ?? null,
      sourceDocType: input.grnId ? 'GRN' : input.poId ? 'PO' : null,
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
      type: 'PURCHASE',
      date: input.date,
      narration: `Purchase invoice ${allocated.number} — ${supplier.name}`,
      lines,
      number: allocated.number,
      partyId: supplier.id,
      refDocId: invoiceId,
      refDocType: 'INVOICE',
      status: 'DRAFT',
    })

    await db.invoices.update(invoiceId, { voucherId: voucher.id })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'invoices',
      entityId: invoiceId,
      summary: `Recorded purchase invoice ${allocated.number} (supplier ref ${input.partyInvoiceNumber}) for ${supplier.name}`,
      after: { total: gst.total, interState },
    })

    if (options.postImmediately) {
      await db.invoices.update(invoiceId, { status: 'POSTED' })
      return { ...invoice, voucherId: voucher.id, status: 'POSTED' }
    }

    return { ...invoice, voucherId: voucher.id }
  })
}

export async function submitInvoice(actor: Actor, invoiceId: string): Promise<Invoice> {
  return writeTx(async () => {
    const invoice = await requireInvoice(invoiceId)
    if (!invoice.voucherId) throw new PostingError('This invoice has no voucher attached.')

    await submitVoucher(actor, invoice.voucherId)
    await db.invoices.update(invoiceId, { status: 'PENDING' })
    return { ...invoice, status: 'PENDING' }
  })
}

/**
 * Approving the invoice approves and posts its voucher, which is the moment the
 * supplier's ledger and the input GST accounts move. Maker–checker and the
 * ₹25,000 approval threshold are both enforced by `approveVoucher`.
 */
export async function approveInvoice(actor: Actor, invoiceId: string): Promise<Invoice> {
  return writeTx(async () => {
    const invoice = await requireInvoice(invoiceId)
    if (!invoice.voucherId) throw new PostingError('This invoice has no voucher attached.')

    const voucher = await db.vouchers.get(invoice.voucherId)
    if (!voucher) throw new PostingError('This invoice voucher has gone missing.')

    if (voucher.status === 'PENDING') {
      await approveVoucher(actor, invoice.voucherId)
    }

    // Posting writes the ledger entries in this same transaction.
    const { postVoucher } = await import('./ledger')
    await postVoucher(actor, invoice.voucherId)

    await db.invoices.update(invoiceId, {
      status: 'POSTED',
      approvedBy: actor.userId,
      approvedAt: Date.now(),
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'APPROVE',
      entity: 'invoices',
      entityId: invoiceId,
      summary: `Approved and posted purchase invoice ${invoice.number}`,
      before: { status: invoice.status },
      after: { status: 'POSTED' },
    })

    return { ...invoice, status: 'POSTED', approvedBy: actor.userId, approvedAt: Date.now() }
  })
}

export async function invoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  return db.invoiceLines.where('invoiceId').equals(invoiceId).toArray()
}

async function requireInvoice(invoiceId: string): Promise<Invoice> {
  const invoice = await db.invoices.get(invoiceId)
  if (!invoice) throw new PostingError(`Invoice ${invoiceId} not found`)
  return invoice
}

export async function listPurchaseInvoices(): Promise<Invoice[]> {
  const rows = await db.invoices.where('type').equals('PURCHASE').toArray()
  return rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
}

/* ==========================================================================
 * Purchase returns (Debit Note)
 * ========================================================================== */

export async function createPurchaseReturn(
  actor: Actor,
  input: {
    supplierId: string
    date: string
    narration: string
    lines: Array<{ itemId: string | null; description: string; qty: number; rate: Paise; gstRate: number }>
  },
): Promise<{ voucherId: string; number: string; total: Paise }> {
  if (input.lines.length === 0) throw new PostingError('A debit note needs at least one line')

  return writeTx(async () => {
    const supplier = await db.suppliers.get(input.supplierId)
    if (!supplier) throw new PostingError('Select a supplier for this return')

    const company = await getCompany()
    const resolver = await loadResolver()
    const interState = isInterState(company.state, supplier.state)

    const valued = input.lines.map((line) => {
      const taxable = Math.round(line.qty * line.rate)
      return { line, taxable, ...lineTax(taxable, line.gstRate, interState) }
    })

    const gst = computeInvoiceGst(
      valued.map((row) => ({ taxable: row.taxable, gstRate: row.line.gstRate })),
      interState,
    )

    const lines = postPurchaseReturn(makeContext(resolver, `Purchase return to ${supplier.name}`), {
      supplierAccountId: supplier.ledgerAccountId,
      supplierPartyId: supplier.id,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'DEBIT_NOTE',
      date: input.date,
      narration: input.narration || `Purchase return to ${supplier.name}`,
      lines,
      partyId: supplier.id,
      refDocType: 'PURCHASE_RETURN',
    })

    const now = Date.now()
    await db.stockMovements.bulkAdd(
      valued
        .filter((row) => row.line.itemId)
        .map((row) => ({
          id: newId('stk'),
          itemId: row.line.itemId as string,
          date: input.date,
          type: 'RETURN_OUT' as const,
          qtyIn: 0,
          qtyOut: row.line.qty,
          rate: row.line.rate,
          refDocId: voucher.id,
          refDocType: 'DEBIT_NOTE',
          narration: `Returned to ${supplier.name}`,
          createdAt: now,
          createdBy: actor.userId,
        })),
    )

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Debit note ${voucher.number} raised on ${supplier.name} for ${gst.total}`,
      after: { total: gst.total },
    })

    return { voucherId: voucher.id, number: voucher.number, total: gst.total }
  })
}

/** Convenience re-export so screens can show the voucher's own lines. */
export { entriesForVoucher }

/** Helper used by the invoice screen to suggest a rate from the item master. */
export function suggestedPurchaseRate(purchasePrice: Paise, markupPercent = 0): Paise {
  return toPaise(purchasePrice / 100 * (1 + markupPercent / 100))
}
