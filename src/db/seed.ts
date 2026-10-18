import { addDays, format, subMonths } from 'date-fns'
import { ACC, CHART_OF_ACCOUNTS, stateCodeFor } from './coa'
import {
  db,
  type Account,
  type Company,
  type Customer,
  type Employee,
  type Item,
  type ItemKind,
  type Supplier,
  type User,
} from './schema'
import { ALL_TABLES, getSetting, setSetting, writeTx } from './tx'
import { postOpeningBalances } from '@/engine/posting'
import { currentFinancialYear, daysInMonth, monthKey } from '@/lib/dates'
import { newId, SINGLETON_KEYS } from '@/lib/id'
import { toPaise, type Paise } from '@/lib/money'
import { DEFAULT_PASSWORD, hashPassword, makeSalt } from '@/services/auth'
import { writeAudit } from '@/services/audit'
import { createVoucher, type Actor } from '@/services/ledger'
import { createAsset, purchaseAsset, runDepreciation } from '@/services/assets'
import { createContra, createExpense, createPayment, createReceipt } from '@/services/cashbank'
import { gstYearOverview, settleGst } from '@/services/gst'
import { saveAttendance as persistAttendance } from '@/services/masters'
import { paySalary, runPayroll } from '@/services/payroll'
import { closeInventoryPeriod } from '@/services/periodEnd'
import {
  approveInvoice,
  approvePurchaseOrder,
  createGrn,
  createPurchaseInvoice,
  createPurchaseOrder,
  createPurchaseReturn,
  createRequisition,
  postGrn,
  setRequisitionStatus,
  submitInvoice,
} from '@/services/purchase'
import {
  approveSalesInvoice,
  checkAvailability,
  createDelivery,
  createSalesInvoice,
  createSalesOrder,
  createSalesReturn,
  postDelivery,
  setSalesOrderStatus,
  submitSalesInvoice,
} from '@/services/sales'

export const SEED_KEY = 'seed.version'
/**
 * Bump whenever the seed produces different data or credentials. A mismatch
 * makes `ensureSeeded()` rebuild the books on next load, so an existing browser
 * database is refreshed instead of silently keeping stale rows.
 */
export const SEED_VERSION = 5

/* ==========================================================================
 * Deterministic pseudo-randomness — the seed data must be reproducible
 * ========================================================================== */

function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(rng: () => number, values: T[]): T {
  return values[Math.floor(rng() * values.length) % values.length]
}

