import { useState, type MouseEvent } from 'react'
import { db, type LedgerEntry, type Voucher } from '@/db/schema'
import { useAsync } from '@/hooks/async'
import { AccountSelect, useAccountMap, useMasters } from '@/components/pickers'
import { Alert, Card, Field, Modal, PageHeader } from '@/components/ui'
import { ReportView } from '@/components/ReportView'
import { VoucherPrint } from '@/components/VoucherPrint'
import { ledgerReport, type ReportResult } from '@/reports'
import { entriesForVoucher } from '@/services/ledger'
import { currentFinancialYear } from '@/lib/dates'
import { todayISO } from '@/lib/format'

/**
 * The general-ledger statement for a single account. The report itself comes
 * from `ledgerReport`; clicking a movement drills through to the voucher that
 * produced it, rendered with the printable voucher component.
 */
export function LedgerPage() {
  const masters = useMasters()
  const accountsById = useAccountMap()
  const fy = currentFinancialYear()

  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState(fy.start)
  const [to, setTo] = useState(todayISO())

  const report = useAsync<ReportResult | null>(
    () => (accountId ? ledgerReport({ accountId, from, to }) : Promise.resolve(null)),
    [accountId, from, to],
  )
  const company = useAsync(() => db.company.get('company'), [])

  const [selected, setSelected] = useState<{ voucher: Voucher; entries: LedgerEntry[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openEntry = async (entryId: string) => {
    setError(null)
    try {
      const entry = await db.ledgerEntries.get(entryId)
      if (!entry) return
      const voucher = await db.vouchers.get(entry.voucherId)
      if (!voucher) return
      const entries = await entriesForVoucher(voucher.id)
      setSelected({ voucher, entries })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  // `ReportView` renders the report generically; a click on one of its movement
  // rows is turned back into the ledger entry so the voucher can be opened.
  const handleReportClick = (event: MouseEvent<HTMLDivElement>) => {
    const tr = (event.target as HTMLElement).closest('tr')
    if (!tr) return
    const tbody = tr.parentElement
    if (!tbody || tbody.tagName !== 'TBODY') return
    const index = Array.from(tbody.children).indexOf(tr)
    const row = report.data?.rows[index]
    if (!row || typeof row.id !== 'string') return
    if (row.id === 'opening' || row.id === 'closing') return
    void openEntry(row.id)
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Account" className="min-w-[18rem]">
        <AccountSelect
          value={accountId}
          onChange={setAccountId}
          accounts={masters.accounts.filter((account) => !account.isControl)}
        />
      </Field>
      <Field label="From">
        <input
          type="date"
          className="input"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          className="input"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </Field>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Ledger"
        subtitle="Account statement with opening and closing balances. Click a movement to open its voucher."
      />

      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {!accountId ? (
        <Card>{controls}</Card>
      ) : (
        <div onClick={handleReportClick}>
          <ReportView
            report={report.data}
            loading={report.loading}
            actions={controls}
            empty="Choose an account to run the ledger."
          />
        </div>
      )}

      <Modal
        open={selected !== null}
        title={selected ? `Voucher ${selected.voucher.number}` : 'Voucher'}
        onClose={() => setSelected(null)}
        width="max-w-4xl"
      >
        {selected && (
          <VoucherPrint
            voucher={selected.voucher}
            entries={selected.entries}
            accountsById={accountsById}
            company={company.data}
          />
        )}
      </Modal>
    </>
  )
}
