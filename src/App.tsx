import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Spinner } from '@/components/ui'
import { ensureSeeded } from '@/db/seed'
import { useAsync } from '@/hooks/async'
import type { Permission } from '@/services/auth'
import { useSession } from '@/store/session'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CompanyPage } from '@/pages/CompanyPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { CustomersPage } from '@/pages/CustomersPage'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { ItemsPage } from '@/pages/ItemsPage'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { ReceivablesPage } from '@/pages/ReceivablesPage'
import { PayablesPage } from '@/pages/PayablesPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { PayrollPage } from '@/pages/PayrollPage'
import { AssetsPage } from '@/pages/AssetsPage'
import { GstPage } from '@/pages/GstPage'
import { LedgerPage } from '@/pages/LedgerPage'
import { DayBookPage } from '@/pages/DayBookPage'
import { VouchersPage } from '@/pages/VouchersPage'
import { JournalsPage } from '@/pages/JournalsPage'
import { RequisitionsPage } from '@/pages/purchase/RequisitionsPage'
import { PurchaseOrdersPage } from '@/pages/purchase/PurchaseOrdersPage'
import { GrnPage } from '@/pages/purchase/GrnPage'
import { PurchaseInvoicesPage } from '@/pages/purchase/PurchaseInvoicesPage'
import { PurchaseReturnsPage } from '@/pages/purchase/PurchaseReturnsPage'
import { SalesOrdersPage } from '@/pages/sales/SalesOrdersPage'
import { DeliveriesPage } from '@/pages/sales/DeliveriesPage'
import { SalesInvoicesPage } from '@/pages/sales/SalesInvoicesPage'
import { SalesReturnsPage } from '@/pages/sales/SalesReturnsPage'
import { ReceiptsPage } from '@/pages/cash/ReceiptsPage'
import { PaymentsPage } from '@/pages/cash/PaymentsPage'
import { ContraPage } from '@/pages/cash/ContraPage'
import { ExpensesPage } from '@/pages/cash/ExpensesPage'
import { UsersPage } from '@/pages/admin/UsersPage'
import { PeriodLocksPage } from '@/pages/admin/PeriodLocksPage'
import { AuditLogPage } from '@/pages/admin/AuditLogPage'
import { BackupPage } from '@/pages/admin/BackupPage'
import {
  BalanceSheetPage,
  CashFlowPage,
  CreditorAgeingPage,
  DebtorAgeingPage,
  Gstr1Page,
  Gstr3bPage,
  ProfitLossPage,
  PurchaseRegisterPage,
  SalesRegisterPage,
  StockSummaryPage,
  TrialBalancePage,
} from '@/pages/reports'

/** One-time boot: the dataset is created the first time the app runs. */
function Bootstrap({ children }: { children: React.ReactNode }) {
  const { loading, error } = useAsync(() => ensureSeeded(), [])
  return loading ? (
    <div className="flex min-h-screen items-center justify-center">
      {error ? (
        <p className="text-sm text-red-600">Could not prepare the local database: {error}</p>
      ) : (
        <Spinner label="Preparing the books for the first time…" />
      )}
    </div>
  ) : (
    <>{children}</>
  )
}

