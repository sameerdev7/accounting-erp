import { db, type InvoiceType } from '@/db/schema'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { formatINR, type Paise } from '@/lib/money'
import { moneyColumn, numberColumn, textColumn, type ReportResult, type ReportRow } from './types'

/** Ageing buckets, in the order they should be presented and sorted. */
const BUCKETS = ['Not yet due', '0–30', '31–60', '61–90', '90+'] as const
type Bucket = (typeof BUCKETS)[number]

/** Debtors outstanding (unpaid SALES invoices) with ageing, as on a date. */
export async function debtorsOutstanding(opts: { asOn: string }): Promise<ReportResult> {
  return outstandingReport('SALES', 'Debtors Outstanding', opts.asOn)
}

/** Creditors outstanding (unpaid PURCHASE invoices) with ageing, as on a date. */
export async function creditorsOutstanding(opts: { asOn: string }): Promise<ReportResult> {
  return outstandingReport('PURCHASE', 'Creditors Outstanding', opts.asOn)
}

interface OutstandingRow {
  id: string
  party: string
  number: string
  date: string
  dueDate: string
  total: Paise
  settled: Paise
  outstanding: Paise
  bucket: Bucket
  daysOverdue: number
}

async function outstandingReport(
  type: InvoiceType,
  title: string,
  asOn: string,
): Promise<ReportResult> {
  const [invoices, allocations, customers, suppliers] = await Promise.all([
    db.invoices.toArray(),
    db.allocations.toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
  ])

  const partyName = new Map<string, string>(
    type === 'SALES'
      ? customers.map((customer) => [customer.id, customer.name])
      : suppliers.map((supplier) => [supplier.id, supplier.name]),
  )

  // Sum everything settled against each invoice. The outstanding balance is the
  // invoice total less its allocations — recomputed here, never stored.
  const settledByInvoice = new Map<string, Paise>()
  for (const allocation of allocations) {
    settledByInvoice.set(
      allocation.invoiceId,
      (settledByInvoice.get(allocation.invoiceId) ?? 0) + allocation.amount,
    )
  }

  const data: OutstandingRow[] = []

  for (const invoice of invoices) {
    if (invoice.type !== type) continue
    if (invoice.date > asOn) continue

    const settled = settledByInvoice.get(invoice.id) ?? 0
    const outstanding = invoice.total - settled
    if (outstanding === 0) continue

    const daysOverdue = differenceInCalendarDays(parseISO(asOn), parseISO(invoice.dueDate))
    data.push({
      id: invoice.id,
      party: partyName.get(invoice.partyId) ?? invoice.partyId,
      number: invoice.number,
      date: invoice.date,
      dueDate: invoice.dueDate,
      total: invoice.total,
      settled,
      outstanding,
      bucket: bucketFor(daysOverdue),
      // Days overdue is clamped at zero so a not-yet-due invoice reads sensibly.
      daysOverdue: Math.max(0, daysOverdue),
    })
  }

  // Oldest money first: order by bucket, then by the largest exposure.
  data.sort((a, b) => {
    const bucketOrder = BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket)
    if (bucketOrder !== 0) return bucketOrder
    return b.outstanding - a.outstanding
  })

  const rows: ReportRow[] = data.map((row) => ({ ...row }))
  const totals = data.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      settled: acc.settled + row.settled,
      outstanding: acc.outstanding + row.outstanding,
    }),
    { total: 0, settled: 0, outstanding: 0 },
  )

  rows.push({
    id: 'total',
    party: 'Total',
    number: '',
    date: '',
    dueDate: '',
    total: totals.total,
    settled: totals.settled,
    outstanding: totals.outstanding,
    bucket: '',
    daysOverdue: 0,
    emphasis: 'total',
  })

  return {
    title,
    subtitle: `As on ${asOn}`,
    columns: [
      textColumn('party', 'Party'),
      textColumn('number', 'Invoice No'),
      textColumn('date', 'Invoice Date'),
      textColumn('dueDate', 'Due Date'),
      moneyColumn('total', 'Total', true),
      moneyColumn('settled', type === 'SALES' ? 'Received' : 'Paid', true),
      moneyColumn('outstanding', 'Outstanding', true),
      textColumn('bucket', 'Ageing Bucket'),
      numberColumn('daysOverdue', 'Days Overdue', 0),
    ],
    rows,
    totals,
    highlights: [{ label: 'Total outstanding', value: formatINR(totals.outstanding) }],
    notes: [
      'Outstanding = invoice total less the sum of allocations. Ageing is measured from the invoice due date to the report date.',
    ],
  }
}

function bucketFor(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return 'Not yet due'
  if (daysOverdue <= 30) return '0–30'
  if (daysOverdue <= 60) return '31–60'
  if (daysOverdue <= 90) return '61–90'
  return '90+'
}