function between(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/* ==========================================================================
 * Master data
 * ========================================================================== */

const COMPANY: Omit<Company, 'id' | 'createdAt' | 'createdBy'> = {
  name: 'Sai Electronics & Appliances Pvt. Ltd.',
  shortName: 'Sai Electronics',
  gstin: '27AABCS1429P1ZQ',
  pan: 'AABCS1429P',
  state: 'Maharashtra',
  stateCode: '27',
  address: 'Shop 14, Sai Trade Centre, FC Road',
  city: 'Pune',
  pincode: '411005',
  phone: '+91 20 4123 8890',
  email: 'accounts@saielectronics.example',
  financialYearStartMonth: 4,
  booksBeginDate: '',
  prefixes: {
    REQUISITION: 'PR',
    PURCHASE_ORDER: 'PO',
    GRN: 'GRN',
    SALES_ORDER: 'SO',
    DELIVERY: 'DC',
    SALES_INVOICE: 'INV',
    PURCHASE_INVOICE: 'PIV',
    RECEIPT: 'RV',
    PAYMENT: 'PYV',
    JOURNAL: 'JV',
    CONTRA: 'CV',
    CREDIT_NOTE: 'CN',
    DEBIT_NOTE: 'DN',
    PAYROLL: 'PRV',
    DEPRECIATION: 'DEP',
    OPENING: 'OB',
  },
  bankAccountName: 'HDFC Bank — Current Account',
  bankAccountNumber: '50200012345678',
  bankIfsc: 'HDFC0000123',
  natureOfBusiness:
    'Retail and wholesale trading of consumer electronics, home appliances and electrical goods, together with after-sales installation, repair and annual maintenance services.',
  productsAndServices: [
    'Televisions, refrigerators and washing machines',
    'Air conditioners, fans and voltage stabilisers',
    'Kitchen appliances, mixer grinders and microwave ovens',
    'Water purifiers and geysers',
    'Lighting and electrical wiring accessories',
    'Installation and commissioning services',
    'Annual maintenance contracts and out-of-warranty repairs',
  ],
  departments: [
    'Sales & Marketing',
    'Purchase & Procurement',
    'Stores & Logistics',
    'Accounts & Finance',
    'Human Resources',
    'Service & After-Sales',
  ],
  majorTransactions: [
    'Purchase of trade goods from manufacturers and distributors (with input GST)',
    'Retail and wholesale sales of goods (with output GST, intra- and inter-state)',
    'Provision of installation and maintenance services',
    'Receipts from customers and payments to suppliers',
    'Payment of salaries, PF, professional tax and TDS',
    'Purchase and depreciation of furniture, computers and vehicles',
    'Monthly GST settlement and statutory remittances',
  ],
}

interface CustomerSeed {
  code: string
  name: string
  city: string
  state: string
  gstin: string
  creditLimit: number
  creditDays: number
}

const CUSTOMERS: CustomerSeed[] = [
  { code: 'C001', name: 'Shree Ganesh Traders', city: 'Pune', state: 'Maharashtra', gstin: '27AACFS1234M1Z9', creditLimit: 500000, creditDays: 30 },
  { code: 'C002', name: 'Krishna Electricals', city: 'Mumbai', state: 'Maharashtra', gstin: '27AABCK5678N1Z3', creditLimit: 400000, creditDays: 30 },
  { code: 'C003', name: 'Reliance Digital Stores', city: 'Bengaluru', state: 'Karnataka', gstin: '29AABCR9012P1Z7', creditLimit: 900000, creditDays: 45 },
  { code: 'C004', name: 'Croma Retail Ltd', city: 'Ahmedabad', state: 'Gujarat', gstin: '24AABCC3456Q1Z1', creditLimit: 750000, creditDays: 45 },
  { code: 'C005', name: 'Sai Distributors', city: 'Nashik', state: 'Maharashtra', gstin: '27AADCS7890R1Z5', creditLimit: 300000, creditDays: 15 },
  { code: 'C006', name: 'Vijay Home Appliances', city: 'Nagpur', state: 'Maharashtra', gstin: '27AAECV2345S1Z9', creditLimit: 350000, creditDays: 30 },
  { code: 'C007', name: 'Techno World Pvt Ltd', city: 'Hyderabad', state: 'Telangana', gstin: '36AAFCT6789T1Z2', creditLimit: 600000, creditDays: 30 },
  { code: 'C008', name: 'Metro Cash & Carry', city: 'New Delhi', state: 'Delhi', gstin: '07AAGCM1234U1Z6', creditLimit: 800000, creditDays: 60 },
]

interface SupplierSeed {
  code: string
  name: string
  city: string
  state: string
  gstin: string
  paymentTermsDays: number
}

const SUPPLIERS: SupplierSeed[] = [
  { code: 'S001', name: 'Whirlpool India Ltd', city: 'Pune', state: 'Maharashtra', gstin: '27AAACW1234B1Z5', paymentTermsDays: 30 },
  { code: 'S002', name: 'Samsung India Electronics', city: 'Noida', state: 'Uttar Pradesh', gstin: '09AAACS5678C1Z9', paymentTermsDays: 45 },
  { code: 'S003', name: 'LG Electronics India', city: 'Greater Noida', state: 'Uttar Pradesh', gstin: '09AAACL9012D1Z4', paymentTermsDays: 45 },
  { code: 'S004', name: 'Havells India Ltd', city: 'Mumbai', state: 'Maharashtra', gstin: '27AAACH3456E1Z8', paymentTermsDays: 30 },
  { code: 'S005', name: 'Bajaj Electricals', city: 'Pune', state: 'Maharashtra', gstin: '27AAACB7890F1Z2', paymentTermsDays: 30 },
  { code: 'S006', name: 'Voltas Limited', city: 'Mumbai', state: 'Maharashtra', gstin: '27AAACV2345G1Z7', paymentTermsDays: 30 },
  { code: 'S007', name: 'Blue Star Ltd', city: 'Thane', state: 'Maharashtra', gstin: '27AAACB6789H1Z1', paymentTermsDays: 45 },
  { code: 'S008', name: 'Godrej & Boyce Mfg Co', city: 'Mumbai', state: 'Maharashtra', gstin: '27AAACG1234J1Z6', paymentTermsDays: 30 },
]

interface ItemSeed {
  sku: string
  name: string
  category: string
  hsn: string
  gstRate: number
  uom: string
  purchasePrice: number
  salePrice: number
  reorderLevel: number
  openingQty: number
  /** Defaults to GOODS when omitted */
  kind?: ItemKind
}

const ITEMS: ItemSeed[] = [
  { sku: 'TV-LED-32', name: '32" LED Television', category: 'Television', hsn: '8528', gstRate: 18, uom: 'NOS', purchasePrice: 12500, salePrice: 16990, reorderLevel: 5, openingQty: 12 },
  { sku: 'TV-LED-43', name: '43" Smart LED Television', category: 'Television', hsn: '8528', gstRate: 18, uom: 'NOS', purchasePrice: 21000, salePrice: 28990, reorderLevel: 4, openingQty: 8 },
  { sku: 'TV-LED-55', name: '55" 4K Smart Television', category: 'Television', hsn: '8528', gstRate: 18, uom: 'NOS', purchasePrice: 38500, salePrice: 49990, reorderLevel: 3, openingQty: 5 },
  { sku: 'REF-190', name: '190L Single Door Refrigerator', category: 'Refrigeration', hsn: '8418', gstRate: 18, uom: 'NOS', purchasePrice: 14200, salePrice: 18490, reorderLevel: 4, openingQty: 10 },
  { sku: 'REF-260', name: '260L Double Door Refrigerator', category: 'Refrigeration', hsn: '8418', gstRate: 18, uom: 'NOS', purchasePrice: 23500, salePrice: 30990, reorderLevel: 3, openingQty: 7 },
  { sku: 'REF-340', name: '340L Frost Free Refrigerator', category: 'Refrigeration', hsn: '8418', gstRate: 18, uom: 'NOS', purchasePrice: 31800, salePrice: 41990, reorderLevel: 2, openingQty: 4 },
  { sku: 'WM-TOP-65', name: '6.5kg Top Load Washing Machine', category: 'Laundry', hsn: '8450', gstRate: 18, uom: 'NOS', purchasePrice: 15800, salePrice: 20990, reorderLevel: 4, openingQty: 9 },
  { sku: 'WM-FRT-70', name: '7kg Front Load Washing Machine', category: 'Laundry', hsn: '8450', gstRate: 18, uom: 'NOS', purchasePrice: 26300, salePrice: 34990, reorderLevel: 2, openingQty: 5 },
  { sku: 'AC-SPL-15', name: '1.5 Ton Split Air Conditioner', category: 'Air Conditioning', hsn: '8415', gstRate: 28, uom: 'NOS', purchasePrice: 28500, salePrice: 37990, reorderLevel: 3, openingQty: 6 },
  { sku: 'AC-WIN-10', name: '1 Ton Window Air Conditioner', category: 'Air Conditioning', hsn: '8415', gstRate: 28, uom: 'NOS', purchasePrice: 19500, salePrice: 26490, reorderLevel: 3, openingQty: 6 },
  { sku: 'AC-INV-20', name: '2 Ton Inverter Air Conditioner', category: 'Air Conditioning', hsn: '8415', gstRate: 28, uom: 'NOS', purchasePrice: 42000, salePrice: 55990, reorderLevel: 2, openingQty: 3 },
  { sku: 'MW-CON-23', name: '23L Convection Microwave Oven', category: 'Kitchen', hsn: '8516', gstRate: 18, uom: 'NOS', purchasePrice: 11200, salePrice: 15490, reorderLevel: 4, openingQty: 8 },
  { sku: 'FAN-CEI-1200', name: '1200mm Ceiling Fan', category: 'Fans', hsn: '8414', gstRate: 18, uom: 'NOS', purchasePrice: 1250, salePrice: 1899, reorderLevel: 20, openingQty: 45 },
  { sku: 'FAN-TAB-400', name: '400mm Table Fan', category: 'Fans', hsn: '8414', gstRate: 18, uom: 'NOS', purchasePrice: 1450, salePrice: 2199, reorderLevel: 15, openingQty: 30 },
  { sku: 'MIX-GRN-750', name: '750W Mixer Grinder', category: 'Kitchen', hsn: '8509', gstRate: 18, uom: 'NOS', purchasePrice: 2400, salePrice: 3499, reorderLevel: 15, openingQty: 35 },
  { sku: 'MIX-WET-250', name: '250W Wet Grinder', category: 'Kitchen', hsn: '8509', gstRate: 18, uom: 'NOS', purchasePrice: 4100, salePrice: 5799, reorderLevel: 8, openingQty: 18 },
  { sku: 'IRON-STEAM-1200', name: '1200W Steam Iron', category: 'Kitchen', hsn: '8516', gstRate: 18, uom: 'NOS', purchasePrice: 1100, salePrice: 1699, reorderLevel: 20, openingQty: 40 },
  { sku: 'PUR-RO-8L', name: '8L RO Water Purifier', category: 'Water Care', hsn: '8421', gstRate: 18, uom: 'NOS', purchasePrice: 8200, salePrice: 11499, reorderLevel: 5, openingQty: 12 },
  { sku: 'GYS-15L', name: '15L Storage Water Geyser', category: 'Water Care', hsn: '8516', gstRate: 18, uom: 'NOS', purchasePrice: 6900, salePrice: 9299, reorderLevel: 6, openingQty: 14 },
  { sku: 'GYS-25L', name: '25L Storage Water Geyser', category: 'Water Care', hsn: '8516', gstRate: 18, uom: 'NOS', purchasePrice: 9400, salePrice: 12999, reorderLevel: 4, openingQty: 9 },
  { sku: 'BULB-LED-9', name: '9W LED Bulb (pack of 10)', category: 'Lighting', hsn: '8539', gstRate: 12, uom: 'PKT', purchasePrice: 620, salePrice: 949, reorderLevel: 25, openingQty: 60 },
  { sku: 'BULB-LED-20', name: '20W LED Batten Light', category: 'Lighting', hsn: '8539', gstRate: 12, uom: 'NOS', purchasePrice: 480, salePrice: 749, reorderLevel: 30, openingQty: 70 },
  { sku: 'WIRE-25SQ', name: '2.5 sq.mm Copper Wire (90m)', category: 'Electricals', hsn: '8544', gstRate: 18, uom: 'ROL', purchasePrice: 1850, salePrice: 2649, reorderLevel: 15, openingQty: 32 },
  { sku: 'STAB-4KVA', name: '4 KVA Voltage Stabiliser', category: 'Electricals', hsn: '8504', gstRate: 18, uom: 'NOS', purchasePrice: 3600, salePrice: 4999, reorderLevel: 8, openingQty: 16 },
  { sku: 'ROUT-AC1200', name: 'AC1200 Dual Band Router', category: 'Communication', hsn: '8517', gstRate: 18, uom: 'NOS', purchasePrice: 2100, salePrice: 3199, reorderLevel: 10, openingQty: 22 },
  // Services are billed straight to the customer — no stock, no despatch.
  { sku: 'SVC-INST-AC', name: 'AC Installation & Commissioning', category: 'Installation', hsn: '9954', gstRate: 18, uom: 'JOB', purchasePrice: 0, salePrice: 1500, reorderLevel: 0, openingQty: 0, kind: 'SERVICE' },
  { sku: 'SVC-AMC-1Y', name: 'Annual Maintenance Contract (Appliance)', category: 'Service Contracts', hsn: '9987', gstRate: 18, uom: 'JOB', purchasePrice: 0, salePrice: 4500, reorderLevel: 0, openingQty: 0, kind: 'SERVICE' },
  { sku: 'SVC-REPAIR', name: 'Out-of-Warranty Repair Charge', category: 'Repairs', hsn: '9987', gstRate: 18, uom: 'JOB', purchasePrice: 0, salePrice: 1200, reorderLevel: 0, openingQty: 0, kind: 'SERVICE' },
]

interface EmployeeSeed {
  code: string
  name: string
  designation: string
  department: string
  basic: number
  hra: number
  allowances: number
  tdsMonthly: number
}

const EMPLOYEES: EmployeeSeed[] = [
  { code: 'E001', name: 'Rajesh Deshpande', designation: 'Sales Manager', department: 'Sales', basic: 26000, hra: 10400, allowances: 2600, tdsMonthly: 1600 },
  { code: 'E002', name: 'Priya Kulkarni', designation: 'Accountant', department: 'Accounts', basic: 21000, hra: 8400, allowances: 2100, tdsMonthly: 700 },
  { code: 'E003', name: 'Amit Sharma', designation: 'Purchase Officer', department: 'Purchase', basic: 19000, hra: 7600, allowances: 1900, tdsMonthly: 600 },
  { code: 'E004', name: 'Sneha Patil', designation: 'Store Keeper', department: 'Stores', basic: 14000, hra: 5600, allowances: 1400, tdsMonthly: 0 },
  { code: 'E005', name: 'Vikram Rao', designation: 'Sales Executive', department: 'Sales', basic: 16000, hra: 6400, allowances: 1600, tdsMonthly: 0 },
  { code: 'E006', name: 'Anjali Nair', designation: 'HR Executive', department: 'HR', basic: 18000, hra: 7200, allowances: 1800, tdsMonthly: 250 },
]

interface UserSeed {
  username: string
  name: string
  role: User['role']
}

const USERS: UserSeed[] = [
  { username: 'admin', name: 'Sanjay Mehta (Finance Head)', role: 'ADMIN' },
  { username: 'accountant', name: 'Priya Kulkarni', role: 'ACCOUNTANT' },
  { username: 'purchase', name: 'Amit Sharma', role: 'PURCHASE_OFFICER' },
  { username: 'sales', name: 'Vikram Rao', role: 'SALES_OFFICER' },
  { username: 'manager', name: 'Rajesh Deshpande', role: 'APPROVER' },
  { username: 'auditor', name: 'Meera Iyer (Statutory Auditor)', role: 'AUDITOR' },
]

/* ==========================================================================
 * Seeding
 * ========================================================================== */

export interface SeedSummary {
  accounts: number
  customers: number
  suppliers: number
  items: number
  employees: number
  users: number
  vouchers: number
  ledgerEntries: number
  invoices: number
  stockMovements: number
  stockValue: Paise
}

export interface SeedOptions {
  /** Wipe every table first — used by "Reset all data" */
  reset?: boolean
  actor?: Actor
}

export async function isSeeded(): Promise<boolean> {
  const version = await getSetting<number | null>(SEED_KEY, null)
  const company = await db.company.get(SINGLETON_KEYS.company)
  return version === SEED_VERSION && Boolean(company)
}

/** Called on application start. */
export async function ensureSeeded(): Promise<void> {
  if (await isSeeded()) return
  await seedDatabase({ reset: true })
}

export async function seedDatabase(options: SeedOptions = {}): Promise<SeedSummary> {
  if (options.reset) {
    for (const table of ALL_TABLES) {
      await table.clear()
    }
  }

  const rng = makeRng(20260401)
  const today = new Date()

  // ------------------------------------------------------------------ company
  const now = Date.now()
  const fy = currentFinancialYear(format(today, 'yyyy-MM-dd'))
  const company: Company = {
    ...COMPANY,
    booksBeginDate: fy.start,
    id: SINGLETON_KEYS.company,
    createdAt: now,
    createdBy: 'system',
  }
  await db.company.put(company)

  // ------------------------------------------------------------------- users
  const users = await seedUsers(now)
  const admin = toActor(users, 'admin')
  const accountant = toActor(users, 'accountant')
  const purchaseOfficer = toActor(users, 'purchase')
  const salesOfficer = toActor(users, 'sales')
  const manager = toActor(users, 'manager')
  const seedActor = options.actor ?? admin

  // ------------------------------------------------------------------ accounts
  const accounts = await seedAccounts(now, seedActor)

  // ------------------------------------------------------------------- masters
  const customers = await seedCustomers(now, accountant)
  const suppliers = await seedSuppliers(now, accountant)
  const items = await seedItems(now, accountant)
  await seedEmployees(now, accountant)

  // ------------------------------------------------------- opening balances
  const openingStockValue = await seedOpeningBalances({
    fy,
    items,
    accounts,
    actor: accountant,
    now,
  })

  // -------------------------------------------------------------- trading
  await seedTrading({
    fyStart: fy.start,
    today,
    accounts,
    customers,
    suppliers,
    items,
    actor: { accountant, purchaseOfficer, salesOfficer, manager, admin },
    rng,
    now,
  })

  // ------------------------------------------------------------- payroll, assets
  await seedFixedAssets(now, accountant)

  const months = monthsWithin(subMonths(today, 2), today)
  for (const month of months) {
    await seedPayrollAndStatutory(month, { accountant, admin }, today)
  }
  for (const month of months) {
    await seedDepreciation(month, admin, today, fy.start)
  }

  // ------------------------------------------------------------------- GST
  for (const month of months) {
    await seedGstSettlement(month, admin, today)
  }

  // -------------------------------------------------- inventory period closes
  // Under the periodic method the cost of sales and the closing stock only
  // appear once each month is closed, so every month of trading is closed in
  // order, whichever is the last.
  for (const month of months) {
    await seedInventoryClose(month, admin)
  }

  // ----------------------------------------------------------------- summary
  await setSetting(SEED_KEY, SEED_VERSION)
  await writeAudit({
    userId: seedActor.userId,
    username: seedActor.username,
    action: 'SEED',
    entity: 'database',
    entityId: 'system',
    summary: `Prepared the opening books for ${company.name}`,
  })

  return summariseSeed(openingStockValue)
}

/* ==========================================================================
 * Section: users
 * ========================================================================== */

async function seedUsers(now: number): Promise<User[]> {
  const rows: User[] = []

  for (const seed of USERS) {
    const salt = makeSalt()
    const passwordHash = await hashPassword(DEFAULT_PASSWORD, salt)
    rows.push({
      id: newId('user'),
      username: seed.username,
      name: seed.name,
      salt,
      passwordHash,
      role: seed.role,
      active: true,
      lastLoginAt: null,
      createdAt: now,
      createdBy: 'system',
    })
  }

  await db.users.bulkAdd(rows)
  return rows
}

function toActor(users: User[], username: string): Actor {
  const user = users.find((row) => row.username === username)
  if (!user) throw new Error(`Seed user ${username} was not created`)
  return { userId: user.id, username: user.username, role: user.role }
}

/* ==========================================================================
 * Section: chart of accounts
 * ========================================================================== */

async function seedAccounts(now: number, actor: Actor): Promise<Map<string, Account>> {
  const byCode = new Map<string, Account>()
  const rows: Account[] = []

  for (const seed of CHART_OF_ACCOUNTS) {
    const parent = seed.parentCode ? byCode.get(seed.parentCode) : undefined
    const account: Account = {
      id: newId('acc'),
      code: seed.code,
      name: seed.name,
      type: seed.type,
      parentId: parent?.id ?? null,
      isControl: seed.isControl ?? false,
      normalBalance: seed.normalBalance,
      isBank: seed.isBank ?? false,
      isCash: seed.isCash ?? false,
      isContra: seed.isContra ?? false,
      active: true,
      note: seed.note,
      createdAt: now,
      createdBy: actor.userId,
    }
    byCode.set(account.code, account)
    rows.push(account)
  }

  await db.accounts.bulkAdd(rows)
  return byCode
}

/* ==========================================================================
 * Section: masters
 * ========================================================================== */

async function seedCustomers(now: number, actor: Actor): Promise<Customer[]> {
  const rows: Customer[] = CUSTOMERS.map((seed) => ({
    id: newId('cust'),
    code: seed.code,
    name: seed.name,
    gstin: seed.gstin,
    state: seed.state,
    stateCode: stateCodeFor(seed.state),
    address: `${seed.name}, Main Road`,
    city: seed.city,
    pincode: '400001',
    phone: '+91 98000 00000',
    email: `${seed.code.toLowerCase()}@example.com`,
    creditLimit: toPaise(seed.creditLimit),
    creditDays: seed.creditDays,
    ledgerAccountId: '',
    active: true,
    createdAt: now,
    createdBy: actor.userId,
  }))

  const receivable = await db.accounts.where('code').equals(ACC.RECEIVABLE).first()
  if (!receivable) throw new Error('Control account 1003 is missing')

  const subLedgers: Account[] = rows.map((customer) => ({
    id: newId('acc'),
    code: `${ACC.RECEIVABLE}-${customer.code}`,
    name: customer.name,
    type: 'ASSET',
    parentId: receivable.id,
    isControl: false,
    normalBalance: 'DEBIT',
    isBank: false,
    isCash: false,
    partyType: 'CUSTOMER',
    partyId: customer.id,
    isContra: false,
    active: true,
    note: `Sub-ledger for ${customer.name}`,
    createdAt: now,
    createdBy: actor.userId,
  }))

  for (const [index, account] of subLedgers.entries()) {
    rows[index].ledgerAccountId = account.id
  }

  await db.accounts.bulkAdd(subLedgers)
  await db.customers.bulkAdd(rows)
  return rows
}

async function seedSuppliers(now: number, actor: Actor): Promise<Supplier[]> {
  const rows: Supplier[] = SUPPLIERS.map((seed) => ({
    id: newId('sup'),
    code: seed.code,
    name: seed.name,
    gstin: seed.gstin,
    state: seed.state,
    stateCode: stateCodeFor(seed.state),
    address: `${seed.name}, Industrial Estate`,
    city: seed.city,
    pincode: '400001',
    phone: '+91 90000 00000',
    email: `${seed.code.toLowerCase()}@example.com`,
    paymentTermsDays: seed.paymentTermsDays,
    ledgerAccountId: '',
    active: true,
    createdAt: now,
    createdBy: actor.userId,
  }))

  const payable = await db.accounts.where('code').equals(ACC.PAYABLE).first()
  if (!payable) throw new Error('Control account 2001 is missing')

  const subLedgers: Account[] = rows.map((supplier) => ({
    id: newId('acc'),
    code: `${ACC.PAYABLE}-${supplier.code}`,
    name: supplier.name,
    type: 'LIABILITY',
    parentId: payable.id,
    isControl: false,
    normalBalance: 'CREDIT',
    isBank: false,
    isCash: false,
    partyType: 'SUPPLIER',
    partyId: supplier.id,
    isContra: false,
    active: true,
    note: `Sub-ledger for ${supplier.name}`,
    createdAt: now,
    createdBy: actor.userId,
  }))

  for (const [index, account] of subLedgers.entries()) {
    rows[index].ledgerAccountId = account.id
  }

  await db.accounts.bulkAdd(subLedgers)
  await db.suppliers.bulkAdd(rows)
  return rows
}

async function seedItems(now: number, actor: Actor): Promise<Item[]> {
  const rows: Item[] = ITEMS.map((seed) => ({
    id: newId('item'),
    sku: seed.sku,
    name: seed.name,
    category: seed.category,
    hsn: seed.hsn,
    kind: seed.kind ?? 'GOODS',
    gstRate: seed.gstRate,
    uom: seed.uom,
    purchasePrice: toPaise(seed.purchasePrice),
    salePrice: toPaise(seed.salePrice),
    reorderLevel: seed.reorderLevel,
    active: true,
    createdAt: now,
    createdBy: actor.userId,
  }))

  await db.items.bulkAdd(rows)
  return rows
}

async function seedEmployees(now: number, actor: Actor): Promise<Employee[]> {
  const rows: Employee[] = EMPLOYEES.map((seed) => ({
    id: newId('emp'),
    code: seed.code,
    name: seed.name,
    designation: seed.designation,
    department: seed.department,
    dateOfJoining: '2023-06-01',
    basic: toPaise(seed.basic),
    hra: toPaise(seed.hra),
    allowances: toPaise(seed.allowances),
    pfApplicable: true,
    ptApplicable: true,
    tdsMonthly: toPaise(seed.tdsMonthly),
    active: true,
    createdAt: now,
    createdBy: actor.userId,
  }))

  await db.employees.bulkAdd(rows)
  return rows
}

/* ==========================================================================
 * Section: opening balances
 *
 * The opening voucher is the only posting that is not driven by a document.
 * Opening stock is valued first, and Share Capital absorbs the balance, so the
 * entry is balanced by construction rather than by hand-arithmetic.
 * ========================================================================== */

async function seedOpeningBalances(input: {
  fy: { start: string }
  items: Item[]
  accounts: Map<string, Account>
  actor: Actor
  now: number
}): Promise<Paise> {
  const movements = ITEMS.map((seed, index) => ({ seed, item: input.items[index] }))
    .filter(({ seed }) => seed.kind !== 'SERVICE')
    .map(({ seed, item }) => ({
      id: newId('stk'),
      itemId: item.id,
      date: input.fy.start,
      type: 'OPENING' as const,
      qtyIn: seed.openingQty,
      qtyOut: 0,
      rate: item.purchasePrice,
      refDocId: 'opening',
      refDocType: 'OPENING',
      narration: 'Opening stock',
      createdAt: input.now,
      createdBy: input.actor.userId,
    }))

  await db.stockMovements.bulkAdd(movements)

  const openingStockValue = movements.reduce((total, row) => total + row.qtyIn * row.rate, 0)

  const idOf = (code: string): string => {
    const account = input.accounts.get(code)
    if (!account) throw new Error(`Account ${code} missing while seeding opening balances`)
    return account.id
  }

  const cash = toPaise(50_000)
  const bank = toPaise(1_500_000)
  const furniture = toPaise(300_000)
  const computers = toPaise(200_000)
  const bankLoan = toPaise(500_000)

  const totalDebits = cash + bank + openingStockValue + furniture + computers
  const shareCapital = totalDebits - bankLoan

  const lines = postOpeningBalances(
    { resolve: idOf, narration: 'Opening balances' },
    [
      { accountId: idOf(ACC.CASH), debit: cash, credit: 0, narration: 'Cash in hand at commencement' },
      { accountId: idOf(ACC.BANK), debit: bank, credit: 0, narration: 'HDFC current account' },
      {
        accountId: idOf(ACC.INVENTORY),
        debit: openingStockValue,
        credit: 0,
        narration: 'Opening stock at cost',
      },
      { accountId: idOf(ACC.FURNITURE), debit: furniture, credit: 0, narration: 'Office furniture' },
      { accountId: idOf(ACC.COMPUTERS), debit: computers, credit: 0, narration: 'Computer equipment' },
      { accountId: idOf(ACC.BANK_LOAN), debit: 0, credit: bankLoan, narration: 'HDFC term loan' },
      {
        accountId: idOf(ACC.SHARE_CAPITAL),
        debit: 0,
        credit: shareCapital,
        narration: 'Share capital subscribed',
      },
    ],
  )

  await createVoucher(input.actor, {
    type: 'OPENING',
    date: input.fy.start,
    narration: `Opening balances as at ${input.fy.start}`,
    lines,
    status: 'POSTED',
    ignorePeriodLock: true,
    skipAudit: false,
  })

  return openingStockValue
}

/* ==========================================================================
 * Section: trading activity
 * ========================================================================== */

interface TradingActors {
  accountant: Actor
  purchaseOfficer: Actor
  salesOfficer: Actor
  manager: Actor
  admin: Actor
}

async function seedTrading(input: {
  fyStart: string
  today: Date
  accounts: Map<string, Account>
  customers: Customer[]
  suppliers: Supplier[]
  items: Item[]
  actor: TradingActors
  rng: () => number
  now: number
}): Promise<void> {
  const { rng } = input
  const start = subMonths(input.today, 2)
  const todayISO = format(input.today, 'yyyy-MM-dd')

  // Only goods move through the purchase, delivery and stock cycles; services
  // are billed straight to the customer with no warehouse step.
  const serviceItems = input.items.filter((item) => item.kind === 'SERVICE')
  input.items = input.items.filter((item) => item.kind !== 'SERVICE')

  const purchaseIds: string[] = []
  let dayIndex = 0

  for (let day = start; day <= input.today; day = addDays(day, 1)) {
    const date = format(day, 'yyyy-MM-dd')
    dayIndex += 1

    // A purchase every third day, a sale every other day, keeps stock rotating.
    if (dayIndex % 3 === 0) {
      const invoiceId = await runPurchaseCycle(date, input)
      if (invoiceId) purchaseIds.push(invoiceId)
    }

    if (dayIndex % 2 === 0) {
      await runSalesCycle(date, input)
    }

    if (dayIndex % 5 === 0) {
      await runServiceSale(date, { ...input, services: serviceItems })
    }

    if (dayIndex % 17 === 0) {
      await runSalesReturn(date, input)
    }

    if (dayIndex % 19 === 0) {
      await runPurchaseReturn(date, input)
    }

    if (dayIndex % 11 === 0) {
      await runContra(date, input.accounts, input.actor.accountant, rng)
    }
  }

  await seedMonthlyExpenses(start, input.today, input)

  // Settle most, but not all, supplier invoices so that creditors ageing is real.
  for (const [index, invoiceId] of purchaseIds.entries()) {
    if (index % 4 === 3) continue // leave roughly a quarter unpaid
    const invoice = await db.invoices.get(invoiceId)
    if (!invoice) continue
    const payDate = format(addDays(new Date(`${invoice.date}T00:00:00`), between(rng, 8, 25)), 'yyyy-MM-dd')
    if (payDate > todayISO) continue

    await createPayment(input.actor.accountant, {
      partyId: invoice.partyId,
      date: payDate,
      amount: invoice.total,
      mode: pick(rng, ['BANK', 'NEFT'] as const),
      reference: `NEFT-${invoice.partyInvoiceNumber}`,
      narration: `Payment against supplier invoice ${invoice.partyInvoiceNumber}`,
      allocateTo: [{ invoiceId: invoice.id, amount: invoice.total }],
      acknowledgeDuplicate: true,
    })
  }
}

async function runPurchaseCycle(
  date: string,
  input: {
    suppliers: Supplier[]
    items: Item[]
    actor: TradingActors
    rng: () => number
  },
): Promise<string | null> {
  const { rng, actor } = input
  const supplier = pick(rng, input.suppliers)
  const lineCount = between(rng, 1, 3)
  const chosen = new Set<Item>()

  while (chosen.size < lineCount) chosen.add(pick(rng, input.items))

  try {
    const requisition = await createRequisition(actor.purchaseOfficer, {
      date,
      department: 'Stores',
      narration: `Stock replenishment from ${supplier.name}`,
      lines: [...chosen].map((item) => ({
        itemId: item.id,
        qty: between(rng, 5, 20),
        estimatedRate: item.purchasePrice,
      })),
    })

    await setRequisitionStatus(actor.purchaseOfficer, requisition.id, 'SUBMITTED')
    await setRequisitionStatus(actor.manager, requisition.id, 'APPROVED')

    const order = await createPurchaseOrder(actor.purchaseOfficer, {
      date,
      supplierId: supplier.id,
      expectedDate: format(addDays(new Date(`${date}T00:00:00`), 7), 'yyyy-MM-dd'),
      prId: requisition.id,
      narration: `Against requisition ${requisition.number}`,
      lines: [...chosen].map((item) => ({
        itemId: item.id,
        qty: between(rng, 5, 20),
        rate: item.purchasePrice,
        gstRate: item.gstRate,
      })),
    })

    await approvePurchaseOrder(actor.manager, order.id)

    const orderLines = await db.purchaseOrderLines.where('poId').equals(order.id).toArray()

    const grn = await createGrn(actor.purchaseOfficer, {
      date,
      poId: order.id,
      receivedBy: actor.purchaseOfficer.username,
      vehicleNo: `MH12${between(rng, 1000, 9999)}`,
      narration: `Goods received against ${order.number}`,
      lines: orderLines.map((line) => ({
        poLineId: line.id,
        itemId: line.itemId,
        orderedQty: line.qty,
        receivedQty: line.qty,
        rejectedQty: 0,
        rate: line.rate,
      })),
    })

    await postGrn(actor.purchaseOfficer, grn.id)

    const partyInvoiceNumber = `${supplier.code}/${format(new Date(`${date}T00:00:00`), 'yyyy')}/${between(rng, 1000, 9999)}`

    const invoice = await createPurchaseInvoice(actor.accountant, {
      supplierId: supplier.id,
      partyInvoiceNumber,
      date,
      poId: order.id,
      grnId: grn.id,
      narration: `Purchase of goods against ${order.number}`,
      lines: orderLines.map((line) => {
        const item = input.items.find((row) => row.id === line.itemId)
        return {
          itemId: line.itemId,
          description: item?.name ?? 'Goods',
          hsn: item?.hsn ?? '0000',
          qty: line.qty,
          rate: line.rate,
          gstRate: line.gstRate,
        }
      }),
    })

    await submitInvoice(actor.accountant, invoice.id)
    await approveInvoice(actor.admin, invoice.id)

    return invoice.id
  } catch (error) {
    // A single failed cycle must not abort the whole seed; the rest of the
    // seeded data is still useful.
    console.warn(`[seed] purchase cycle on ${date} skipped:`, (error as Error).message)
    return null
  }
}

async function runSalesCycle(
  date: string,
  input: {
    customers: Customer[]
    items: Item[]
    actor: TradingActors
    rng: () => number
  },
): Promise<void> {
  const { actor, rng } = input
  const customer = pick(rng, input.customers)
  const lineCount = between(rng, 1, 3)
  const chosen = new Set<Item>()

  while (chosen.size < lineCount) chosen.add(pick(rng, input.items))

  try {
    const order = await createSalesOrder(actor.salesOfficer, {
      customerId: customer.id,
      date,
      expectedDate: format(addDays(new Date(`${date}T00:00:00`), 3), 'yyyy-MM-dd'),
      narration: `Order from ${customer.name}`,
      lines: [...chosen].map((item) => ({
        itemId: item.id,
        qty: between(rng, 1, 6),
        rate: item.salePrice,
        gstRate: item.gstRate,
      })),
    })

    await setSalesOrderStatus(actor.salesOfficer, order.id, 'CONFIRMED')

    const orderLines = await db.salesOrderLines.where('soId').equals(order.id).toArray()

    // Deliver whatever stock allows; split the rest off rather than failing.
    const shortfalls = await checkAvailability(orderLines)
    const shortById = new Map(shortfalls.map((row) => [row.itemId, row.available]))

    const deliverables = orderLines
      .map((line) => {
        const available = shortById.get(line.itemId)
        const qty =
          available === undefined ? line.qty : Math.floor(available * 0.5)
        return { line, qty }
      })
      .filter((row) => row.qty >= 1)

    if (deliverables.length === 0) return

    const delivery = await createDelivery(actor.salesOfficer, {
      customerId: customer.id,
      date,
      soId: order.id,
      deliveredBy: actor.salesOfficer.username,
      narration: `Delivery against ${order.number}`,
      lines: deliverables.map((row) => ({
        itemId: row.line.itemId,
        soLineId: row.line.id,
        qty: row.qty,
        rate: row.line.rate,
      })),
    })

    await postDelivery(actor.salesOfficer, delivery.id)

    const invoice = await createSalesInvoice(actor.accountant, {
      customerId: customer.id,
      date,
      soId: order.id,
      deliveryId: delivery.id,
      narration: `Sale to ${customer.name}`,
      lines: deliverables.map((row) => {
        const item = input.items.find((candidate) => candidate.id === row.line.itemId)
        return {
          itemId: row.line.itemId,
          description: item?.name ?? 'Goods',
          hsn: item?.hsn ?? '0000',
          qty: row.qty,
          rate: row.line.rate,
          gstRate: row.line.gstRate,
        }
      }),
    })

    await submitSalesInvoice(actor.accountant, invoice.id)
    await approveSalesInvoice(actor.admin, invoice.id)

    // Collect: most invoices are settled, some partly, a few not at all.
    const draw = rng()
    const collectionDate = format(
      addDays(new Date(`${date}T00:00:00`), between(rng, 5, 40)),
      'yyyy-MM-dd',
    )
    const todayISO = format(new Date(), 'yyyy-MM-dd')
    if (collectionDate > todayISO) return

    const amount =
      draw < 0.6 ? invoice.total : draw < 0.85 ? Math.round(invoice.total * 0.5) : 0
    if (amount <= 0) return

    await createReceipt(actor.accountant, {
      partyId: customer.id,
      date: collectionDate,
      amount,
      mode: pick(rng, ['BANK', 'UPI', 'CHEQUE'] as const),
      reference: `RCPT-${invoice.number}`,
      narration: `Received from ${customer.name} against ${invoice.number}`,
      allocateTo: [{ invoiceId: invoice.id, amount }],
      acknowledgeDuplicate: true,
    })
  } catch (error) {
    console.warn(`[seed] sales cycle on ${date} skipped:`, (error as Error).message)
  }
}

async function runServiceSale(
  date: string,
  input: { customers: Customer[]; services: Item[]; actor: TradingActors; rng: () => number },
): Promise<void> {
  const { actor, rng } = input
  if (input.services.length === 0) return

  const customer = pick(rng, input.customers)
  const lineCount = Math.min(between(rng, 1, 2), input.services.length)
  const chosen = new Set<Item>()
  while (chosen.size < lineCount) chosen.add(pick(rng, input.services))

  try {
    // A service sale is invoiced directly — there is no order, delivery or stock
    // movement — and posts to Service Income rather than Sales.
    const invoice = await createSalesInvoice(actor.accountant, {
      customerId: customer.id,
      date,
      narration: `Service billing to ${customer.name}`,
      lines: [...chosen].map((item) => ({
        itemId: item.id,
        description: item.name,
        hsn: item.hsn,
        qty: between(rng, 1, 2),
        rate: item.salePrice,
        gstRate: item.gstRate,
      })),
    })

    await submitSalesInvoice(actor.accountant, invoice.id)
    await approveSalesInvoice(actor.admin, invoice.id)

    const todayISO = format(new Date(), 'yyyy-MM-dd')
    const collectionDate = format(
      addDays(new Date(`${date}T00:00:00`), between(rng, 5, 30)),
      'yyyy-MM-dd',
    )
    if (collectionDate > todayISO) return

    await createReceipt(actor.accountant, {
      partyId: customer.id,
      date: collectionDate,
      amount: invoice.total,
      mode: pick(rng, ['BANK', 'UPI'] as const),
      reference: `RCPT-${invoice.number}`,
      narration: `Service charges received from ${customer.name} against ${invoice.number}`,
      allocateTo: [{ invoiceId: invoice.id, amount: invoice.total }],
      acknowledgeDuplicate: true,
    })
  } catch (error) {
    console.warn(`[seed] service sale on ${date} skipped:`, (error as Error).message)
  }
}

async function runContra(
  date: string,
  accounts: Map<string, Account>,
  actor: Actor,
  rng: () => number,
): Promise<void> {
  const cash = accounts.get(ACC.CASH)
  const bank = accounts.get(ACC.BANK)
  if (!cash || !bank) return

  await createContra(actor, {
    date,
    fromAccountId: cash.id,
    toAccountId: bank.id,
    amount: toPaise(between(rng, 5000, 25000)),
    narration: 'Cash deposited into bank',
  })
}

/**
 * An occasional customer return. The goods go back into stock and the credit
 * note reverses part of the original sale, which is how corrections are made in
 * a system where posted vouchers are immutable.
 */
async function runSalesReturn(
  date: string,
  input: { customers: Customer[]; items: Item[]; actor: TradingActors; rng: () => number },
): Promise<void> {
  const { rng, actor } = input
  const customer = pick(rng, input.customers)
  const item = pick(rng, input.items)

  try {
    await createSalesReturn(actor.accountant, {
      customerId: customer.id,
      date,
      narration: `Goods returned by ${customer.name} — damaged in transit`,
      reinstateStock: true,
      lines: [
        {
          itemId: item.id,
          description: item.name,
          qty: between(rng, 1, 2),
          rate: item.salePrice,
          gstRate: item.gstRate,
        },
      ],
    })
  } catch (error) {
    console.warn(`[seed] credit note on ${date} skipped:`, (error as Error).message)
  }
}

/** An occasional return to a supplier, raised as a Debit Note. */
async function runPurchaseReturn(
  date: string,
  input: { suppliers: Supplier[]; items: Item[]; actor: TradingActors; rng: () => number },
): Promise<void> {
  const { rng, actor } = input
  const supplier = pick(rng, input.suppliers)
  const item = pick(rng, input.items)

  try {
    await createPurchaseReturn(actor.accountant, {
      supplierId: supplier.id,
      date,
      narration: `Goods returned to ${supplier.name} — specification mismatch`,
      lines: [
        {
          itemId: item.id,
          description: item.name,
          qty: between(rng, 1, 2),
          rate: item.purchasePrice,
          gstRate: item.gstRate,
        },
      ],
    })
  } catch (error) {
    console.warn(`[seed] debit note on ${date} skipped:`, (error as Error).message)
  }
}

async function seedMonthlyExpenses(
  start: Date,
  today: Date,
  input: { accounts: Map<string, Account>; actor: TradingActors; rng: () => number },
): Promise<void> {
  const idOf = (code: string): string | undefined => input.accounts.get(code)?.id
  const rent = idOf(ACC.RENT)
  const utilities = idOf(ACC.UTILITIES)
  const office = idOf(ACC.OFFICE_ADMIN)
  const marketing = idOf(ACC.MARKETING)
  const bankCharges = idOf(ACC.BANK_CHARGES)
  const interest = idOf(ACC.INTEREST_ON_LOAN)
  if (!rent || !utilities || !office || !marketing || !bankCharges || !interest) return

  for (const month of monthsWithin(start, today)) {
    const inMonth = (day: number) => `${month}-${String(day).padStart(2, '0')}`
    const cap = (iso: string) => (iso <= format(today, 'yyyy-MM-dd') ? iso : null)

    const events: Array<() => Promise<unknown>> = []

    const rentDate = cap(inMonth(5))
    if (rentDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: rentDate,
          expenseAccountId: rent,
          amount: toPaise(20_000),
          tdsAmount: toPaise(2_000),
          mode: 'BANK',
          narration: 'Shop rent for the month — 10% TDS withheld under section 194-I',
        }),
      )
    }

    const utilitiesDate = cap(inMonth(7))
    if (utilitiesDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: utilitiesDate,
          expenseAccountId: utilities,
          amount: toPaise(between(input.rng, 14_000, 22_000)),
          mode: 'BANK',
          narration: 'Electricity and water charges',
        }),
      )
    }

    const officeDate = cap(inMonth(9))
    if (officeDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: officeDate,
          expenseAccountId: office,
          amount: toPaise(between(input.rng, 8_000, 15_000)),
          mode: 'BANK',
          narration: 'Office stationery, courier and sundry administration',
        }),
      )
    }

    const marketingDate = cap(inMonth(12))
    if (marketingDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: marketingDate,
          expenseAccountId: marketing,
          amount: toPaise(between(input.rng, 15_000, 30_000)),
          mode: 'BANK',
          narration: 'Local newspaper and digital advertising',
        }),
      )
    }

    const bankChargeDate = cap(inMonth(28))
    if (bankChargeDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: bankChargeDate,
          expenseAccountId: bankCharges,
          amount: toPaise(between(input.rng, 300, 900)),
          mode: 'BANK',
          narration: 'Bank charges and GST on banking services',
        }),
      )
    }

    const interestDate = cap(inMonth(28))
    if (interestDate) {
      events.push(() =>
        createExpense(input.actor.accountant, {
          date: interestDate,
          expenseAccountId: interest,
          amount: toPaise(8_750),
          mode: 'BANK',
          narration: 'Interest on HDFC term loan',
        }),
      )
    }

    for (const event of events) {
      try {
        await event()
      } catch (error) {
        console.warn('[seed] monthly expense skipped:', (error as Error).message)
      }
    }
  }
}

