import { ACC } from '@/db/coa'
import { db, type DepreciationEntry, type FixedAsset } from '@/db/schema'
import { getCompany, loadResolver, makeContext, writeTx } from '@/db/tx'
import { computeInvoiceGst, isInterState } from '@/engine/gst'
import { postDepreciation, postPurchaseInvoice } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { newId } from '@/lib/id'
import { formatMonthKey } from '@/lib/format'
import type { Paise } from '@/lib/money'
import { writeAudit } from './audit'
import { createVoucher, type Actor } from './ledger'

export interface AssetInput {
  code: string
  name: string
  category: string
  cost: Paise
  purchaseDate: string
  usefulLifeYears: number
  method: 'SLM' | 'WDV'
  wdvRate: number
  salvageValue: Paise
  openingAccumulatedDep: Paise
  assetAccountId: string
  narration: string
}

export async function listAssets(): Promise<FixedAsset[]> {
  const rows = await db.assets.toArray()
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

export async function getAsset(id: string): Promise<FixedAsset | undefined> {
  return db.assets.get(id)
}

export async function nextAssetCode(): Promise<string> {
  const rows = await db.assets.toArray()
  return `FA${String(rows.length + 1).padStart(3, '0')}`
}

/** Registers an asset that is already on the books (no posting). */
export async function createAsset(actor: Actor, input: AssetInput): Promise<FixedAsset> {
  return writeTx(async () => {
    const now = Date.now()
    const asset: FixedAsset = {
      ...input,
      id: newId('asset'),
      disposed: false,
      disposedDate: null,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.assets.add(asset)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'assets',
      entityId: asset.id,
      summary: `Registered fixed asset ${input.code} ${input.name} at cost ${input.cost}`,
      after: asset,
    })
    return asset
  })
}

/**
 * Buys an asset and posts it: Dr Fixed Asset, Dr Input GST (if any), Cr Supplier
 * or Bank. The GST treatment follows the same place-of-supply rule as any other
 * purchase.
 */
export async function purchaseAsset(
  actor: Actor,
  input: AssetInput & {
    supplierId?: string | null
    bankAccountId?: string | null
    gstRate: number
  },
): Promise<{ asset: FixedAsset; voucherId: string; total: Paise }> {
  return writeTx(async () => {
    const company = await getCompany()
    const resolver = await loadResolver()

    let interState = false
    let creditAccountId: string
    let partyId: string | null = null

    if (input.supplierId) {
      const supplier = await db.suppliers.get(input.supplierId)
      if (!supplier) throw new PostingError('Select a supplier for this asset purchase')
      interState = isInterState(company.state, supplier.state)
      creditAccountId = supplier.ledgerAccountId
      partyId = supplier.id
    } else {
      creditAccountId = input.bankAccountId ?? resolver(ACC.BANK)
    }

    const gst = computeInvoiceGst([{ taxable: input.cost, gstRate: input.gstRate }], interState)

    const lines = postPurchaseInvoice(makeContext(resolver, `Purchase of ${input.name}`), {
      supplierAccountId: creditAccountId,
      supplierPartyId: partyId,
      debitAccountId: input.assetAccountId,
      taxable: input.cost,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    })

    const now = Date.now()
    const asset: FixedAsset = {
      code: input.code,
      name: input.name,
      category: input.category,
      cost: input.cost,
      purchaseDate: input.purchaseDate,
      usefulLifeYears: input.usefulLifeYears,
      method: input.method,
      wdvRate: input.wdvRate,
      salvageValue: input.salvageValue,
      openingAccumulatedDep: input.openingAccumulatedDep,
      assetAccountId: input.assetAccountId,
      narration: input.narration,
      id: newId('asset'),
      disposed: false,
      disposedDate: null,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.assets.add(asset)

    const { voucher } = await createVoucher(actor, {
      type: 'PURCHASE',
      date: input.purchaseDate,
      narration: `Purchase of fixed asset ${input.name}`,
      lines,
      partyId,
      refDocId: asset.id,
      refDocType: 'ASSET',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'assets',
      entityId: asset.id,
      summary: `Purchased fixed asset ${input.code} ${input.name} for ${gst.total}`,
      after: asset,
    })

    return { asset, voucherId: voucher.id, total: gst.total }
  })
}

/* ==========================================================================
 * Depreciation
 * ========================================================================== */

export async function accumulatedDepreciation(assetId: string): Promise<Paise> {
  const asset = await db.assets.get(assetId)
  if (!asset) return 0

  const entries = await db.depreciationEntries.where('assetId').equals(assetId).toArray()
  return asset.openingAccumulatedDep + entries.reduce((total, entry) => total + entry.amount, 0)
}

/** Monthly charge for one asset, never exceeding the depreciable base. */
export function monthlyDepreciation(
  asset: FixedAsset,
  accumulated: Paise,
): Paise {
  const depreciableBase = asset.cost - asset.salvageValue
  const alreadyProvided = Math.max(0, accumulated - asset.salvageValue)

  if (alreadyProvided >= depreciableBase) return 0

  let charge: number
  if (asset.method === 'SLM') {
    // Straight line: spread the depreciable base evenly over the useful life.
    const months = Math.max(1, asset.usefulLifeYears * 12)
    charge = Math.round(depreciableBase / months)
  } else {
    // Written-down value: a fixed percentage of the carrying amount per annum.
    const carryingAmount = asset.cost - accumulated
    charge = Math.round((carryingAmount * (asset.wdvRate / 100)) / 12)
  }

  return Math.max(0, Math.min(charge, depreciableBase - alreadyProvided))
}

export interface DepreciationPlanRow {
  asset: FixedAsset
  accumulatedBefore: Paise
  charge: Paise
}

/** What a depreciation run would post, without writing anything. */
export async function depreciationPlan(): Promise<DepreciationPlanRow[]> {
  const assets = (await listAssets()).filter((asset) => !asset.disposed)
  const rows: DepreciationPlanRow[] = []

  for (const asset of assets) {
    const accumulatedBefore = await accumulatedDepreciation(asset.id)
    const charge = monthlyDepreciation(asset, accumulatedBefore)
    if (charge > 0) rows.push({ asset, accumulatedBefore, charge })
  }

  return rows
}

/**
 * Posts one depreciation voucher for the whole month and records an entry per
 * asset so that each asset's accumulated depreciation stays auditable.
 */
export async function runDepreciation(
  actor: Actor,
  options: { periodKey: string; date: string },
): Promise<{ voucherId: string; number: string; total: Paise; assetCount: number }> {
  return writeTx(async () => {
    const already = await db.depreciationEntries.where('periodKey').equals(options.periodKey).toArray()
    if (already.length > 0) {
      throw new PostingError(`Depreciation for ${formatMonthKey(options.periodKey)} has already been run.`)
    }

    const plan = await depreciationPlan()
    if (plan.length === 0) throw new PostingError('There is nothing to depreciate for this period.')

    const total = plan.reduce((sum, row) => sum + row.charge, 0)
    const resolver = await loadResolver()

    const lines = postDepreciation(
      makeContext(resolver, `Depreciation for ${formatMonthKey(options.periodKey)}`),
      total,
    )

    const { voucher } = await createVoucher(actor, {
      type: 'DEPRECIATION',
      date: options.date,
      narration: `Depreciation for ${formatMonthKey(options.periodKey)} — ${plan.length} asset(s)`,
      lines,
      refDocType: 'DEPRECIATION_RUN',
    })

    const now = Date.now()
    await db.depreciationEntries.bulkAdd(
      plan.map((row) => ({
        id: newId('depe'),
        assetId: row.asset.id,
        date: options.date,
        periodKey: options.periodKey,
        amount: row.charge,
        voucherId: voucher.id,
        createdAt: now,
        createdBy: actor.userId,
      })),
    )

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'depreciationEntries',
      entityId: voucher.id,
      summary: `Depreciation for ${formatMonthKey(options.periodKey)}: ${total} across ${plan.length} asset(s)`,
      after: { total, assetCount: plan.length },
    })

    return { voucherId: voucher.id, number: voucher.number, total, assetCount: plan.length }
  })
}

