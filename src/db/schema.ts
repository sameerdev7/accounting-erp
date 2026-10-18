import Dexie, { type Table } from 'dexie'
import type { Paise } from '@/lib/money'

/* ==========================================================================
 * Shared building blocks
 * ========================================================================== */

/** Fields present on every document in the database. */
export interface BaseDoc {
  id: string
  /** epoch millis */
  createdAt: number
  /** user id of whoever created the row */
  createdBy: string
}

/* ==========================================================================
 * Enumerations
 * ========================================================================== */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
export type NormalBalance = 'DEBIT' | 'CREDIT'
export type PartyType = 'CUSTOMER' | 'SUPPLIER'
/** Goods are stocked and valued; services are billed directly. */
export type ItemKind = 'GOODS' | 'SERVICE'

export type VoucherType =
  | 'RECEIPT'
  | 'PAYMENT'
  | 'SALES'
  | 'PURCHASE'
  | 'JOURNAL'
  | 'CONTRA'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'PAYROLL'
  | 'DEPRECIATION'
  | 'OPENING'

export type VoucherStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'POSTED' | 'REVERSED'

export type InvoiceType = 'PURCHASE' | 'SALES'

export type UserRole =
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'PURCHASE_OFFICER'
  | 'SALES_OFFICER'
  | 'APPROVER'
  | 'AUDITOR'

export type PurchaseRequisitionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export type PurchaseOrderStatus = 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED'

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIAL' | 'DELIVERED' | 'CLOSED' | 'CANCELLED'

export type DeliveryStatus = 'DRAFT' | 'POSTED' | 'INVOICED' | 'CANCELLED'

export type GrnStatus = 'DRAFT' | 'POSTED' | 'CANCELLED'

export type PayrollRunStatus = 'DRAFT' | 'POSTED'

export type DepreciationMethod = 'SLM' | 'WDV'

export type StockMovementType = 'OPENING' | 'GRN' | 'DELIVERY' | 'ADJUSTMENT' | 'RETURN_IN' | 'RETURN_OUT'

/* ==========================================================================
 * Core configuration
 * ========================================================================== */

export interface Company extends BaseDoc {
  name: string
  shortName: string
  gstin: string
  pan: string
  /** e.g. 'Maharashtra' — drives intra vs inter-state GST */
  state: string
  /** GST state code, e.g. '27' */
  stateCode: string
  address: string
  city: string
  pincode: string
  phone: string
  email: string
  /** Nature of business, shown on the Company Profile (design brief §Company) */
  natureOfBusiness?: string
  /** What the company makes or sells — products and services, one per line */
  productsAndServices?: string[]
  /** Organisational departments, one per line */
  departments?: string[]
  /** The handful of transaction types that matter most for this business */
  majorTransactions?: string[]
  /** 1 = January … 4 = April (Indian convention) */
  financialYearStartMonth: number
  /** Opening/journal date used by the opening-balance voucher */
  booksBeginDate: string
  /** Prefixes used by the numbering engine, keyed by voucher type / doc type */
  prefixes: Record<string, string>
  bankAccountName: string
  bankAccountNumber: string
  bankIfsc: string
}

/* ==========================================================================
 * Masters
 * ========================================================================== */

export interface Account extends BaseDoc {
  code: string
  name: string
  type: AccountType
  /** Roll-up parent; sub-ledgers point at their control account */
  parentId: string | null
  /** True for control accounts (Accounts Receivable / Payable / GST control etc.) */
  isControl: boolean
  normalBalance: NormalBalance
  isBank: boolean
  isCash: boolean
  /** Set on party sub-ledgers so party reports can find them */
  partyType?: PartyType
  partyId?: string
  /** Contra-account (e.g. Accumulated Depreciation, Sales Returns) shown as negative */
  isContra: boolean
  active: boolean
  note?: string
}

export interface Customer extends BaseDoc {
  code: string
  name: string
  gstin: string
  state: string
  stateCode: string
  address: string
  city: string
  pincode: string
  phone: string
  email: string
  creditLimit: Paise
  creditDays: number
  /** Sub-ledger account id under the Accounts Receivable control account */
  ledgerAccountId: string
  active: boolean
}

export interface Supplier extends BaseDoc {
  code: string
  name: string
  gstin: string
  state: string
  stateCode: string
  address: string
  city: string
  pincode: string
  phone: string
  email: string
  paymentTermsDays: number
  /** Sub-ledger account id under the Accounts Payable control account */
  ledgerAccountId: string
  active: boolean
}

