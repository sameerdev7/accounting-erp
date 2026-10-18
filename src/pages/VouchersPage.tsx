import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Voucher, type VoucherStatus, type VoucherType } from '@/db/schema'
import { useAsync } from '@/hooks/async'
import { Card, Field, PageHeader, Select, StatusBadge } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { useAccountMap, useMasters } from '@/components/pickers'
import { VoucherPrint } from '@/components/VoucherPrint'
import { VoucherActions } from '@/components/VoucherActions'
import { entriesForVoucher, VOUCHER_TYPE_LABELS } from '@/services/ledger'
import { formatDate } from '@/lib/format'
import { formatINR } from '@/lib/money'

const STATUSES: VoucherStatus[] = ['DRAFT', 'PENDING', 'APPROVED', 'POSTED', 'REVERSED']
const TYPES = Object.keys(VOUCHER_TYPE_LABELS) as VoucherType[]

/**
 * The approval workspace. Every voucher in the system is listed here; a checker
 * opens one to read its entries and act on it through `VoucherActions`, which
 * routes back through the ledger service so the maker–checker rules still hold.
 */
export function VouchersPage() {
  const vouchers = useLiveQuery(() => db.vouchers.toArray(), [])
  const accountsById = useAccountMap()
  const masters = useMasters()
  const company = useAsync(() => db.company.get('company'), [])

  const [statusFilter, setStatusFilter] = useState<'ALL' | VoucherStatus>('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | VoucherType>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    return (vouchers ?? [])
      .filter((voucher) => statusFilter === 'ALL' || voucher.status === statusFilter)
      .filter((voucher) => typeFilter === 'ALL' || voucher.type === typeFilter)
      .sort((a, b) => (a.date === b.date ? b.number.localeCompare(a.number) : a.date < b.date ? 1 : -1))
  }, [vouchers, statusFilter, typeFilter])

  const selected = useMemo(
    () => (selectedId ? (vouchers ?? []).find((voucher) => voucher.id === selectedId) ?? null : null),
    [vouchers, selectedId],
  )

  const entries = useAsync(
    () => (selectedId ? entriesForVoucher(selectedId) : Promise.resolve([])),
    [selectedId],
  )

  const partyName = useMemo(() => {
    if (!selected?.partyId) return undefined
    const customer = masters.customers.find((row) => row.id === selected.partyId)
    if (customer) return customer.name
    const supplier = masters.suppliers.find((row) => row.id === selected.partyId)
    return supplier?.name
  }, [selected, masters.customers, masters.suppliers])

  const columns: Array<Column<Voucher>> = [
    { key: 'number', label: 'Number', width: '140px' },
    { key: 'date', label: 'Date', width: '120px', render: (row) => formatDate(row.date) },
    { key: 'type', label: 'Type', render: (row) => VOUCHER_TYPE_LABELS[row.type] },
    { key: 'narration', label: 'Narration' },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Vouchers"
        subtitle="Approval workspace — submit, approve, post and reverse vouchers"
      />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Field label="Status">
            <Select
              className="w-40"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'ALL' | VoucherStatus)}
            >
              <option value="ALL">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select
              className="w-44"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as 'ALL' | VoucherType)}
            >
              <option value="ALL">All types</option>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {VOUCHER_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={vouchers === undefined}
          empty="No vouchers match the filter."
          onRowClick={(row) => setSelectedId(row.id)}
        />
      </Card>

      {selected && (
        <div className="mt-4 space-y-4">
          <Card
            title={`${VOUCHER_TYPE_LABELS[selected.type]} ${selected.number}`}
            actions={
              <>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatINR(selected.amount)}
                </span>
                <StatusBadge status={selected.status} />
              </>
            }
          >
            <p className="text-sm text-slate-700">{selected.narration}</p>
            <p className="mt-1 text-xs text-slate-400">
              Dated {formatDate(selected.date)}
              {partyName ? ` · Party: ${partyName}` : ''}
            </p>
            <div className="mt-3">
              <VoucherActions voucher={selected} onChanged={entries.reload} />
            </div>
          </Card>

          <VoucherPrint
            voucher={selected}
            entries={entries.data ?? []}
            accountsById={accountsById}
            company={company.data}
            partyName={partyName}
          />
        </div>
      )}

    </>
  )
}
