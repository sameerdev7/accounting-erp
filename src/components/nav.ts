import type { Permission } from '@/services/auth'

export interface NavItem {
  label: string
  to: string
  /** The item is shown when the role holds ANY of these permissions. */
  permissions: Permission[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', permissions: ['reports.view'] }],
  },
  {
    label: 'Masters',
    items: [
      { label: 'Company', to: '/company', permissions: ['masters.manage'] },
      { label: 'Chart of Accounts', to: '/accounts', permissions: ['masters.manage'] },
      { label: 'Customers', to: '/customers', permissions: ['masters.manage'] },
      { label: 'Suppliers', to: '/suppliers', permissions: ['masters.manage'] },
      { label: 'Items', to: '/items', permissions: ['masters.manage'] },
      { label: 'Employees', to: '/employees', permissions: ['masters.manage'] },
    ],
  },
  {
    label: 'Purchase',
    items: [
      { label: 'Requisitions', to: '/purchase/requisitions', permissions: ['purchase.create'] },
      { label: 'Purchase Orders', to: '/purchase/orders', permissions: ['purchase.create'] },
      { label: 'Goods Receipt', to: '/purchase/grn', permissions: ['purchase.create'] },
      { label: 'Purchase Invoices', to: '/purchase/invoices', permissions: ['purchase.create'] },
      { label: 'Purchase Returns', to: '/purchase/returns', permissions: ['voucher.create'] },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Sales Orders', to: '/sales/orders', permissions: ['sales.create'] },
      { label: 'Deliveries', to: '/sales/deliveries', permissions: ['sales.create'] },
      { label: 'Sales Invoices', to: '/sales/invoices', permissions: ['sales.create'] },
      { label: 'Sales Returns', to: '/sales/returns', permissions: ['voucher.create'] },
    ],
  },
  {
    label: 'Cash & Bank',
    items: [
      { label: 'Receipts', to: '/cash/receipts', permissions: ['receipt.create'] },
      { label: 'Payments', to: '/cash/payments', permissions: ['payment.create'] },
      { label: 'Contra', to: '/cash/contra', permissions: ['voucher.create'] },
      { label: 'Expenses', to: '/cash/expenses', permissions: ['voucher.create'] },
    ],
  },
  {
    label: 'Books of Account',
    items: [
      { label: 'General Ledger', to: '/ledger', permissions: ['reports.view'] },
      { label: 'Day Book', to: '/daybook', permissions: ['reports.view'] },
      { label: 'Voucher Approvals', to: '/vouchers', permissions: ['voucher.approve'] },
      { label: 'Journals', to: '/journals', permissions: ['voucher.create'] },
    ],
  },
  {
    label: 'Receivables / Payables',
    items: [
      { label: 'Receivables', to: '/receivables', permissions: ['reports.view'] },
      { label: 'Payables', to: '/payables', permissions: ['reports.view'] },
      { label: 'Inventory', to: '/inventory', permissions: ['reports.view'] },
    ],
  },
  {
    label: 'Payroll & Assets',
    items: [
      { label: 'Payroll', to: '/payroll', permissions: ['payroll.run'] },
      { label: 'Fixed Assets', to: '/assets', permissions: ['assets.manage'] },
    ],
  },
  {
    label: 'GST',
    items: [{ label: 'GST Working', to: '/gst', permissions: ['gst.settle'] }],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Trial Balance', to: '/reports/trial-balance', permissions: ['reports.view'] },
      { label: 'Profit & Loss', to: '/reports/profit-loss', permissions: ['reports.view'] },
      { label: 'Balance Sheet', to: '/reports/balance-sheet', permissions: ['reports.view'] },
      { label: 'Cash Flow', to: '/reports/cash-flow', permissions: ['reports.view'] },
      { label: 'Debtors Ageing', to: '/reports/debtors', permissions: ['reports.view'] },
      { label: 'Creditors Ageing', to: '/reports/creditors', permissions: ['reports.view'] },
      { label: 'GSTR-1', to: '/reports/gstr1', permissions: ['reports.view'] },
      { label: 'GSTR-3B', to: '/reports/gstr3b', permissions: ['reports.view'] },
      { label: 'Stock Summary', to: '/reports/stock-summary', permissions: ['reports.view'] },
      { label: 'Sales Register', to: '/reports/sales-register', permissions: ['reports.view'] },
      { label: 'Purchase Register', to: '/reports/purchase-register', permissions: ['reports.view'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', to: '/admin/users', permissions: ['admin.users'] },
      { label: 'Period Locks', to: '/admin/period-locks', permissions: ['admin.periodlock'] },
      { label: 'Audit Log', to: '/admin/audit', permissions: ['audit.view'] },
      { label: 'Backup & Reset', to: '/admin/backup', permissions: ['admin.backup', 'admin.reset'] },
    ],
  },
]
