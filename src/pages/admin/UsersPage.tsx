import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type User, type UserRole } from '@/db/schema'
import { useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
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
import { createUser, ROLE_LABELS, resetPassword, updateUser } from '@/services/admin'
import { ROLES, ROLE_DESCRIPTIONS } from '@/services/auth'
import { formatDateTime } from '@/lib/format'

interface UserForm {
  username: string
  name: string
  role: UserRole
  password: string
}

const EMPTY_FORM: UserForm = { username: '', name: '', role: 'ACCOUNTANT', password: '' }

/** User administration: create, edit, reset passwords and toggle access. */
export function UsersPage() {
  const actor = useSession((state) => state.actor)
  const users = useLiveQuery(() => db.users.toArray(), [])
  const task = useTask()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [resetting, setResetting] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const rows = [...(users ?? [])].sort((a, b) => a.username.localeCompare(b.username))

  function openNew() {
    task.reset()
    setEditingId(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(user: User) {
    task.reset()
    setEditingId(user.id)
    setForm({ username: user.username, name: user.name, role: user.role, password: '' })
    setOpen(true)
  }

  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  function submit() {
    void task.run(async () => {
      if (editingId) {
        await updateUser(actor(), editingId, { name: form.name, role: form.role })
      } else {
        await createUser(actor(), {
          username: form.username,
          name: form.name,
          role: form.role,
          password: form.password || undefined,
        })
      }
      setOpen(false)
    })
  }

  function toggleActive(user: User) {
    void task.run(async () => {
      await updateUser(actor(), user.id, { active: !user.active })
    })
  }

  function submitReset() {
    if (!resetting) return
    void task.run(async () => {
      await resetPassword(actor(), resetting.id, newPassword)
      setResetting(null)
      setNewPassword('')
    })
  }

  const columns: Array<Column<User>> = [
    { key: 'username', label: 'Username', width: '160px' },
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role', render: (row) => ROLE_LABELS[row.role] },
    {
      key: 'active',
      label: 'Status',
      align: 'center',
      render: (row) =>
        row.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>,
    },
    {
      key: 'lastLoginAt',
      label: 'Last sign-in',
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : '—'),
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button className="px-2 py-1 text-xs" onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => {
              task.reset()
              setResetting(row)
              setNewPassword('')
            }}
          >
            Reset password
          </Button>
          <Button
            className="px-2 py-1 text-xs"
            variant={row.active ? 'danger' : 'primary'}
            onClick={() => toggleActive(row)}
          >
            {row.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${rows.length} accounts · segregation of duties is enforced by role`}
        actions={
          <Button variant="primary" onClick={openNew}>
            New user
          </Button>
        }
      />

      {task.error && !open && !resetting && (
        <div className="mb-3">
          <Alert tone="error">{task.error}</Alert>
        </div>
      )}

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={users === undefined}
          empty="No users yet."
        />
      </Card>

      <Modal
        open={open}
        title={editingId ? 'Edit user' : 'New user'}
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
            <Field label="Username" required hint={editingId ? 'Usernames cannot be changed.' : undefined}>
              <Input
                value={form.username}
                disabled={editingId !== null}
                onChange={(event) => set('username', event.target.value)}
              />
            </Field>
            <Field label="Full name" required>
              <Input value={form.name} onChange={(event) => set('name', event.target.value)} />
            </Field>
            <Field label="Role" hint={ROLE_DESCRIPTIONS[form.role]}>
              <Select
                value={form.role}
                onChange={(event) => set('role', event.target.value as UserRole)}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
            {!editingId && (
              <Field label="Password" hint="Leave blank to use the default password.">
                <Input
                  type="text"
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                />
              </Field>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={resetting !== null}
        title={resetting ? `Reset password for ${resetting.username}` : 'Reset password'}
        onClose={() => setResetting(null)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={submitReset}
              disabled={task.running || !newPassword}
            >
              {task.running ? 'Resetting…' : 'Reset password'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          <p className="text-sm text-slate-600">
            The new password must be at least 6 characters and contain a letter and a digit.
          </p>
          <Field label="New password" required>
            <Input
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  )
}