function RequireAuth() {
  const user = useSession((state) => state.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Route guard mirroring the service-layer permission matrix. */
function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const can = useSession((state) => state.can)
  if (!can(permission)) {
    return (
      <div className="card card-pad">
        <h1 className="text-base font-semibold text-slate-800">Not permitted</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your role does not have access to this screen. Speak to the administrator if you believe this
          is a mistake.
        </p>
      </div>
    )
  }
  return <>{children}</>
}

function guard(permission: Permission, element: React.ReactNode) {
  return <RequirePermission permission={permission}>{element}</RequirePermission>
}

export default function App() {
  const user = useSession((state) => state.user)

  return (
    <Bootstrap>
      <HashRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={guard('reports.view', <DashboardPage />)} />

              <Route path="company" element={guard('masters.manage', <CompanyPage />)} />
              <Route path="accounts" element={guard('masters.manage', <AccountsPage />)} />
              <Route path="customers" element={guard('masters.manage', <CustomersPage />)} />
              <Route path="suppliers" element={guard('masters.manage', <SuppliersPage />)} />
              <Route path="items" element={guard('masters.manage', <ItemsPage />)} />
              <Route path="employees" element={guard('masters.manage', <EmployeesPage />)} />

              <Route path="purchase/requisitions" element={guard('purchase.create', <RequisitionsPage />)} />
              <Route path="purchase/orders" element={guard('purchase.create', <PurchaseOrdersPage />)} />
              <Route path="purchase/grn" element={guard('purchase.create', <GrnPage />)} />
              <Route path="purchase/invoices" element={guard('purchase.create', <PurchaseInvoicesPage />)} />
              <Route path="purchase/returns" element={guard('voucher.create', <PurchaseReturnsPage />)} />

              <Route path="sales/orders" element={guard('sales.create', <SalesOrdersPage />)} />
              <Route path="sales/deliveries" element={guard('sales.create', <DeliveriesPage />)} />
              <Route path="sales/invoices" element={guard('sales.create', <SalesInvoicesPage />)} />
              <Route path="sales/returns" element={guard('voucher.create', <SalesReturnsPage />)} />

              <Route path="cash/receipts" element={guard('receipt.create', <ReceiptsPage />)} />
              <Route path="cash/payments" element={guard('payment.create', <PaymentsPage />)} />
              <Route path="cash/contra" element={guard('voucher.create', <ContraPage />)} />
              <Route path="cash/expenses" element={guard('voucher.create', <ExpensesPage />)} />

              <Route path="ledger" element={guard('reports.view', <LedgerPage />)} />
              <Route path="daybook" element={guard('reports.view', <DayBookPage />)} />
              <Route path="vouchers" element={guard('voucher.approve', <VouchersPage />)} />
              <Route path="journals" element={guard('voucher.create', <JournalsPage />)} />

              <Route path="receivables" element={guard('reports.view', <ReceivablesPage />)} />
              <Route path="payables" element={guard('reports.view', <PayablesPage />)} />
              <Route path="inventory" element={guard('reports.view', <InventoryPage />)} />

              <Route path="payroll" element={guard('payroll.run', <PayrollPage />)} />
              <Route path="assets" element={guard('assets.manage', <AssetsPage />)} />
              <Route path="gst" element={guard('gst.settle', <GstPage />)} />

              <Route path="reports/trial-balance" element={guard('reports.view', <TrialBalancePage />)} />
              <Route path="reports/profit-loss" element={guard('reports.view', <ProfitLossPage />)} />
              <Route path="reports/balance-sheet" element={guard('reports.view', <BalanceSheetPage />)} />
              <Route path="reports/cash-flow" element={guard('reports.view', <CashFlowPage />)} />
              <Route path="reports/debtors" element={guard('reports.view', <DebtorAgeingPage />)} />
              <Route path="reports/creditors" element={guard('reports.view', <CreditorAgeingPage />)} />
              <Route path="reports/gstr1" element={guard('reports.view', <Gstr1Page />)} />
              <Route path="reports/gstr3b" element={guard('reports.view', <Gstr3bPage />)} />
              <Route path="reports/stock-summary" element={guard('reports.view', <StockSummaryPage />)} />
              <Route path="reports/sales-register" element={guard('reports.view', <SalesRegisterPage />)} />
              <Route path="reports/purchase-register" element={guard('reports.view', <PurchaseRegisterPage />)} />

              <Route path="admin/users" element={guard('admin.users', <UsersPage />)} />
              <Route path="admin/period-locks" element={guard('admin.periodlock', <PeriodLocksPage />)} />
              <Route path="admin/audit" element={guard('audit.view', <AuditLogPage />)} />
              <Route path="admin/backup" element={guard('admin.backup', <BackupPage />)} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
    </Bootstrap>
  )
}
