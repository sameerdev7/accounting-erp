import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { useAccountMap } from '@/components/pickers'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { saveAccount, type AccountInput } from '@/services/masters'
import { db, type Account, type AccountType, type NormalBalance } from '@/db/schema'
import { labelize } from '@/lib/format'

const ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']
const NORMAL_BALANCES: NormalBalance[] = ['DEBIT', 'CREDIT']

function blankAccount(): AccountInput {
  return {
    code: '',
    name: '',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    parentId: null,
    isControl: false,
    isBank: false,
    isCash: false,
    isContra: false,
    active: true,
    note: '',
  }
}

export function AccountsPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canEdit = can('masters.manage')
  const accounts = useLiveQuery(() => db.accounts.toArray(), [])
  const accountMap = useAccountMap()
  const task = useTask()

  const [typeFilter, setTypeFilter] = useState<'ALL' | AccountType>('ALL')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AccountInput>(blankAccount)

  const rows = useMemo(() => {
    const list = (accounts ?? []).slice().sort((a, b) => a.code.localeCompare(b.code))
    const term = search.trim().toLowerCase()
    return list.filter((account) => {
      if (typeFilter !== 'ALL' && account.type !== typeFilter) return false
      if (!term) return true
      return (
        account.code.toLowerCase().includes(term) || account.name.toLowerCase().includes(term)
      )
    })
  }, [accounts, typeFilter, search])

  const parentOptions = useMemo(
    () =>
      (accounts ?? [])
        .filter(
          (account) =>
            (account.isControl || account.parentId === null) && account.id !== editingId,
        )
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts, editingId],
  )

  function openNew() {
    task.reset()
    setEditingId(null)
    setForm(blankAccount())
    setOpen(true)
  }

  function openEdit(account: Account) {
    task.reset()
    setEditingId(account.id)
    setForm({
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      parentId: account.parentId,
      isControl: account.isControl,
      isBank: account.isBank,
      isCash: account.isCash,
      isContra: account.isContra,
      active: account.active,
      note: account.note ?? '',
    })
    setOpen(true)
  }

  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function submit() {
    await task.run(async () => {
      await saveAccount(actor(), { ...form, id: editingId ?? undefined })
      setOpen(false)
    })
  }

  const columns: Array<Column<Account>> = [
    { key: 'code', label: 'Code', width: '110px' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type', render: (row) => labelize(row.type) },
    { key: 'normalBalance', label: 'Normal balance', render: (row) => labelize(row.normalBalance) },
    {
      key: 'isControl',
      label: 'Control',
      align: 'center',
      render: (row) =>
        row.isControl ? <Badge tone="violet">Control</Badge> : <span className="text-slate-400">—</span>,
    },
    {
      key: 'active',
      label: 'Status',
      render: (row) =>
        row.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>,
    },
    {
      key: 'parentId',
      label: 'Parent',
      render: (row) => (row.parentId ? accountMap.get(row.parentId)?.name ?? '—' : '—'),
    },
  ]

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        subtitle={`${accounts?.length ?? 0} accounts in the ledger`}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={openNew}>
              New account
            </Button>
          ) : undefined
        }
      />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Input
            className="w-56"
            placeholder="Search code or name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            className="w-44"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as 'ALL' | AccountType)}
          >
            <option value="ALL">All types</option>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {labelize(type)}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={accounts === undefined}
          empty="No accounts match the filter."
          onRowClick={canEdit ? openEdit : undefined}
        />
      </Card>

      <Modal
        open={open}
        title={editingId ? 'Edit account' : 'New account'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={task.running}>
              {task.running ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code" required>
              <Input value={form.code} onChange={(event) => set('code', event.target.value)} />
            </Field>
            <Field label="Name" required>
              <Input value={form.name} onChange={(event) => set('name', event.target.value)} />
            </Field>
            <Field label="Type">
              <Select
                value={form.type}
                onChange={(event) => set('type', event.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {labelize(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Normal balance">
              <Select
                value={form.normalBalance}
                onChange={(event) => set('normalBalance', event.target.value as NormalBalance)}
              >
                {NORMAL_BALANCES.map((balance) => (
                  <option key={balance} value={balance}>
                    {labelize(balance)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Parent account"
              className="sm:col-span-2"
              hint="Only control accounts and top-level accounts can be parents."
            >
              <Select
                value={form.parentId ?? ''}
                onChange={(event) => set('parentId', event.target.value || null)}
              >
                <option value="">No parent</option>
                {parentOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note" className="sm:col-span-2">
              <Input value={form.note ?? ''} onChange={(event) => set('note', event.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isControl}
                onChange={(event) => set('isControl', event.target.checked)}
              />
              Control account
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isBank}
                onChange={(event) => set('isBank', event.target.checked)}
              />
              Bank
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isCash}
                onChange={(event) => set('isCash', event.target.checked)}
              />
              Cash
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isContra}
                onChange={(event) => set('isContra', event.target.checked)}
              />
              Contra
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => set('active', event.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
      </Modal>
    </>
  )
}