export async function depreciationHistory(assetId: string): Promise<DepreciationEntry[]> {
  const rows = await db.depreciationEntries.where('assetId').equals(assetId).toArray()
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1))
}

export async function disposeAsset(
  actor: Actor,
  assetId: string,
  options: { date: string; proceeds: Paise; bankAccountId?: string },
): Promise<{ voucherId: string }> {
  return writeTx(async () => {
    const asset = await db.assets.get(assetId)
    if (!asset) throw new PostingError('Asset not found')
    if (asset.disposed) throw new PostingError(`${asset.name} has already been disposed of.`)

    const resolver = await loadResolver()
    const accumulated = await accumulatedDepreciation(assetId)
    const bookValue = asset.cost - accumulated
    const gainOrLoss = options.proceeds - bookValue

    // Dr Bank (proceeds) + Dr Accumulated Depreciation; Cr Fixed Asset;
    // the balancing figure is a profit or loss on disposal.
    const lines = [
      {
        accountId: options.bankAccountId ?? resolver(ACC.BANK),
        debit: options.proceeds,
        credit: 0,
        narration: 'Disposal proceeds',
      },
      {
        accountId: resolver(ACC.ACCUM_DEPRECIATION),
        debit: accumulated,
        credit: 0,
        narration: 'Accumulated depreciation written back',
      },
      { accountId: asset.assetAccountId, debit: 0, credit: asset.cost, narration: 'Asset derecognised' },
    ]

    if (gainOrLoss > 0) {
      lines.push({
        accountId: resolver(ACC.DISCOUNT_RECEIVED),
        debit: 0,
        credit: gainOrLoss,
        narration: 'Profit on disposal',
      })
    } else if (gainOrLoss < 0) {
      lines.push({
        accountId: resolver(ACC.OFFICE_ADMIN),
        debit: -gainOrLoss,
        credit: 0,
        narration: 'Loss on disposal',
      })
    }

    const { voucher } = await createVoucher(actor, {
      type: 'JOURNAL',
      date: options.date,
      narration: `Disposal of ${asset.name}`,
      lines: lines.filter((line) => line.debit !== 0 || line.credit !== 0),
      refDocId: asset.id,
      refDocType: 'ASSET',
    })

    await db.assets.update(assetId, { disposed: true, disposedDate: options.date })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'DISPOSE',
      entity: 'assets',
      entityId: assetId,
      summary: `Disposed of ${asset.name} for ${options.proceeds} (book value ${bookValue})`,
      after: { proceeds: options.proceeds, bookValue, gainOrLoss },
    })

    return { voucherId: voucher.id }
  })
}
