import { ACC } from '@/db/coa'
import { db, type LedgerEntry } from '@/db/schema'
import { loadResolver, makeContext, writeTx } from '@/db/tx'
import { postGstSettlement } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { summariseGst, type GstSummary } from '@/engine/gst'
import { financialYearOf, monthEndISO, monthStartISO, monthsInFinancialYear } from '@/lib/dates'
import { formatMonthKey } from '@/lib/format'
import { formatINR, type Paise } from '@/lib/money'
import { writeAudit } from './audit'
import { createVoucher, type Actor } from './ledger'

export interface GstPosition extends GstSummary {
  from: string
  to: string
  /** Per-month output/input tax, for the trend view */
  monthly: Array<{ month: string; outputTotal: Paise; inputTotal: Paise; net: Paise }>
}

function balanceOf(
  entries: LedgerEntry[],
  accountId: string,
  direction: 'DEBIT' | 'CREDIT',
): Paise {
  const rows = entries.filter((entry) => entry.accountId === accountId)
  const debit = rows.reduce((total, entry) => total + entry.debit, 0)
  const credit = rows.reduce((total, entry) => total + entry.credit, 0)
  return direction === 'DEBIT' ? debit - credit : credit - debit
}

async function accountIdFor(code: string): Promise<string> {
  const account = await db.accounts.where('code').equals(code).first()
  if (!account) throw new PostingError(`Chart of accounts is missing ${code}`)
  return account.id
}

/**
 * The GST position for a period, read straight from the ledger rather than from
 * a stored return. Output tax is a liability (credit-normal), input tax is an
 * asset (debit-normal).
 */
export async function gstPosition(from: string, to: string): Promise<GstPosition> {
  const [outputCgstId, outputSgstId, outputIgstId, inputCgstId, inputSgstId, inputIgstId] =
    await Promise.all([
      accountIdFor(ACC.OUTPUT_CGST),
      accountIdFor(ACC.OUTPUT_SGST),
      accountIdFor(ACC.OUTPUT_IGST),
      accountIdFor(ACC.INPUT_CGST),
      accountIdFor(ACC.INPUT_SGST),
      accountIdFor(ACC.INPUT_IGST),
    ])

  const entries = (await db.ledgerEntries.toArray()).filter(
    (entry) => entry.date >= from && entry.date <= to,
  )

  const outputCgst = balanceOf(entries, outputCgstId, 'CREDIT')
  const outputSgst = balanceOf(entries, outputSgstId, 'CREDIT')
  const outputIgst = balanceOf(entries, outputIgstId, 'CREDIT')
  const inputCgst = balanceOf(entries, inputCgstId, 'DEBIT')
  const inputSgst = balanceOf(entries, inputSgstId, 'DEBIT')
  const inputIgst = balanceOf(entries, inputIgstId, 'DEBIT')

  const summary = summariseGst({ outputCgst, outputSgst, outputIgst, inputCgst, inputSgst, inputIgst })

  const byMonth = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const key = entry.date.slice(0, 7)
    const list = byMonth.get(key)
    if (list) list.push(entry)
    else byMonth.set(key, [entry])
  }

  const monthly = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, rows]) => {
      const out = summariseGst({
        outputCgst: balanceOf(rows, outputCgstId, 'CREDIT'),
        outputSgst: balanceOf(rows, outputSgstId, 'CREDIT'),
        outputIgst: balanceOf(rows, outputIgstId, 'CREDIT'),
        inputCgst: balanceOf(rows, inputCgstId, 'DEBIT'),
        inputSgst: balanceOf(rows, inputSgstId, 'DEBIT'),
        inputIgst: balanceOf(rows, inputIgstId, 'DEBIT'),
      })
      return {
        month,
        outputTotal: out.outputTotal,
        inputTotal: out.inputTotal,
        net: out.netPayable,
      }
    })

  return { ...summary, from, to, monthly }
}

/** The GST position for a single month, used by the GST screen and dashboard. */
export async function gstPositionForMonth(month: string): Promise<GstPosition> {
  return gstPosition(monthStartISO(month), monthEndISO(month))
}

export interface GstMonthRow {
  month: string
  label: string
  outputTotal: Paise
  inputTotal: Paise
  net: Paise
  settled: boolean
}