/* ==========================================================================
 * Section: payroll
 * ========================================================================== */

async function seedPayrollAndStatutory(
  month: string,
  actors: { accountant: Actor; admin: Actor },
  today: Date,
): Promise<void> {
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
  if (lastDay > format(today, 'yyyy-MM-dd')) return

  try {
    // Attendance: full attendance, with one employee short in one month so the
    // pro-rating logic has something to work with.
    const employees = await db.employees.toArray()
    for (const [index, employee] of employees.entries()) {
      const present = index === 3 && month.endsWith('-09') ? daysInMonth(month) - 2 : daysInMonth(month)
      await persistAttendance(actors.accountant, { employeeId: employee.id, month, daysPresent: present })
    }

    const run = await runPayroll(actors.admin, month)
    await paySalary(actors.admin, run.id, { date: lastDay })
  } catch (error) {
    console.warn(`[seed] payroll for ${month} skipped:`, (error as Error).message)
  }
}

/* ==========================================================================
 * Section: fixed assets and depreciation
 * ========================================================================== */

async function seedFixedAssets(now: number, actor: Actor): Promise<void> {
  const furniture = await db.accounts.where('code').equals(ACC.FURNITURE).first()
  const computers = await db.accounts.where('code').equals(ACC.COMPUTERS).first()
  const vehicles = await db.accounts.where('code').equals(ACC.VEHICLES).first()
  if (!furniture || !computers || !vehicles) return

  await createAsset(actor, {
    code: 'FA001',
    name: 'Office Furniture & Fixtures',
    category: 'Furniture',
    cost: toPaise(300_000),
    purchaseDate: '2023-04-01',
    usefulLifeYears: 10,
    method: 'SLM',
    wdvRate: 0,
    salvageValue: 0,
    openingAccumulatedDep: 0,
    assetAccountId: furniture.id,
    narration: 'Furniture brought forward from the opening balance sheet',
  })

  await createAsset(actor, {
    code: 'FA002',
    name: 'Computer Equipment (6 workstations)',
    category: 'Computers',
    cost: toPaise(200_000),
    purchaseDate: '2023-04-01',
    usefulLifeYears: 3,
    method: 'SLM',
    wdvRate: 0,
    salvageValue: 0,
    openingAccumulatedDep: 0,
    assetAccountId: computers.id,
    narration: 'Computers brought forward from the opening balance sheet',
  })

  // A live purchase in the period, capitalised straight to Vehicles, so the
  // asset-purchase pathway and the WDV method are both represented.
  try {
    await purchaseAsset(actor, {
      code: 'FA003',
      name: 'Tata Ace Delivery Van',
      category: 'Vehicles',
      cost: toPaise(650_000),
      purchaseDate: format(subMonths(new Date(), 2), 'yyyy-MM-dd'),
      usefulLifeYears: 6,
      method: 'WDV',
      wdvRate: 15,
      salvageValue: toPaise(50_000),
      openingAccumulatedDep: 0,
      assetAccountId: vehicles.id,
      narration: 'Delivery van purchased during the period, capitalised with input GST',
      supplierId: null,
      bankAccountId: null,
      gstRate: 28,
    })
  } catch (error) {
    console.warn('[seed] vehicle purchase skipped:', (error as Error).message)
  }

  void now
}

