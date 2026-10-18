import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui'
import { DateInput } from '@/components/pickers'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { getCompanyMaster, saveCompany } from '@/services/masters'
import { STATE_NAMES, stateCodeFor } from '@/db/coa'
import type { Company } from '@/db/schema'
import { formatDate } from '@/lib/format'

/** Everything the service allows us to edit — the FY start and prefixes are fixed. */
type CompanyEditable = Omit<
  Company,
  'id' | 'createdAt' | 'createdBy' | 'financialYearStartMonth' | 'prefixes'
>

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function CompanyPage() {
  const { data, loading, error } = useAsync(() => getCompanyMaster(), [])

  return (
    <>
      <PageHeader
        title="Company"
        subtitle="Legal entity, GST registration and books configuration"
      />

      {loading && <Spinner label="Reading the company master…" />}
      {!loading && error && <Alert tone="error">{error}</Alert>}
      {!loading && !error && !data && (
        <Alert tone="warning">The company record has not been created yet.</Alert>
      )}
      {!loading && data && <CompanyForm company={data} />}
    </>
  )
}

function CompanyForm({ company }: { company: Company }) {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canEdit = can('masters.manage')
  const task = useTask()

  const [form, setForm] = useState<CompanyEditable>({
    name: company.name,
    shortName: company.shortName,
    gstin: company.gstin,
    pan: company.pan,
    state: company.state,
    stateCode: company.stateCode,
    address: company.address,
    city: company.city,
    pincode: company.pincode,
    phone: company.phone,
    email: company.email,
    booksBeginDate: company.booksBeginDate,
    bankAccountName: company.bankAccountName,
    bankAccountNumber: company.bankAccountNumber,
    bankIfsc: company.bankIfsc,
    natureOfBusiness: company.natureOfBusiness ?? '',
    productsAndServices: company.productsAndServices ?? [],
    departments: company.departments ?? [],
    majorTransactions: company.majorTransactions ?? [],
  })

  const set = <K extends keyof CompanyEditable>(key: K, value: CompanyEditable[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  /** Textarea helpers for the list-valued profile fields (one entry per line). */
  const toLines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

  async function submit() {
    await task.run(async () => {
      await saveCompany(actor(), form)
      task.setNotice('Company master saved.')
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card title="Identity">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Registered name" required className="sm:col-span-2">
              <Input
                value={form.name}
                disabled={!canEdit}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field label="Short name">
              <Input
                value={form.shortName}
                disabled={!canEdit}
                onChange={(event) => set('shortName', event.target.value)}
              />
            </Field>
            <Field label="PAN">
              <Input
                value={form.pan}
                disabled={!canEdit}
                onChange={(event) => set('pan', event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="GSTIN" hint="15-character GST identification number" className="sm:col-span-2">
              <Input
                value={form.gstin}
                disabled={!canEdit}
                onChange={(event) => set('gstin', event.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </Card>

        <Card title="Address & contact">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Address" className="sm:col-span-2">
              <Textarea
                value={form.address}
                disabled={!canEdit}
                onChange={(event) => set('address', event.target.value)}
              />
            </Field>
            <Field label="State">
              <Select
                value={form.state}
                disabled={!canEdit}
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
            <Field label="City">
              <Input
                value={form.city}
                disabled={!canEdit}
                onChange={(event) => set('city', event.target.value)}
              />
            </Field>
            <Field label="PIN code">
              <Input
                value={form.pincode}
                disabled={!canEdit}
                onChange={(event) => set('pincode', event.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                disabled={!canEdit}
                onChange={(event) => set('phone', event.target.value)}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                disabled={!canEdit}
                onChange={(event) => set('email', event.target.value)}
              />
            </Field>
            <Field label="Books begin from">
              <DateInput
                value={form.booksBeginDate}
                onChange={(value) => set('booksBeginDate', value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Business profile">
          <div className="space-y-3">
            <Field label="Nature of business">
              <Textarea
                value={form.natureOfBusiness ?? ''}
                disabled={!canEdit}
                onChange={(event) => set('natureOfBusiness', event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Products & services" hint="One per line">
                <Textarea
                  rows={7}
                  value={(form.productsAndServices ?? []).join('\n')}
                  disabled={!canEdit}
                  onChange={(event) => set('productsAndServices', toLines(event.target.value))}
                />
              </Field>
              <Field label="Departments" hint="One per line">
                <Textarea
                  rows={7}
                  value={(form.departments ?? []).join('\n')}
                  disabled={!canEdit}
                  onChange={(event) => set('departments', toLines(event.target.value))}
                />
              </Field>
            </div>
            <Field label="Major transactions" hint="One per line">
              <Textarea
                rows={5}
                value={(form.majorTransactions ?? []).join('\n')}
                disabled={!canEdit}
                onChange={(event) => set('majorTransactions', toLines(event.target.value))}
              />
            </Field>
          </div>
        </Card>

        <Card title="Bank details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Account name">
              <Input
                value={form.bankAccountName}
                disabled={!canEdit}
                onChange={(event) => set('bankAccountName', event.target.value)}
              />
            </Field>
            <Field label="Account number">
              <Input
                value={form.bankAccountNumber}
                disabled={!canEdit}
                onChange={(event) => set('bankAccountNumber', event.target.value)}
              />
            </Field>
            <Field label="IFSC">
              <Input
                value={form.bankIfsc}
                disabled={!canEdit}
                onChange={(event) => set('bankIfsc', event.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </Card>

        {task.error && <Alert tone="error">{task.error}</Alert>}
        {task.notice && <Alert tone="success">{task.notice}</Alert>}

        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} disabled={!canEdit || task.running}>
            {task.running ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      <Card title="Books settings (read-only)">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Financial year starts
            </dt>
            <dd className="mt-0.5 text-slate-800">
              {MONTH_NAMES[(company.financialYearStartMonth || 1) - 1]} ({company.financialYearStartMonth})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Books begin date</dt>
            <dd className="mt-0.5 text-slate-800">{formatDate(company.booksBeginDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Document prefixes
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {Object.entries(company.prefixes).map(([key, value]) => (
                <Badge key={key} tone="slate">
                  {key}: {value}
                </Badge>
              ))}
              {Object.keys(company.prefixes).length === 0 && (
                <span className="text-slate-400">—</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  )
}
