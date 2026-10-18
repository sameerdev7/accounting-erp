import { db, type Invoice } from '@/db/schema'
import { summariseGst } from '@/engine/gst'
import { formatINR, type Paise } from '@/lib/money'
import { inRange } from './core'
import { moneyColumn, numberColumn, textColumn, type ReportResult, type ReportRow } from './types'

/* ==========================================================================
 * GSTR-1 — outward supplies grouped by GST rate
 * ========================================================================== */

/**
 * A GSTR-1-style B2B summary of sales invoices for the period, grouped by the
 * GST rate carried on each invoice line. Rate detail lives on the lines, not on
 * the invoice header, so lines are the source of the slab split.
 */
export async function gstr1(opts: { from: string; to: string }): Promise<ReportResult> {
  const [invoices, lines] = await Promise.all([
    db.invoices.where('type').equals('SALES').toArray(),
    db.invoiceLines.toArray(),
  ])

  const inPeriod = invoices.filter((invoice) => inRange(invoice.date, opts.from, opts.to))
  const invoiceIds = new Set(inPeriod.map((invoice) => invoice.id))
  const relevantLines = lines.filter((line) => invoiceIds.has(line.invoiceId))

  const byRate = new Map<number, { taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise }>()
  for (const line of relevantLines) {
    const bucket = byRate.get(line.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    bucket.taxable += line.taxable
    bucket.cgst += line.cgst
    bucket.sgst += line.sgst
    bucket.igst += line.igst
    byRate.set(line.gstRate, bucket)
  }

  const rows: ReportRow[] = [{ id: 'section-b2b', particulars: 'B2B — outward supplies', emphasis: 'heading' }]

  const rates = [...byRate.keys()].sort((a, b) => a - b)
  const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0 }

  for (const rate of rates) {
    const bucket = byRate.get(rate)!
    totals.taxable += bucket.taxable
    totals.cgst += bucket.cgst
    totals.sgst += bucket.sgst
    totals.igst += bucket.igst
    rows.push({
      id: `rate-${rate}`,
      rate,
      taxable: bucket.taxable,
      cgst: bucket.cgst,
      sgst: bucket.sgst,
      igst: bucket.igst,
    })
  }

  rows.push({
    id: 'total',
    rate: '',
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    particulars: 'Total',
    emphasis: 'total',
  })

  const totalTax = totals.cgst + totals.sgst + totals.igst
  const result: ReportResult = {
    title: 'GSTR-1 Summary',
    subtitle: `${opts.from} to ${opts.to}`,
    columns: [
      textColumn('particulars', 'Rate / Particulars'),
      numberColumn('rate', 'Rate %', 0),
      moneyColumn('taxable', 'Taxable Value', true),
      moneyColumn('cgst', 'CGST', true),
      moneyColumn('sgst', 'SGST', true),
      moneyColumn('igst', 'IGST', true),
    ],
    rows,
    totals,
    highlights: [
      { label: 'Taxable value', value: formatINR(totals.taxable) },
      { label: 'Total tax on outward supplies', value: formatINR(totalTax) },
    ],
  }

  if (inPeriod.length > 0 && relevantLines.length === 0) {
    result.warnings = [
      `${inPeriod.length} sales invoice(s) fall in the period but have no lines, so no rate-wise split could be produced.`,
    ]
  }

  return result
}

/* ==========================================================================
 * GSTR-3B — summary return
 * ========================================================================== */

/**
 * A GSTR-3B-style summary: outward tax, eligible input tax credit and the net
 * payable, all computed through `summariseGst` so the arithmetic matches the
 * engine's settlement posting exactly.
 */
export async function gstr3b(opts: { from: string; to: string }): Promise<ReportResult> {
  const invoices = await db.invoices.toArray()
  const inPeriod = invoices.filter((invoice) => inRange(invoice.date, opts.from, opts.to))

  const output = inPeriod.filter((invoice) => invoice.type === 'SALES')
  const input = inPeriod.filter((invoice) => invoice.type === 'PURCHASE')

  const outputCgst = sum(output, (invoice) => invoice.cgst)
  const outputSgst = sum(output, (invoice) => invoice.sgst)
  const outputIgst = sum(output, (invoice) => invoice.igst)
  const inputCgst = sum(input, (invoice) => invoice.cgst)
  const inputSgst = sum(input, (invoice) => invoice.sgst)
  const inputIgst = sum(input, (invoice) => invoice.igst)

  const summary = summariseGst({
    outputCgst,
    outputSgst,
    outputIgst,
    inputCgst,
    inputSgst,
    inputIgst,
  })

  const outputTaxable = sum(output, (invoice) => invoice.taxable)

  const netCgst = outputCgst - inputCgst
  const netSgst = outputSgst - inputSgst
  const netIgst = outputIgst - inputIgst

  const rows: ReportRow[] = [
    { id: 'section-31', particulars: '3.1 Outward supplies', emphasis: 'heading' },
    {
      id: 'outward',
      level: 1,
      particulars: 'Outward taxable supplies',
      taxable: outputTaxable,
      cgst: outputCgst,
      sgst: outputSgst,
      igst: outputIgst,
    },
    { id: 'section-4', particulars: '4. Input tax credit', emphasis: 'heading' },
    {
      id: 'itc',
      level: 1,
      particulars: 'Eligible input tax credit (ITC)',
      taxable: sum(input, (invoice) => invoice.taxable),
      cgst: inputCgst,
      sgst: inputSgst,
      igst: inputIgst,
    },
    { id: 'section-5', particulars: '5. Net tax payable', emphasis: 'heading' },
    {
      id: 'net',
      level: 1,
      particulars: 'Net tax payable / (credit carried forward)',
      taxable: 0,
      cgst: netCgst,
      sgst: netSgst,
      igst: netIgst,
      emphasis: 'total',
    },
  ]

  if (summary.netPayable < 0) {
    rows.push({
      id: 'net-note',
      level: 1,
      particulars: 'Input credit carried forward to the next period',
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      muted: true,
    })
  }

  return {
    title: 'GSTR-3B Summary',
    subtitle: `${opts.from} to ${opts.to}`,
    columns: [
      textColumn('particulars', 'Particulars'),
      moneyColumn('taxable', 'Taxable Value'),
      moneyColumn('cgst', 'CGST'),
      moneyColumn('sgst', 'SGST'),
      moneyColumn('igst', 'IGST'),
    ],
    rows,
    totals: {
      output: summary.outputTotal,
      input: summary.inputTotal,
      netPayable: summary.netPayable,
    },
    highlights: [
      { label: 'Taxable turnover (outward)', value: formatINR(outputTaxable) },
      { label: 'Output tax', value: formatINR(summary.outputTotal) },
      { label: 'Input tax credit', value: formatINR(summary.inputTotal) },
      {
        label: 'Net GST payable',
        value: formatINR(summary.netPayable),
        tone: summary.netPayable >= 0 ? 'positive' : 'negative',
      },
    ],
    notes: [
      'Outward tax is drawn from sales invoices; input tax credit from purchase invoices. Both are recomputed from the invoice table, not from stored balances.',
    ],
  }
}

function sum(invoices: Invoice[], pick: (invoice: Invoice) => Paise): Paise {
  let total = 0
  for (const invoice of invoices) total += pick(invoice)
  return total
}
