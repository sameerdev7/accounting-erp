import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type AuditLogEntry } from '@/db/schema'
import { useAsync } from '@/hooks/async'
import { Badge, Card, Field, Input, PageHeader, Select } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { queryAuditLog } from '@/services/audit'
import { currentFinancialYear } from '@/lib/dates'
import { formatDateTime, todayISO } from '@/lib/format'

/** The audit trail is read-only by design: rows are written by the services. */
const DISPLAY_LIMIT = 200

export function AuditLogPage() {
  const users = useLiveQuery(() => db.users.toArray(), [])
  const fy = currentFinancialYear()

  const [from, setFrom] = useState(fy.start)
  const [to, setTo] = useState(todayISO())
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [search, setSearch] = useState('')

  const log = useAsync(
    () =>
      queryAuditLog({
        from: from || undefined,
        to: to || undefined,
        userId: userId || undefined,
        action: action.trim() || undefined,
        entity: entity.trim() || undefined,
        search: search.trim() || undefined,
      }),
    [from, to, userId, action, entity, search],
  )

  const rows = useMemo(() => (log.data ? [...log.data] : []), [log.data])
  const shown = rows.slice(0, DISPLAY_LIMIT)

  const userById = useMemo(
    () => new Map((users ?? []).map((user) => [user.id, user.username])),
    [users],
  )

  const columns: Array<Column<AuditLogEntry>> = [
    {
      key: 'ts',
      label: 'Timestamp',
      width: '160px',
      render: (row) => formatDateTime(row.ts),
    },
    {
      key: 'username',
      label: 'User',
      width: '140px',
      render: (row) => userById.get(row.userId) ?? row.username,
    },
    {
      key: 'action',
      label: 'Action',
      width: '140px',
      render: (row) => <Badge tone="blue">{row.action.replace(/_/g, ' ')}</Badge>,
    },
    { key: 'entity', label: 'Entity', width: '140px' },
    { key: 'summary', label: 'Summary' },
  ]

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={`Append-only activity trail · showing ${shown.length} of ${rows.length} entries`}
      />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="User">
            <Select
              className="w-44"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">All users</option>
              {(users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action">
            <Input
              className="w-36"
              value={action}
              placeholder="e.g. POST"
              onChange={(event) => setAction(event.target.value)}
            />
          </Field>
          <Field label="Entity">
            <Input
              className="w-36"
              value={entity}
              placeholder="e.g. vouchers"
              onChange={(event) => setEntity(event.target.value)}
            />
          </Field>
          <Field label="Search">
            <Input
              className="w-56"
              value={search}
              placeholder="Summary, number…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>
        <DataTable
          columns={columns}
          rows={shown}
          getRowId={(row) => row.id}
          loading={log.loading}
          empty="No audit entries match the filter."
        />
      </Card>

      {rows.length > DISPLAY_LIMIT && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the {DISPLAY_LIMIT} most recent of {rows.length} matching entries. Narrow the
          filters to see older activity.
        </p>
      )}
    </>
  )
}
