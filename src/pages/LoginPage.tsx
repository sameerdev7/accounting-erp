import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { DEFAULT_PASSWORD } from '@/services/auth'
import { login, ROLE_LABELS } from '@/services/admin'
import { useSession } from '@/store/session'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ThemeToggle } from '@/components/ThemeToggle'

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 p-4 dark:bg-slate-950">
      {/* Ambient brand glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/15" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl dark:bg-brand-600/20" />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-md space-y-4">
        <div className="text-center">
          <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden="true">
              <g fill="#fff">
                <rect x="14" y="34" width="8" height="16" rx="2" />
                <rect x="28" y="26" width="8" height="24" rx="2" />
                <rect x="42" y="16" width="8" height="34" rx="2" />
              </g>
            </svg>
          </span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {company?.name ?? 'Sai Electronics & Appliances Pvt. Ltd.'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Accounting &amp; ERP — {company?.city ?? 'Pune'}, {company?.state ?? 'Maharashtra'}
          </p>
        </div>

        <form className="card card-pad animate-fade-in space-y-4" onSubmit={submit}>
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

        <div className="card card-pad animate-fade-in">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Quick sign-in — one click · shared password{' '}
            <span className="font-mono">{DEFAULT_PASSWORD}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SEEDED_USERS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-brand-500 dark:hover:bg-brand-500/10"
                onClick={() => quickSignIn(name)}
              >
                <span className="block font-medium text-slate-800 dark:text-slate-100">{name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {roleOf(name) || 'user'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