export interface Item extends BaseDoc {
  sku: string
  name: string
  category: string
  hsn: string
  /**
   * GOODS are stocked, valued and despatched through the warehouse. SERVICE are
   * sold straight off a tax invoice: no stock movement, no availability check,
   * and the revenue posts to Service Income. Absent means GOODS.
   */
  kind?: ItemKind
  /** GST percentage: 0 | 5 | 12 | 18 | 28 */
  gstRate: number
  uom: string
  purchasePrice: Paise
  salePrice: Paise
  reorderLevel: number
  active: boolean
}

export interface Employee extends BaseDoc {
  code: string
  name: string
  designation: string
  department: string
  dateOfJoining: string
  /** Monthly gross components, in paise */
  basic: Paise
  hra: Paise
  allowances: Paise
  pfApplicable: boolean
  ptApplicable: boolean
  /** Voluntary monthly TDS on salary, in paise */
  tdsMonthly: Paise
  active: boolean
}

export interface Attendance extends BaseDoc {
  employeeId: string
  /** 'YYYY-MM' */
  month: string
  daysPresent: number
  daysInMonth: number
}

/* ==========================================================================
 * Purchase cycle:  Requisition -> Order -> GRN -> Invoice
 * ========================================================================== */

export interface PurchaseRequisition extends BaseDoc {
  number: string
  date: string
  department: string
  requestedBy: string
  status: PurchaseRequisitionStatus
  approvedBy?: string
  approvedAt?: number
  rejectionReason?: string
  narration: string
}

export interface PurchaseRequisitionLine extends BaseDoc {
  prId: string
  itemId: string
  qty: number
  estimatedRate: Paise
}

export interface PurchaseOrder extends BaseDoc {
  number: string
  date: string
  supplierId: string
  prId?: string | null
  expectedDate: string
  status: PurchaseOrderStatus
  approvedBy?: string
  approvedAt?: number
  narration: string
}

export interface PurchaseOrderLine extends BaseDoc {
  poId: string
  itemId: string
  qty: number
  rate: Paise
  gstRate: number
}

export interface Grn extends BaseDoc {
  number: string
  date: string
  poId: string
  supplierId: string
  status: GrnStatus
  receivedBy: string
  vehicleNo?: string
  narration: string
}

export interface GrnLine extends BaseDoc {
  grnId: string
  poLineId: string
  itemId: string
  /** Quantity ordered on the PO (snapshot, for the 3-way match) */
  orderedQty: number
  receivedQty: number
  /** Quantity damaged/rejected; only acceptedQty enters stock */
  rejectedQty: number
  acceptedQty: number
  rate: Paise
}

/* ==========================================================================
 * Sales cycle:  Order -> Delivery -> Invoice
 * ========================================================================== */

export interface SalesOrder extends BaseDoc {
  number: string
  date: string
  customerId: string
  expectedDate: string
  status: SalesOrderStatus
  narration: string
}

export interface SalesOrderLine extends BaseDoc {
  soId: string
  itemId: string
  qty: number
  rate: Paise
  gstRate: number
}

export interface Delivery extends BaseDoc {
  number: string
  date: string
  soId?: string | null
  customerId: string
  status: DeliveryStatus
  deliveredBy: string
  /** Set once the delivery has been invoiced */
  invoiceId?: string | null
  narration: string
}

export interface DeliveryLine extends BaseDoc {
  deliveryId: string
  soLineId?: string | null
  itemId: string
  qty: number
  rate: Paise
  /** Weighted-average cost captured at the moment of despatch, for COGS */
  costRate: Paise
}

/* ==========================================================================
 * Invoices (shared by purchase and sales)
 * ========================================================================== */

export interface Invoice extends BaseDoc {
  type: InvoiceType
  /** Our own sequential number, e.g. SV/2526/0007 or PV/2526/0002 */
  number: string
  /** The counterparty's invoice number (mandatory for purchases — duplicate control) */
  partyInvoiceNumber: string
  partyId: string
  date: string
  dueDate: string
  /** Party state at the time of invoicing — drives CGST/SGST vs IGST */
  placeOfSupply: string
  interState: boolean
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  roundOff: Paise
  total: Paise
  status: VoucherStatus
  /** PO / delivery the invoice settles */
  sourceDocId?: string | null
  sourceDocType?: 'PO' | 'GRN' | 'SO' | 'DELIVERY' | null
  voucherId?: string | null
  narration: string
  preparedBy: string
  approvedBy?: string
  approvedAt?: number
}

