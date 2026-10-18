import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { SESSION_TIMEOUT_MS } from '@/services/auth'
import { logout, ROLE_LABELS } from '@/services/admin'
import { backupReminderDays } from '@/services/backup'
import { useSession } from '@/store/session'
import { NAV } from './nav'
import { Alert } from './ui'
import { ThemeToggle } from './ThemeToggle'

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow ${className}`}
    >
      <svg viewBox="0 0 64 64" className="h-4 w-4" aria-hidden="true">
        <g fill="#fff">
          <rect x="14" y="34" width="8" height="16" rx="2" />
          <rect x="28" y="26" width="8" height="24" rx="2" />
          <rect x="42" y="16" width="8" height="34" rx="2" />
        </g>
      </svg>
    </span>
  )
}

function initials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function SidebarLink({ to, label, onNavigate }: { to: string; label: string; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
          isActive
            ? 'bg-gradient-to-r from-brand-500 to-brand-600 font-medium text-white shadow-sm'
            : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

export function Layout() {
  const user = useSession((state) => state.user)
  const can = useSession((state) => state.can)
  const signOut = useSession((state) => state.signOut)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const company = useLiveQuery(() => db.company.get('company'), [])
  const reminderDays = useLiveQuery(() => backupReminderDays(), [])

  const close = () => setOpen(false)

  // Idle timeout — section 11's "session timeout". Any interaction resets the
  // clock; after SESSION_TIMEOUT_MS of quiet, the session is closed.
  useEffect(() => {
    if (!user) return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'mousemove', 'scroll', 'touchstart']
    events.forEach((event) => window.addEventListener(event, bump, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - last >= SESSION_TIMEOUT_MS) {
        void logout(user)
        signOut()
        navigate('/login', { replace: true })
      }
    }, 30_000)
    return () => {
      events.forEach((event) => window.removeEventListener(event, bump))
      window.clearInterval(timer)
    }
  }, [user, signOut, navigate])

  const handleSignOut = () => {
    if (user) void logout(user)
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* Sidebar — a deep ink rail in both themes */}
      <aside
        className={`${
          open ? 'block' : 'hidden'
        } fixed inset-y-0 left-0 z-30 w-72 overflow-y-auto border-r border-white/5 bg-gradient-to-b from-slate-900 to-slate-950 p-4 lg:static lg:block dark:border-slate-800`}
      >
        <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3">
          <LogoMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{company?.shortName ?? 'Sai ERP'}</p>
            <p className="truncate text-xs text-slate-400">{company?.name ?? 'Accounting & ERP'}</p>
          </div>
        </div>

        <nav className="space-y-4 pb-16">
          {NAV.map((group) => {
            const items = group.items.filter((item) => item.permissions.some(can))
            if (items.length === 0) return null
            return (
              <div key={group.label}>
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarLink key={item.to} to={item.to} label={item.label} onNavigate={close} />
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-20 bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={close}
        />
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-ghost -ml-1 px-2 lg:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-label="Toggle navigation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="hidden min-w-0 text-sm text-slate-500 lg:block dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">{company?.name}</span>
              <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
              <span className="font-mono text-xs">GSTIN {company?.gstin}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                {initials(user?.name)}
              </span>
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{user?.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {user ? ROLE_LABELS[user.role] : ''}
                </p>
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        {reminderDays !== undefined && reminderDays > 0 && can('admin.backup') && (
          <div className="no-print px-4 pt-3">
            <Alert tone="warning">
              No data backup has been taken for {reminderDays} days.{' '}
              <a className="link" href="#/admin/backup" onClick={close}>
                Take one now
              </a>
              .
            </Alert>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>

        <footer className="no-print border-t border-slate-200 px-4 py-2 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
          All data is stored locally in this browser — export a backup regularly.
        </footer>
      </div>
    </div>
  )
}
