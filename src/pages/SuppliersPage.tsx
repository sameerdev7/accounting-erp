import { useState } from 'react'
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
  Textarea,
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { nextSupplierCode, saveSupplier, type SupplierInput } from '@/services/masters'
import { db, type Supplier } from '@/db/schema'
import { STATE_NAMES, stateCodeFor } from '@/db/coa'

function blankSupplier(): SupplierInput {
  return {
    code: '',
    name: '',
    gstin: '',
    state: '',
    stateCode: '',
    address: '',
    city: '',
    pincode: '',
    phone: '',
    email: '',
    paymentTermsDays: 30,
    active: true,
  }
}

export function SuppliersPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canEdit = can('masters.manage')
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [])
  const task = useTask()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierInput>(blankSupplier)

  const rows = (suppliers ?? []).slice().sort((a, b) => a.code.localeCompare(b.code))

  async function openNew() {
    task.reset()
    const code = await nextSupplierCode()
    setEditingId(null)
    setForm({ ...blankSupplier(), code })
    setOpen(true)
  }

  function openEdit(supplier: Supplier) {
    task.reset()
    setEditingId(supplier.id)
    setForm({
      code: supplier.code,
      name: supplier.name,
      gstin: supplier.gstin,
      state: supplier.state,
      stateCode: supplier.stateCode,
      address: supplier.address,
      city: supplier.city,
      pincode: supplier.pincode,
      phone: supplier.phone,
      email: supplier.email,
      paymentTermsDays: supplier.paymentTermsDays,
      active: supplier.active,
    })
    setOpen(true)
  }

  const set = <K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function submit() {
    await task.run(async () => {
      await saveSupplier(actor(), { ...form, id: editingId ?? undefined })
      setOpen(false)
    })
  }

  const columns: Array<Column<Supplier>> = [
    { key: 'code', label: 'Code', width: '90px' },
    { key: 'name', label: 'Name' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'state', label: 'State' },
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    { key: 'paymentTermsDays', label: 'Payment terms', align: 'right' },
    {
      key: 'active',
      label: 'Status',
      render: (row) =>
        row.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers?.length ?? 0} suppliers on file`}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={openNew}>
              New supplier
            </Button>
          ) : undefined
        }
      />

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={suppliers === undefined}
          empty="No suppliers yet."
          onRowClick={canEdit ? openEdit : undefined}
        />
      </Card>

      <Modal
        open={open}
        title={editingId ? 'Edit supplier' : 'New supplier'}
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
            <Field label="GSTIN" className="sm:col-span-2">
              <Input
                value={form.gstin}
                onChange={(event) => set('gstin', event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="State">
              <Select
                value={form.state}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    state: event.target.value,
                    stateCode: stateCodeFor(event.target.value),
                  }))
                }
              >
                <option value="">Select a state</option>
                {STATE_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="State code" hint="Auto-filled from the state">
              <Input value={form.stateCode} readOnly disabled />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea
                value={form.address}
                onChange={(event) => set('address', event.target.value)}
              />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(event) => set('city', event.target.value)} />
            </Field>
            <Field label="PIN code">
              <Input
                value={form.pincode}
                onChange={(event) => set('pincode', event.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(event) => set('phone', event.target.value)} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
            </Field>
            <Field label="Payment terms (days)">
              <Input
                type="number"
                value={form.paymentTermsDays}
                onChange={(event) => set('paymentTermsDays', Number(event.target.value))}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => set('active', event.target.checked)}
            />
            Active
          </label>
        </div>
      </Modal>
    </>
  )
}
