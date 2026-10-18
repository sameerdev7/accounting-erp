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
import { MoneyInput } from '@/components/pickers'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { saveItem, type ItemInput } from '@/services/masters'
import { db, type Item } from '@/db/schema'
import { GST_RATES } from '@/db/coa'

function blankItem(): ItemInput {
  return {
    sku: '',
    name: '',
    category: '',
    hsn: '',
    kind: 'GOODS',
    gstRate: 18,
    uom: 'NOS',
    purchasePrice: 0,
    salePrice: 0,
    reorderLevel: 0,
    active: true,
  }
}

export function ItemsPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canEdit = can('masters.manage')
  const items = useLiveQuery(() => db.items.toArray(), [])
  const task = useTask()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ItemInput>(blankItem)

  const categories = useMemo(
    () =>
      Array.from(new Set((items ?? []).map((item) => item.category).filter(Boolean))).sort(),
    [items],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (items ?? [])
      .slice()
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .filter((item) => {
        if (categoryFilter && item.category !== categoryFilter) return false
        if (!term) return true
        return (
          item.sku.toLowerCase().includes(term) ||
          item.name.toLowerCase().includes(term) ||
          item.hsn.toLowerCase().includes(term)
        )
      })
  }, [items, search, categoryFilter])

  function openNew() {
    task.reset()
    setEditingId(null)
    setForm(blankItem())
    setOpen(true)
  }

  function openEdit(item: Item) {
    task.reset()
    setEditingId(item.id)
    setForm({
      sku: item.sku,
      name: item.name,
      category: item.category,
      hsn: item.hsn,
      kind: item.kind ?? 'GOODS',
      gstRate: item.gstRate,
      uom: item.uom,
      purchasePrice: item.purchasePrice,
      salePrice: item.salePrice,
      reorderLevel: item.reorderLevel,
      active: item.active,
    })
    setOpen(true)
  }

  const set = <K extends keyof ItemInput>(key: K, value: ItemInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function submit() {
    await task.run(async () => {
      await saveItem(actor(), { ...form, id: editingId ?? undefined })
      setOpen(false)
    })
  }

  const columns: Array<Column<Item>> = [
    { key: 'sku', label: 'SKU', width: '120px' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    {
      key: 'kind',
      label: 'Kind',
      render: (row) =>
        row.kind === 'SERVICE' ? <Badge tone="blue">Service</Badge> : <Badge tone="slate">Goods</Badge>,
    },
    { key: 'hsn', label: 'HSN' },
    { key: 'gstRate', label: 'GST', align: 'right', render: (row) => `${row.gstRate}%` },
    { key: 'uom', label: 'UOM' },
    { key: 'purchasePrice', label: 'Purchase', align: 'right', money: true },
    { key: 'salePrice', label: 'Sale', align: 'right', money: true },
    { key: 'reorderLevel', label: 'Reorder', align: 'right' },
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
        title="Items"
        subtitle={`${items?.length ?? 0} items in the catalogue`}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={openNew}>
              New item
            </Button>
          ) : undefined
        }
      />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Input
            className="w-56"
            placeholder="Search SKU, name or HSN"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            className="w-48"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={items === undefined}
          empty="No items match the filter."
          onRowClick={canEdit ? openEdit : undefined}
        />
      </Card>

      <Modal
        open={open}
        title={editingId ? 'Edit item' : 'New item'}
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
            <Field label="SKU" required>
              <Input value={form.sku} onChange={(event) => set('sku', event.target.value)} />
            </Field>
            <Field label="Name" required>
              <Input value={form.name} onChange={(event) => set('name', event.target.value)} />
            </Field>
            <Field label="Kind" hint="Services skip stock and post to Service Income">
              <Select
                value={form.kind ?? 'GOODS'}
                onChange={(event) => set('kind', event.target.value as ItemInput['kind'])}
              >
                <option value="GOODS">Goods (stocked)</option>
                <option value="SERVICE">Service (not stocked)</option>
              </Select>
            </Field>
            <Field label="Category">
              <Input
                value={form.category}
                onChange={(event) => set('category', event.target.value)}
              />
            </Field>
            <Field label="HSN">
              <Input value={form.hsn} onChange={(event) => set('hsn', event.target.value)} />
            </Field>
            <Field label="GST rate">
              <Select
                value={String(form.gstRate)}
                onChange={(event) => set('gstRate', Number(event.target.value))}
              >
                {GST_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit of measure">
              <Input value={form.uom} onChange={(event) => set('uom', event.target.value)} />
            </Field>
            <Field label="Purchase price">
              <MoneyInput
                value={form.purchasePrice}
                onChange={(paise) => set('purchasePrice', paise)}
              />
            </Field>
            <Field label="Sale price">
              <MoneyInput value={form.salePrice} onChange={(paise) => set('salePrice', paise)} />
            </Field>
            <Field label="Reorder level">
              <Input
                type="number"
                value={form.reorderLevel}
                onChange={(event) => set('reorderLevel', Number(event.target.value))}
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
