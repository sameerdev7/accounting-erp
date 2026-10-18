import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { seedDatabase } from '@/db/seed'
import { useSession } from '@/store/session'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { VouchersPage } from '@/pages/VouchersPage'
import { JournalsPage } from '@/pages/JournalsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { GstPage } from '@/pages/GstPage'
import { PayrollPage } from '@/pages/PayrollPage'
import { AssetsPage } from '@/pages/AssetsPage'
import { BackupPage } from '@/pages/admin/BackupPage'

/**
 * A smoke test, not a full UI test: each page is server-rendered inside a router
 * so that import-time and render-time faults (a bad hook order, a missing
 * provider, a component that assumes data before it arrives) surface here rather
 * than in the browser. Effects do not run during SSR, so pages render their
 * loading states — which is exactly the state a user sees first.
 */

function render(element: React.ReactNode): string {
  return renderToString(<StrictMode><MemoryRouter>{element}</MemoryRouter></StrictMode>)
}

const PAGES: Array<[string, React.ComponentType]> = [
  ['Dashboard', DashboardPage],
  ['Accounts', AccountsPage],
  ['Customers', CustomersPage],
  ['Vouchers', VouchersPage],
  ['Journals', JournalsPage],
  ['Inventory', InventoryPage],
  ['GST', GstPage],
  ['Payroll', PayrollPage],
  ['Assets', AssetsPage],
  ['Backup', BackupPage],
]

beforeAll(async () => {
  // react-router's <Link> uses useLayoutEffect, which React warns about during
  // server rendering. That is expected here (there is no hydration), so the
  // warning is silenced to keep the test output readable.
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('useLayoutEffect does nothing on the server')
    ) {
      return
    }
    originalError(...args)
  })

  await seedDatabase({ reset: true })
  // A signed-in session, so pages that read the actor or permissions render.
  useSession.getState().signIn({ id: 'u-admin', username: 'admin', name: 'Admin', role: 'ADMIN' })
}, 600_000)

describe('screens render without throwing', () => {
  it('renders the login screen', () => {
    useSession.getState().signOut()
    const html = render(<LoginPage />)
    expect(html).toContain('Sign in')
    useSession
      .getState()
      .signIn({ id: 'u-admin', username: 'admin', name: 'Admin', role: 'ADMIN' })
  })

  for (const [name, Page] of PAGES) {
    it(`renders ${name}`, () => {
      const html = render(<Page />)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})