async function seedDepreciation(
  month: string,
  actor: Actor,
  today: Date,
  fyStart: string,
): Promise<void> {
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
  if (lastDay > format(today, 'yyyy-MM-dd')) return
  if (lastDay < fyStart) return

  try {
    await runDepreciation(actor, { periodKey: month, date: lastDay })
  } catch (error) {
    console.warn(`[seed] depreciation for ${month} skipped:`, (error as Error).message)
  }
}

/* ==========================================================================
 * Section: GST settlement
 * ========================================================================== */

async function seedGstSettlement(month: string, actor: Actor, today: Date): Promise<void> {
  const alreadySettled = await db.vouchers
    .where('type')
    .equals('JOURNAL')
    .filter((voucher) => voucher.narration.includes(`GST settlement for`))
    .toArray()

  const overview = await gstYearOverview(format(today, 'yyyy-MM-dd'))
  const row = overview.find((candidate) => candidate.month === month)
  if (!row) return
  if (row.outputTotal === 0 && row.inputTotal === 0) return

  // Settle the previous month's GST on the 11th of the following month.
  const nextMonth = addDays(new Date(`${month}-28T00:00:00`), 15)
  const settlementDate = format(nextMonth, 'yyyy-MM-dd')
  if (settlementDate > format(today, 'yyyy-MM-dd')) return
  if (alreadySettled.some((voucher) => voucher.date === settlementDate)) return

  try {
    await settleGst(actor, { month, date: settlementDate })
  } catch (error) {
    console.warn(`[seed] GST settlement for ${month} skipped:`, (error as Error).message)
  }
}