export interface InvoiceLine extends BaseDoc {
  invoiceId: string
  itemId?: string | null
  description: string
  hsn: string
  qty: number
  rate: Paise
  gstRate: number
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
}

/* ==========================================================================
 * Vouchers & the general ledger
 * ========================================================================== */

export interface Voucher extends BaseDoc {
  type: VoucherType
  number: string
  date: string
  narration: string
  status: VoucherStatus
  /** Total of the debit side (equals total credit side) */
  amount: Paise
  preparedBy: string
  submittedBy?: string
  approvedBy?: string
  approvedAt?: number
  postedAt?: number
  /** Set on the mirror voucher created when a posted voucher is reversed */
  reversalOf?: string | null
  /** Set on the original voucher once it has been reversed */
  reversedBy?: string | null
  refDocId?: string | null
  refDocType?: string | null
  partyId?: string | null
}

/**
 * A single debit or credit in the general ledger. Rows are append-only: a
 * posted voucher's entries are never updated or deleted, only reversed by
 * posting a mirror voucher.
 */
export interface LedgerEntry extends BaseDoc {
  voucherId: string
  date: string
  accountId: string
  debit: Paise
  credit: Paise
  partyId?: string | null
  narration: string
}

export interface StockMovement extends BaseDoc {
  itemId: string
  date: string
  type: StockMovementType
  qtyIn: number
  qtyOut: number
  /** Cost rate per unit in paise for inward movements */
  rate: Paise
  refDocId: string
  refDocType: string
  narration: string
}

/** Settlement of an invoice by a receipt or payment voucher. */
export interface Allocation extends BaseDoc {
  invoiceId: string
  /** Receipt or payment voucher id */
  voucherId: string
  partyId: string
  amount: Paise
}

/* ==========================================================================
 * Fixed assets
 * ========================================================================== */

export interface FixedAsset extends BaseDoc {
  code: string
  name: string
  category: string
  /** Gross block in paise */
  cost: Paise
  purchaseDate: string
  usefulLifeYears: number
  method: DepreciationMethod
  /** WDV rate percentage (only used when method = 'WDV') */
  wdvRate: number
  /** Opening accumulated depreciation already provided for */
  openingAccumulatedDep: Paise
  salvageValue: Paise
  disposed: boolean
  disposedDate?: string | null
  assetAccountId: string
  narration: string
}

export interface DepreciationEntry extends BaseDoc {
  assetId: string
  date: string
  /** 'YYYY-MM' of the depreciation run */
  periodKey: string
  amount: Paise
  voucherId: string
}

/* ==========================================================================
 * Payroll
 * ========================================================================== */

export interface PayrollRun extends BaseDoc {
  /** 'YYYY-MM' — a month can only be run once (unique index) */
  month: string
  status: PayrollRunStatus
  employeeCount: number
  grossTotal: Paise
  pfTotal: Paise
  ptTotal: Paise
  tdsTotal: Paise
  otherDeductionsTotal: Paise
  netTotal: Paise
  voucherId?: string | null
  narration: string
}

export interface Payslip extends BaseDoc {
  runId: string
  employeeId: string
  month: string
  daysPresent: number
  daysInMonth: number
  basic: Paise
  hra: Paise
  allowances: Paise
  gross: Paise
  pf: Paise
  pt: Paise
  tds: Paise
  otherDeductions: Paise
  net: Paise
}

/* ==========================================================================
 * Security, audit & housekeeping
 * ========================================================================== */

export interface User extends BaseDoc {
  username: string
  name: string
  /** SHA-256( salt + password ) as hex */
  passwordHash: string
  salt: string
  role: UserRole
  active: boolean
  lastLoginAt?: number | null
}

export interface AuditLogEntry {
  id: string
  /** epoch millis */
  ts: number
  userId: string
  username: string
  /** e.g. CREATE, APPROVE, POST, REVERSE, LOGIN, BACKUP */
  action: string
  /** table / domain name, e.g. 'vouchers', 'invoices' */
  entity: string
  entityId: string
  /** short human description shown in the audit viewer */
  summary: string
  before?: unknown
  after?: unknown
}

export interface Sequence {
  /** e.g. 'SV/2526' */
  key: string
  prefix: string
  fyKey: string
  next: number
  width: number
}

