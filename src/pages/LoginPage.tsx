import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { DEFAULT_PASSWORD } from '@/services/auth'
import { login, ROLE_LABELS } from '@/services/admin'
import { useSession } from '@/store/session'
import { Alert, Button, Field, Input } from '@/components/ui'

/** The seeded user accounts, shown as one-click shortcuts on the sign-in page. */
const SEEDED_USERS = ['admin', 'accountant', 'purchase', 'sales', 'manager', 'auditor']

export function LoginPage() {
  const navigate = useNavigate()
  const signIn = useSession((state) => state.signIn)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const company = useLiveQuery(() => db.company.get('company'), [])
  const users = useLiveQuery(() => db.users.toArray(), [])

  useEffect(() => {
    if (company?.name) document.title = `${company.shortName} — Sign in`
  }, [company])

  const attemptSignIn = async (user: string, pass: string) => {
    setBusy(true)
    setError(null)
    try {
      const signedIn = await login(user, pass)
      signIn({
        id: signedIn.id,
        username: signedIn.username,
        name: signedIn.name,
        role: signedIn.role,
      })
      navigate('/', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    void attemptSignIn(username, password)
  }

  /** One click: fill the fields and sign straight in. */
  const quickSignIn = (name: string) => {
    setUsername(name)
    setPassword(DEFAULT_PASSWORD)
    void attemptSignIn(name, DEFAULT_PASSWORD)
  }

  const roleOf = (name: string) => {
    const user = users?.find((candidate) => candidate.username === name)
    return user ? ROLE_LABELS[user.role] : ''
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-brand-700">{company?.name ?? 'Sai Electronics & Appliances Pvt. Ltd.'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Accounting &amp; ERP — {company?.city ?? 'Pune'}, {company?.state ?? 'Maharashtra'}
          </p>
        </div>

        <form className="card card-pad space-y-4" onSubmit={submit}>
          <Field label="Username" required>
            <Input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <Button variant="primary" className="w-full" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="card card-pad">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quick sign-in — one click · shared password{' '}
            <span className="font-mono">{DEFAULT_PASSWORD}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SEEDED_USERS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
                onClick={() => quickSignIn(name)}
              >
                <span className="block font-medium text-slate-800">{name}</span>
                <span className="block text-xs text-slate-500">{roleOf(name) || 'user'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
