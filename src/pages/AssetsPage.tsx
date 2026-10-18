import { useMemo, useState } from 'react'
import type { DepreciationEntry, FixedAsset } from '@/db/schema'
import {
  accumulatedDepreciation,
  createAsset,
  depreciationHistory,
  depreciationPlan,
  disposeAsset,
  listAssets,
  monthlyDepreciation,
  nextAssetCode,
  runDepreciation,
  type AssetInput,
  type DepreciationPlanRow,
} from '@/services/assets'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { formatDate, formatMonthKey, todayISO } from '@/lib/format'
import { monthEndISO, monthKey } from '@/lib/dates'
import { formatINR, type Paise } from '@/lib/money'
import { DataTable, type Column } from '@/components/DataTable'
import { AccountSelect, DateInput, MoneyInput, useMasters } from '@/components/pickers'
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
} from '@/components/ui'

interface AssetForm {
  code: string
  name: string
  category: string
  cost: Paise
  purchaseDate: string
  usefulLifeYears: number
  method: 'SLM' | 'WDV'
  wdvRate: number
  salvageValue: Paise
  openingAccumulatedDep: Paise
  assetAccountId: string
  narration: string
}

function emptyForm(): AssetForm {
  return {
    code: '',
    name: '',
    category: '',
    cost: 0,
    purchaseDate: todayISO(),
    usefulLifeYears: 5,
    method: 'SLM',
    wdvRate: 0,
    salvageValue: 0,
    openingAccumulatedDep: 0,
    assetAccountId: '',
    narration: '',
  }
}