/** Every month of the financial year with its GST position and settlement state. */
export async function gstYearOverview(referenceDate: string): Promise<GstYearRow[]> {
  const fy = financialYearOf(referenceDate)
  const months = monthsInFinancialYear(fy)
  const settlements = await db.vouchers.where('type').equals('JOURNAL').toArray()
  const settlementMonths = new Set(
    settlements
      .filter((voucher) => voucher.narration.startsWith('GST settlement'))
      .map((voucher) => voucher.date.slice(0, 7)),
  )

  const rows: GstYearRow[] = []
  for (const month of months) {
    const position = await gstPositionForMonth(month)
    rows.push({
      month,
      label: formatMonthKey(month),
      outputTotal: position.outputTotal,
      inputTotal: position.inputTotal,
      net: position.netPayable,
      settled: settlementMonths.has(month),
      isFuture: month > referenceDate.slice(0, 7),
    })
  }

  return rows
}

export interface GstYearRow extends GstMonthRow {
  isFuture: boolean
}

/**
 * Settles GST for a month by clearing the output and input control accounts and
 * booking the net position to GST Payable (or carrying a credit forward).
 */
export async function settleGst(
  actor: Actor,
  options: { month: string; date?: string },
): Promise<{ voucherId: string; number: string; net: Paise }> {
  return writeTx(async () => {
    const from = monthStartISO(options.month)
    const to = monthEndISO(options.month)
    const position = await gstPosition(from, to)

    if (position.outputTotal === 0 && position.inputTotal === 0) {
      throw new PostingError(`There is no GST activity in ${formatMonthKey(options.month)} to settle.`)
    }

    const resolver = await loadResolver()
    const lines = postGstSettlement(
      makeContext(resolver, `GST settlement for ${formatMonthKey(options.month)}`),
      {
        outputCgst: position.outputCgst,
        outputSgst: position.outputSgst,
        outputIgst: position.outputIgst,
        inputCgst: position.inputCgst,
        inputSgst: position.inputSgst,
        inputIgst: position.inputIgst,
      },
    )

    const { voucher } = await createVoucher(actor, {
      type: 'JOURNAL',
      date: options.date ?? to,
      narration: `GST settlement for ${formatMonthKey(options.month)} — net ${formatINR(position.netPayable)}`,
      lines,
      refDocType: 'GST_SETTLEMENT',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Settled GST for ${formatMonthKey(options.month)}: net ${position.netPayable}`,
      after: { month: options.month, net: position.netPayable },
    })

    return { voucherId: voucher.id, number: voucher.number, net: position.netPayable }
  })
}

/** Pays the accumulated GST Payable balance to the government. */
export async function payGst(
  actor: Actor,
  options: { amount: Paise; date: string; bankAccountId?: string; narration?: string },
): Promise<{ voucherId: string }> {
  return writeTx(async () => {
    const resolver = await loadResolver()
    const account = await db.accounts.where('code').equals(ACC.GST_PAYABLE).first()
    if (!account) throw new PostingError('GST Payable account is missing from the chart of accounts')

    const lines = [
      {
        accountId: account.id,
        debit: options.amount,
        credit: 0,
        narration: 'GST paid',
      },
      {
        accountId: options.bankAccountId ?? resolver(ACC.BANK),
        debit: 0,
        credit: options.amount,
        narration: 'Paid from bank',
      },
    ]

    const { voucher } = await createVoucher(actor, {
      type: 'PAYMENT',
      date: options.date,
      narration: options.narration ?? 'GST paid to the government',
      lines,
      refDocType: 'GST_PAYMENT',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Paid GST of ${options.amount} to the government`,
      after: { amount: options.amount },
    })

    return { voucherId: voucher.id }
  })
}

/** Current balance sitting in GST Payable. */
export async function gstPayableBalance(): Promise<Paise> {
  const account = await db.accounts.where('code').equals(ACC.GST_PAYABLE).first()
  if (!account) return 0
  const entries = await db.ledgerEntries.where('accountId').equals(account.id).toArray()
  return entries.reduce((total, entry) => total + entry.credit - entry.debit, 0)
}
