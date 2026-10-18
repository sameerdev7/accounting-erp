import { useEffect, useMemo, useState } from 'react'
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
} from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { DateInput, MoneyInput } from '@/components/pickers'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import {
  attendanceForMonth,
  nextEmployeeCode,
  saveAttendance,
  saveEmployee,
  type EmployeeInput,
} from '@/services/masters'
import { db, type Employee } from '@/db/schema'
import { daysInMonth, monthKey } from '@/lib/dates'
import { formatDate, todayISO } from '@/lib/format'
import { formatINR } from '@/lib/money'

function blankEmployee(): EmployeeInput {
  return {
    code: '',
    name: '',
    designation: '',
    department: '',
    dateOfJoining: todayISO(),
    basic: 0,
    hra: 0,
    allowances: 0,
    pfApplicable: true,
    ptApplicable: true,
    tdsMonthly: 0,
    active: true,
  }
}

export function EmployeesPage() {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const canEdit = can('masters.manage')
  const employees = useLiveQuery(() => db.employees.toArray(), [])
  const task = useTask()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EmployeeInput>(blankEmployee)

  const rows = useMemo(
    () => (employees ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    [employees],
  )

  async function openNew() {
    task.reset()
    const code = await nextEmployeeCode()
    setEditingId(null)
    setForm({ ...blankEmployee(), code })
    setOpen(true)
  }

  function openEdit(employee: Employee) {
    task.reset()
    setEditingId(employee.id)
    setForm({
      code: employee.code,
      name: employee.name,
      designation: employee.designation,
      department: employee.department,
      dateOfJoining: employee.dateOfJoining,
      basic: employee.basic,
      hra: employee.hra,
      allowances: employee.allowances,
      pfApplicable: employee.pfApplicable,
      ptApplicable: employee.ptApplicable,
      tdsMonthly: employee.tdsMonthly,
      active: employee.active,
    })
    setOpen(true)
  }

  const set = <K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function submit() {
    await task.run(async () => {
      await saveEmployee(actor(), { ...form, id: editingId ?? undefined })
      setOpen(false)
    })
  }

  /* ------------------------------------------------------------------ attendance */

  const [month, setMonth] = useState(() => monthKey(todayISO()))
  const [days, setDays] = useState<Record<string, number>>({})
  const attTask = useTask()
  const daysInSelectedMonth = daysInMonth(month)

  useEffect(() => {
    let cancelled = false
    attendanceForMonth(month).then((map) => {
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const employee of rows) next[employee.id] = map.get(employee.id) ?? daysInMonth(month)
      setDays(next)
    })
    return () => {
      cancelled = true
    }
  }, [month, rows])

  async function saveRow(employeeId: string) {
    await attTask.run(async () => {
      await saveAttendance(actor(), {
        employeeId,
        month,
        daysPresent: Number(days[employeeId]) || 0,
      })
      attTask.setNotice('Attendance saved.')
    })
  }

  const employeeColumns: Array<Column<Employee>> = [
    { key: 'code', label: 'Code', width: '90px' },
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    {
      key: 'dateOfJoining',
      label: 'Joined',
      render: (row) => formatDate(row.dateOfJoining),
    },
    {
      key: 'basic',
      label: 'Gross / month',
      align: 'right',
      render: (row) => formatINR(row.basic + row.hra + row.allowances),
    },
    {
      key: 'active',
      label: 'Status',
      render: (row) =>
        row.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>,
    },
  ]

  const attendanceColumns: Array<Column<Employee>> = [
    { key: 'code', label: 'Code', width: '90px' },
    { key: 'name', label: 'Name' },
    { key: 'department', label: 'Department' },
    {
      key: 'daysPresent',
      label: 'Days present',
      align: 'right',
      width: '220px',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Input
            type="number"
            min={0}
            max={daysInSelectedMonth}
            className="w-20"
            value={days[row.id] ?? 0}
            disabled={!canEdit}
            onChange={(event) =>
              setDays((prev) => ({ ...prev, [row.id]: Number(event.target.value) }))
            }
          />
          <span className="text-xs text-slate-400 dark:text-slate-500">/ {daysInSelectedMonth}</span>
          <Button
            variant="secondary"
            disabled={!canEdit || attTask.running}
            onClick={() => saveRow(row.id)}
          >
            Save
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={`${employees?.length ?? 0} employees on the payroll`}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={openNew}>
              New employee
            </Button>
          ) : undefined
        }
      />

      <Card bodyClassName="p-0">
        <DataTable
          columns={employeeColumns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={employees === undefined}
          empty="No employees yet."
          onRowClick={canEdit ? openEdit : undefined}
        />
      </Card>

      <div className="mt-4">
        <Card
          title="Attendance"
          actions={
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              Month
              <Input
                type="month"
                className="w-40"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
          }
        >
          <div className="space-y-3">
            {attTask.error && <Alert tone="error">{attTask.error}</Alert>}
            {attTask.notice && <Alert tone="success">{attTask.notice}</Alert>}
            <DataTable
              columns={attendanceColumns}
              rows={rows}
              getRowId={(row) => row.id}
              loading={employees === undefined}
              empty="No employees yet."
            />
          </div>
        </Card>
      </div>

      <Modal
        open={open}
        title={editingId ? 'Edit employee' : 'New employee'}
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
            <Field label="Designation">
              <Input
                value={form.designation}
                onChange={(event) => set('designation', event.target.value)}
              />
            </Field>
            <Field label="Department">
              <Input
                value={form.department}
                onChange={(event) => set('department', event.target.value)}
              />
            </Field>
            <Field label="Date of joining">
              <DateInput
                value={form.dateOfJoining}
                onChange={(value) => set('dateOfJoining', value)}
              />
            </Field>
            <Field label="Basic (monthly)">
              <MoneyInput value={form.basic} onChange={(paise) => set('basic', paise)} />
            </Field>
            <Field label="HRA (monthly)">
              <MoneyInput value={form.hra} onChange={(paise) => set('hra', paise)} />
            </Field>
            <Field label="Other allowances (monthly)">
              <MoneyInput value={form.allowances} onChange={(paise) => set('allowances', paise)} />
            </Field>
            <Field label="TDS (monthly)">
              <MoneyInput value={form.tdsMonthly} onChange={(paise) => set('tdsMonthly', paise)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.pfApplicable}
                onChange={(event) => set('pfApplicable', event.target.checked)}
              />
              PF applicable
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.ptApplicable}
                onChange={(event) => set('ptApplicable', event.target.checked)}
              />
              Professional tax applicable
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
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