export function AssetsPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const { accounts, loading: mastersLoading } = useMasters()

  const assets = useAsync(() => listAssets(), [])
  const plan = useAsync(() => depreciationPlan(), [])

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const history = useAsync(
    () =>
      selectedAssetId ? depreciationHistory(selectedAssetId) : Promise.resolve<DepreciationEntry[]>([]),
    [selectedAssetId],
  )
  const accumulated = useAsync(
    () => (selectedAssetId ? accumulatedDepreciation(selectedAssetId) : Promise.resolve(0)),
    [selectedAssetId],
  )

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<AssetForm>(emptyForm)
  const createTask = useTask()

  const [depMonth, setDepMonth] = useState(() => monthKey(todayISO()))
  const depTask = useTask()

  const [disposing, setDisposing] = useState<FixedAsset | null>(null)
  const [disposeDate, setDisposeDate] = useState(() => todayISO())
  const [disposeProceeds, setDisposeProceeds] = useState(0)
  const disposeTask = useTask()

  const assetList = assets.data ?? []
  const selectedAsset = assetList.find((asset) => asset.id === selectedAssetId) ?? null
  const historyRows = useMemo(() => history.data ?? [], [history.data])
  const accumulatedValue = accumulated.data ?? 0

  const previewCharge = selectedAsset
    ? monthlyDepreciation(selectedAsset, accumulatedValue)
    : 0

  const assetColumns: Array<Column<FixedAsset>> = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'cost', label: 'Cost', align: 'right', money: true, total: true },
    {
      key: 'method',
      label: 'Method',
      render: (row) => `${row.method}${row.method === 'WDV' ? ` @ ${row.wdvRate}%` : ''}`,
    },
    {
      key: 'disposed',
      label: 'Status',
      render: (row) => <StatusBadge status={row.disposed ? 'DISPOSED' : 'ACTIVE'} />,
    },
  ]

  const planColumns: Array<Column<DepreciationPlanRow>> = [
    { key: 'asset', label: 'Asset', render: (row) => `${row.asset.code} — ${row.asset.name}` },
    { key: 'accumulatedBefore', label: 'Accumulated', align: 'right', money: true },
    { key: 'charge', label: 'This month', align: 'right', money: true, total: true },
  ]

  const historyColumns: Array<Column<DepreciationEntry>> = [
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'periodKey', label: 'Period', render: (row) => formatMonthKey(row.periodKey) },
    { key: 'amount', label: 'Amount', align: 'right', money: true, total: true },
  ]

  const openCreate = async () => {
    const code = await nextAssetCode()
    setForm({ ...emptyForm(), code })
    createTask.reset()
    setCreating(true)
  }

  const handleCreate = () =>
    createTask.run(async () => {
      const input: AssetInput = { ...form }
      await createAsset(actor(), input)
      createTask.setNotice(`Registered ${form.code} — ${form.name}`)
      setCreating(false)
      assets.reload()
      plan.reload()
    })

  const handleRunDepreciation = () =>
    depTask.run(async () => {
      const result = await runDepreciation(actor(), {
        periodKey: depMonth,
        date: monthEndISO(depMonth),
      })
      depTask.setNotice(
        `Posted ${formatINR(result.total)} across ${result.assetCount} asset(s) — voucher ${result.number}`,
      )
      assets.reload()
      plan.reload()
      if (selectedAssetId) {
        history.reload()
        accumulated.reload()
      }
    })

  const openDispose = (asset: FixedAsset) => {
    setDisposing(asset)
    setDisposeDate(todayISO())
    setDisposeProceeds(0)
    disposeTask.reset()
  }

  const handleDispose = () =>
    disposeTask.run(async () => {
      if (!disposing) return
      await disposeAsset(actor(), disposing.id, { date: disposeDate, proceeds: disposeProceeds })
      disposeTask.setNotice(`Disposed of ${disposing.name}`)
      setDisposing(null)
      assets.reload()
      plan.reload()
      if (selectedAssetId === disposing.id) {
        history.reload()
        accumulated.reload()
      }
    })

  return (
    <>
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register, depreciation schedule and disposals"
        actions={
          can('assets.manage') ? (
            <Button variant="primary" onClick={openCreate}>
              Register asset
            </Button>
          ) : null
        }
      />

      <Card title="Asset register">
        <DataTable
          columns={assetColumns}
          rows={assetList}
          getRowId={(row) => row.id}
          loading={assets.loading}
          empty="No fixed assets registered."
          onRowClick={(row) => setSelectedAssetId(row.id)}
          rowClassName={(row) => (row.id === selectedAssetId ? 'bg-brand-50 dark:bg-brand-500/10' : '')}
        />
        {assets.error && (
          <div className="mt-3">
            <Alert tone="error">{assets.error}</Alert>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Depreciation plan" className="mt-0">
          {plan.error && (
            <div className="mb-3">
              <Alert tone="error">{plan.error}</Alert>
            </div>
          )}
          <DataTable
            columns={planColumns}
            rows={plan.data ?? []}
            getRowId={(row) => row.asset.id}
            loading={plan.loading}
            empty="Nothing left to depreciate."
          />
        </Card>

        <Card
          title="Run depreciation"
          actions={
            can('assets.manage') ? (
              <Button
                variant="primary"
                disabled={depTask.running || !depMonth}
                onClick={handleRunDepreciation}
              >
                {depTask.running ? 'Posting…' : 'Run depreciation'}
              </Button>
            ) : null
          }
        >
          <Field label="Period" hint="One depreciation run per month">
            <Input
              type="month"
              value={depMonth}
              onChange={(event) => {
                if (event.target.value) setDepMonth(event.target.value)
              }}
            />
          </Field>
          {depTask.error && (
            <div className="mt-3">
              <Alert tone="error">{depTask.error}</Alert>
            </div>
          )}
          {depTask.notice && (
            <div className="mt-3">
              <Alert tone="success">{depTask.notice}</Alert>
            </div>
          )}
        </Card>
      </div>

      {selectedAsset && (
        <Card
          title={`${selectedAsset.code} — ${selectedAsset.name}`}
          className="mt-4"
          actions={
            can('assets.manage') && !selectedAsset.disposed ? (
              <Button variant="danger" onClick={() => openDispose(selectedAsset)}>
                Dispose
              </Button>
            ) : null
          }
        >
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Cost" value={formatINR(selectedAsset.cost)} />
            <StatCard label="Accumulated dep." value={formatINR(accumulatedValue)} />
            <StatCard
              label="Book value"
              value={formatINR(selectedAsset.cost - accumulatedValue)}
            />
            <StatCard
              label="Next monthly charge"
              value={formatINR(previewCharge)}
              hint={`${selectedAsset.method} · life ${selectedAsset.usefulLifeYears}y`}
            />
          </div>
          {selectedAsset.disposed && (
            <div className="mb-3">
              <Alert tone="warning">
                Disposed on {formatDate(selectedAsset.disposedDate ?? null)}
              </Alert>
            </div>
          )}
          <DataTable
            columns={historyColumns}
            rows={historyRows}
            getRowId={(row) => row.id}
            loading={history.loading}
            empty="No depreciation posted for this asset yet."
          />
        </Card>
      )}

      <Modal
        open={creating}
        title="Register fixed asset"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={createTask.running || mastersLoading}
              onClick={handleCreate}
            >
              {createTask.running ? 'Saving…' : 'Register'}
            </Button>
          </>
        }
      >
        {createTask.error && (
          <div className="mb-3">
            <Alert tone="error">{createTask.error}</Alert>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Code" required>
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          </Field>
          <Field label="Name" required>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Category">
            <Input
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            />
          </Field>
          <Field label="Cost" required>
            <MoneyInput value={form.cost} onChange={(cost) => setForm({ ...form, cost })} />
          </Field>
          <Field label="Purchase date" required>
            <DateInput
              value={form.purchaseDate}
              onChange={(purchaseDate) => setForm({ ...form, purchaseDate })}
            />
          </Field>
          <Field label="Useful life (years)">
            <Input
              type="number"
              min={1}
              value={form.usefulLifeYears}
              onChange={(event) =>
                setForm({ ...form, usefulLifeYears: Number(event.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Method">
            <Select
              value={form.method}
              onChange={(event) => setForm({ ...form, method: event.target.value as 'SLM' | 'WDV' })}
            >
              <option value="SLM">SLM — straight line</option>
              <option value="WDV">WDV — written down value</option>
            </Select>
          </Field>
          <Field label="WDV rate (%)" hint="Only used with the WDV method">
            <Input
              type="number"
              min={0}
              value={form.wdvRate}
              onChange={(event) => setForm({ ...form, wdvRate: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label="Salvage value">
            <MoneyInput
              value={form.salvageValue}
              onChange={(salvageValue) => setForm({ ...form, salvageValue })}
            />
          </Field>
          <Field label="Opening accumulated dep.">
            <MoneyInput
              value={form.openingAccumulatedDep}
              onChange={(openingAccumulatedDep) => setForm({ ...form, openingAccumulatedDep })}
            />
          </Field>
          <Field label="Asset account" required className="sm:col-span-2">
            <AccountSelect
              value={form.assetAccountId}
              onChange={(assetAccountId) => setForm({ ...form, assetAccountId })}
              accounts={accounts}
            />
          </Field>
          <Field label="Narration" className="sm:col-span-2">
            <Textarea
              value={form.narration}
              onChange={(event) => setForm({ ...form, narration: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={disposing !== null}
        title={`Dispose ${disposing?.name ?? ''}`}
        onClose={() => setDisposing(null)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setDisposing(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={disposeTask.running}
              onClick={handleDispose}
            >
              {disposeTask.running ? 'Posting…' : 'Post disposal'}
            </Button>
          </>
        }
      >
        {disposeTask.error && (
          <div className="mb-3">
            <Alert tone="error">{disposeTask.error}</Alert>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Disposal date" required>
            <DateInput value={disposeDate} onChange={setDisposeDate} />
          </Field>
          <Field label="Proceeds" required>
            <MoneyInput value={disposeProceeds} onChange={setDisposeProceeds} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
