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

function SidebarLink({ to, label, onNavigate }: { to: string; label: string; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `block rounded-md px-3 py-1.5 text-sm ${
          isActive
            ? 'bg-brand-600 font-medium text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside
        className={`${
          open ? 'block' : 'hidden'
        } fixed inset-y-0 left-0 z-30 w-72 overflow-y-auto border-r border-slate-200 bg-white p-4 lg:static lg:block`}
      >
        <div className="mb-4 border-b border-slate-100 pb-3">
          <p className="text-sm font-bold text-brand-700">{company?.shortName ?? 'Sai ERP'}</p>
          <p className="text-xs text-slate-500">{company?.name ?? 'Accounting & ERP'}</p>
        </div>

        <nav className="space-y-4 pb-16">
          {NAV.map((group) => {
            const items = group.items.filter((item) => item.permissions.some(can))
            if (items.length === 0) return null
            return (
              <div key={group.label}>
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
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

      {open && <div className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" onClick={close} />}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            type="button"
            className="btn-ghost lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div className="hidden text-sm text-slate-500 lg:block">
            {company?.name} · GSTIN {company?.gstin}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-800">{user?.name}</p>
              <p className="text-xs text-slate-500">{user ? ROLE_LABELS[user.role] : ''}</p>
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

        <main className="min-w-0 flex-1 p-4">
          <Outlet />
        </main>

        <footer className="no-print border-t border-slate-200 px-4 py-2 text-center text-xs text-slate-400">
          All data is stored locally in this browser — export a backup regularly.
        </footer>
      </div>
    </div>
  )
}