/* ==========================================================================
 * Section: inventory period close
 * ========================================================================== */

async function seedInventoryClose(month: string, actor: Actor): Promise<void> {
  try {
    await closeInventoryPeriod(actor, { month })
  } catch (error) {
    console.warn(`[seed] inventory close for ${month} skipped:`, (error as Error).message)
  }
}

/* ==========================================================================
 * Utilities
 * ========================================================================== */

function monthsWithin(start: Date, end: Date): string[] {
  const keys: string[] = []
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor <= end) {
    keys.push(monthKey(format(cursor, 'yyyy-MM-dd')))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  return keys
}

async function summariseSeed(openingStockValue: Paise): Promise<SeedSummary> {
  void openingStockValue
  const [accounts, customers, suppliers, items, employees, users, vouchers, ledgerEntries, invoices, stockMovements] =
    await Promise.all([
      db.accounts.count(),
      db.customers.count(),
      db.suppliers.count(),
      db.items.count(),
      db.employees.count(),
      db.users.count(),
      db.vouchers.count(),
      db.ledgerEntries.count(),
      db.invoices.count(),
      db.stockMovements.count(),
    ])

  let stockValue = 0
  const movements = await db.stockMovements.toArray()
  const { replayMovements, groupByItem } = await import('@/services/inventory')
  for (const [itemId, rows] of groupByItem(movements)) {
    stockValue += replayMovements(itemId, rows).value
  }

  return {
    accounts,
    customers,
    suppliers,
    items,
    employees,
    users,
    vouchers,
    ledgerEntries,
    invoices,
    stockMovements,
    stockValue,
  }
}

/** Convenience for tests and the reset button. */
export async function wipeDatabase(): Promise<void> {
  await writeTx(async () => {
    for (const table of ALL_TABLES) {
      await table.clear()
    }
  })
}
