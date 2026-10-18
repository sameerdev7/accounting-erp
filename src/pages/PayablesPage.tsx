import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { creditorsOutstanding } from '@/reports/outstanding'
import { useAsync } from '@/hooks/async'
import { useMasters, DateInput } from '@/components/pickers'
import { DataTable, type Column } from '@/components/DataTable'
import { ReportView } from '@/components/ReportView'
import { Alert, Card, PageHeader } from '@/components/ui'
import { type Paise } from '@/lib/money'
import { formatDate, todayISO } from '@/lib/format'

interface OpenInvoiceRow {
  id: string
  party: string
  number: string
  dueDate: string
  outstanding: Paise
}

/**
 * Creditors outstanding: a live list of open supplier invoices above the
 * fully-featured ageing report.
 */
export function PayablesPage() {
  const [asOn, setAsOn] = useState(todayISO())
  const { data, loading, error } = useAsync(() => creditorsOutstanding({ asOn }), [asOn])
  const { suppliers } = useMasters()

  const supplierName = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  )

  const openRows = useLiveQuery(async () => {
    const [invoices, allocations] = await Promise.all([
      db.invoices.toArray(),
      db.allocations.toArray(),
    ])

    const settled = new Map<string, Paise>()
    for (const allocation of allocations) {
      settled.set(allocation.invoiceId, (settled.get(allocation.invoiceId) ?? 0) + allocation.amount)
    }

    return invoices
      .filter((invoice) => invoice.type === 'PURCHASE' && invoice.status === 'POSTED')
      .filter((invoice) => invoice.date <= asOn)
      .map((invoice) => ({
        id: invoice.id,
        party: supplierName.get(invoice.partyId) ?? invoice.partyId,
        number: invoice.number,
        dueDate: invoice.dueDate,
        outstanding: invoice.total - (settled.get(invoice.id) ?? 0),
      }))
      .filter((row) => row.outstanding !== 0)
      .sort((a, b) => (a.dueDate === b.dueDate ? 0 : a.dueDate < b.dueDate ? -1 : 1))
  }, [asOn, supplierName])

  const columns: Array<Column<OpenInvoiceRow>> = [
    { key: 'party', label: 'Supplier' },
    { key: 'number', label: 'Invoice No' },
    { key: 'dueDate', label: 'Due Date', render: (row) => formatDate(row.dueDate) },
    { key: 'outstanding', label: 'Outstanding', align: 'right', money: true, total: true },
  ]

  return (
    <>
      <PageHeader title="Payables" subtitle="What the business owes suppliers, by invoice and by ageing" />

      {error && <Alert tone="error">{error}</Alert>}

      <Card title="Open supplier invoices" bodyClassName="">
        <DataTable
          columns={columns}
          rows={openRows ?? []}
          getRowId={(row) => row.id}
          loading={openRows === undefined}
          empty="No outstanding supplier invoices."
          totalLabel="Total outstanding"
        />
      </Card>

      <div className="mt-4">
        <ReportView
          report={data}
          loading={loading}
          actions={
            <label className="text-xs text-slate-500">
              As on
              <DateInput className="mt-1" value={asOn} onChange={setAsOn} />
            </label>
          }
        />
      </div>
    </>
  )
}