export interface PeriodLock extends BaseDoc {
  /** 'YYYY-MM' for a month lock, or the FY key for a full-year lock */
  period: string
  type: 'MONTH' | 'FY'
  lockedBy: string
  note: string
}

export interface Setting {
  key: string
  value: unknown
}

/* ==========================================================================
 * Database
 * ========================================================================== */

export const DB_NAME = 'sai-erp'

export class ErpDatabase extends Dexie {
  company!: Table<Company, string>
  accounts!: Table<Account, string>
  customers!: Table<Customer, string>
  suppliers!: Table<Supplier, string>
  items!: Table<Item, string>
  employees!: Table<Employee, string>
  attendance!: Table<Attendance, string>

  purchaseRequisitions!: Table<PurchaseRequisition, string>
  purchaseRequisitionLines!: Table<PurchaseRequisitionLine, string>
  purchaseOrders!: Table<PurchaseOrder, string>
  purchaseOrderLines!: Table<PurchaseOrderLine, string>
  grns!: Table<Grn, string>
  grnLines!: Table<GrnLine, string>

  salesOrders!: Table<SalesOrder, string>
  salesOrderLines!: Table<SalesOrderLine, string>
  deliveries!: Table<Delivery, string>
  deliveryLines!: Table<DeliveryLine, string>

  invoices!: Table<Invoice, string>
  invoiceLines!: Table<InvoiceLine, string>

  vouchers!: Table<Voucher, string>
  ledgerEntries!: Table<LedgerEntry, string>
  stockMovements!: Table<StockMovement, string>
  allocations!: Table<Allocation, string>

  assets!: Table<FixedAsset, string>
  depreciationEntries!: Table<DepreciationEntry, string>

  payrollRuns!: Table<PayrollRun, string>
  payslips!: Table<Payslip, string>

  users!: Table<User, string>
  auditLog!: Table<AuditLogEntry, string>
  sequences!: Table<Sequence, string>
  periodLocks!: Table<PeriodLock, string>
  settings!: Table<Setting, string>

  constructor(name: string = DB_NAME) {
    super(name)

    this.version(1).stores({
      company: 'id',

      accounts: 'id, code, name, type, parentId, partyType, partyId, active, isControl, isBank, isCash',
      customers: 'id, code, name, gstin, state, ledgerAccountId, active',
      suppliers: 'id, code, name, gstin, state, ledgerAccountId, active',
      items: 'id, sku, name, category, hsn, active',
      employees: 'id, code, name, department, active',
      attendance: 'id, employeeId, month, [employeeId+month]',

      purchaseRequisitions: 'id, number, date, status, department, requestedBy',
      purchaseRequisitionLines: 'id, prId, itemId',
      purchaseOrders: 'id, number, date, status, supplierId, prId',
      purchaseOrderLines: 'id, poId, itemId',
      grns: 'id, number, date, status, poId, supplierId',
      grnLines: 'id, grnId, poLineId, itemId',

      salesOrders: 'id, number, date, status, customerId',
      salesOrderLines: 'id, soId, itemId',
      deliveries: 'id, number, date, status, soId, customerId, invoiceId',
      deliveryLines: 'id, deliveryId, soLineId, itemId',

      invoices: 'id, number, type, partyId, date, status, sourceDocId, voucherId, &[type+partyId+partyInvoiceNumber]',
      invoiceLines: 'id, invoiceId, itemId',

      vouchers: 'id, type, number, date, status, refDocId, partyId, reversalOf, &[type+number]',
      ledgerEntries: 'id, voucherId, date, accountId, partyId, [accountId+date], [partyId+date]',
      stockMovements: 'id, itemId, date, type, refDocId, [itemId+date]',
      allocations: 'id, invoiceId, voucherId, partyId, [invoiceId+voucherId]',

      assets: 'id, code, name, category, purchaseDate, disposed, assetAccountId',
      depreciationEntries: 'id, assetId, date, periodKey, voucherId',

      payrollRuns: 'id, &month, status',
      payslips: 'id, runId, employeeId, month, [runId+employeeId]',

      users: 'id, &username, role, active',
      auditLog: 'id, ts, userId, entity, entityId, action',
      sequences: 'key',
      periodLocks: 'id, period, type, &[period+type]',
      settings: 'key',
    })
  }
}

export const db = new ErpDatabase()

/* ==========================================================================
 * Small shared types used across services, reports and UI
 * ========================================================================== */

export interface DateRange {
  from: string
  to: string
}

export interface SelectOption {
  value: string
  label: string
}
