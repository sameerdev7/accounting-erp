import { ACC } from '@/db/coa'
import {
  db,
  type Account,
  type AccountType,
  type Attendance,
  type Company,
  type Customer,
  type Employee,
  type Item,
  type NormalBalance,
  type PartyType,
  type Supplier,
} from '@/db/schema'
import { writeTx } from '@/db/tx'
import { newId } from '@/lib/id'
import { writeAudit } from './audit'
import type { Actor } from './ledger'

/* ==========================================================================
 * Company master
 * ========================================================================== */

/** The single company record, or undefined before the seeder has run. */
export async function getCompanyMaster(): Promise<Company | undefined> {
  return db.company.get('company')
}

/**
 * Saves the company master. Only the presentation fields are editable here —
 * the financial-year start month is deliberately not exposed because changing it
 * would re-cut every financial year and every document number in the system.
 */
export async function saveCompany(
  actor: Actor,
  input: Omit<Company, 'id' | 'createdAt' | 'createdBy' | 'financialYearStartMonth' | 'prefixes'>,
): Promise<Company> {
  return writeTx(async () => {
    const existing = await db.company.get('company')
    if (!existing) throw new Error('The company record has not been created yet.')

    if (!input.name.trim()) throw new Error('The company name is required.')
    if (input.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(input.gstin)) {
      throw new Error('That GSTIN is not in the standard 15-character format.')
    }

    const updated: Company = { ...existing, ...input }
    await db.company.put(updated)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'UPDATE',
      entity: 'company',
      entityId: updated.id,
      summary: `Updated company master for ${updated.name}`,
      before: existing,
      after: updated,
    })
    return updated
  })
}

/* ==========================================================================
 * Chart of accounts
 * ========================================================================== */

export async function listAccounts(): Promise<Account[]> {
  const accounts = await db.accounts.toArray()
  return accounts.sort((a, b) => a.code.localeCompare(b.code))
}

export async function listActiveAccounts(): Promise<Account[]> {
  return (await listAccounts()).filter((account) => account.active)
}

export interface AccountInput {
  code: string
  name: string
  type: AccountType
  normalBalance: NormalBalance
  parentId: string | null
  isControl: boolean
  isBank: boolean
  isCash: boolean
  isContra: boolean
  active: boolean
  note?: string
}

export async function saveAccount(
  actor: Actor,
  input: AccountInput & { id?: string },
): Promise<Account> {
  return writeTx(async () => {
    const timestamp = Date.now()

    if (input.id) {
      const existing = await db.accounts.get(input.id)
      if (!existing) throw new Error(`Account ${input.id} not found`)
      const updated: Account = { ...existing, ...input, id: existing.id }
      await db.accounts.put(updated)
      await writeAudit({
        userId: actor.userId,
        username: actor.username,
        action: 'UPDATE',
        entity: 'accounts',
        entityId: existing.id,
        summary: `Updated account ${input.code} ${input.name}`,
        before: existing,
        after: updated,
      })
      return updated
    }

    const account: Account = {
      ...input,
      id: newId('acc'),
      createdAt: timestamp,
      createdBy: actor.userId,
    }
    await db.accounts.add(account)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'accounts',
      entityId: account.id,
      summary: `Created account ${input.code} ${input.name}`,
      after: account,
    })
    return account
  })
}

/* ==========================================================================
 * Party sub-ledgers
 *
 * Every customer and supplier gets its own account beneath the Accounts
 * Receivable / Accounts Payable control account, which is what makes a party
 * ledger statement possible while the control account still reconciles.
 * ========================================================================== */

function subLedgerCode(parentCode: string, partyCode: string): string {
  return `${parentCode}-${partyCode}`
}

async function ensurePartyLedger(
  actor: Actor,
  options: {
    existingAccountId?: string
    partyType: PartyType
    partyId: string
    partyCode: string
    partyName: string
    parentCode: string
  },
): Promise<string> {
  const parent = await db.accounts.where('code').equals(options.parentCode).first()
  if (!parent) throw new Error(`Control account ${options.parentCode} is missing from the chart of accounts`)

  const code = subLedgerCode(options.parentCode, options.partyCode)

  if (options.existingAccountId) {
    const existing = await db.accounts.get(options.existingAccountId)
    if (existing) {
      await db.accounts.put({ ...existing, code, name: options.partyName })
      return existing.id
    }
  }

  const clash = await db.accounts.where('code').equals(code).first()
  if (clash) return clash.id

  const account: Account = {
    id: newId('acc'),
    code,
    name: options.partyName,
    type: options.partyType === 'CUSTOMER' ? 'ASSET' : 'LIABILITY',
    parentId: parent.id,
    isControl: false,
    normalBalance: options.partyType === 'CUSTOMER' ? 'DEBIT' : 'CREDIT',
    isBank: false,
    isCash: false,
    partyType: options.partyType,
    partyId: options.partyId,
    isContra: false,
    active: true,
    note: `Sub-ledger for ${options.partyName}`,
    createdAt: Date.now(),
    createdBy: actor.userId,
  }

  await db.accounts.add(account)
  return account.id
}

/* ==========================================================================
 * Customers
 * ========================================================================== */

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'createdBy' | 'ledgerAccountId'>

export async function listCustomers(): Promise<Customer[]> {
  const rows = await db.customers.toArray()
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  return db.customers.get(id)
}

export async function nextCustomerCode(): Promise<string> {
  const rows = await db.customers.toArray()
  return `C${String(rows.length + 1).padStart(3, '0')}`
}

export async function saveCustomer(
  actor: Actor,
  input: CustomerInput & { id?: string },
): Promise<Customer> {
  return writeTx(async () => {
    const timestamp = Date.now()
    const id = input.id ?? newId('cust')

    const ledgerAccountId = await ensurePartyLedger(actor, {
      existingAccountId: input.id ? (await db.customers.get(input.id))?.ledgerAccountId : undefined,
      partyType: 'CUSTOMER',
      partyId: id,
      partyCode: input.code,
      partyName: input.name,
      parentCode: ACC.RECEIVABLE,
    })

    if (input.id) {
      const existing = await db.customers.get(input.id)
      if (!existing) throw new Error(`Customer ${input.id} not found`)
      const updated: Customer = { ...existing, ...input, ledgerAccountId, id }
      await db.customers.put(updated)
      await writeAudit({
        userId: actor.userId,
        username: actor.username,
        action: 'UPDATE',
        entity: 'customers',
        entityId: id,
        summary: `Updated customer ${input.name}`,
        before: existing,
        after: updated,
      })
      return updated
    }

    const customer: Customer = {
      ...input,
      id,
      ledgerAccountId,
      createdAt: timestamp,
      createdBy: actor.userId,
    }
    await db.customers.add(customer)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'customers',
      entityId: id,
      summary: `Created customer ${input.name} (${input.code})`,
      after: customer,
    })
    return customer
  })
}

/* ==========================================================================
 * Suppliers
 * ========================================================================== */

export type SupplierInput = Omit<Supplier, 'id' | 'createdAt' | 'createdBy' | 'ledgerAccountId'>

export async function listSuppliers(): Promise<Supplier[]> {
  const rows = await db.suppliers.toArray()
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

export async function getSupplier(id: string): Promise<Supplier | undefined> {
  return db.suppliers.get(id)
}

export async function nextSupplierCode(): Promise<string> {
  const rows = await db.suppliers.toArray()
  return `S${String(rows.length + 1).padStart(3, '0')}`
}

export async function saveSupplier(
  actor: Actor,
  input: SupplierInput & { id?: string },
): Promise<Supplier> {
  return writeTx(async () => {
    const timestamp = Date.now()
    const id = input.id ?? newId('sup')

    const ledgerAccountId = await ensurePartyLedger(actor, {
      existingAccountId: input.id ? (await db.suppliers.get(input.id))?.ledgerAccountId : undefined,
      partyType: 'SUPPLIER',
      partyId: id,
      partyCode: input.code,
      partyName: input.name,
      parentCode: ACC.PAYABLE,
    })

    if (input.id) {
      const existing = await db.suppliers.get(input.id)
      if (!existing) throw new Error(`Supplier ${input.id} not found`)
      const updated: Supplier = { ...existing, ...input, ledgerAccountId, id }
      await db.suppliers.put(updated)
      await writeAudit({
        userId: actor.userId,
        username: actor.username,
        action: 'UPDATE',
        entity: 'suppliers',
        entityId: id,
        summary: `Updated supplier ${input.name}`,
        before: existing,
        after: updated,
      })
      return updated
    }

    const supplier: Supplier = {
      ...input,
      id,
      ledgerAccountId,
      createdAt: timestamp,
      createdBy: actor.userId,
    }
    await db.suppliers.add(supplier)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'suppliers',
      entityId: id,
      summary: `Created supplier ${input.name} (${input.code})`,
      after: supplier,
    })
    return supplier
  })
}

/* ==========================================================================
 * Items
 * ========================================================================== */

export type ItemInput = Omit<Item, 'id' | 'createdAt' | 'createdBy'>

export async function listItems(): Promise<Item[]> {
  const rows = await db.items.toArray()
  return rows.sort((a, b) => a.sku.localeCompare(b.sku))
}

export async function getItem(id: string): Promise<Item | undefined> {
  return db.items.get(id)
}

export async function itemsByIds(ids: string[]): Promise<Map<string, Item>> {
  const rows = await db.items.bulkGet(ids)
  const map = new Map<string, Item>()
  for (const row of rows) if (row) map.set(row.id, row)
  return map
}

export async function saveItem(actor: Actor, input: ItemInput & { id?: string }): Promise<Item> {
  return writeTx(async () => {
    const timestamp = Date.now()

    if (input.id) {
      const existing = await db.items.get(input.id)
      if (!existing) throw new Error(`Item ${input.id} not found`)
      const updated: Item = { ...existing, ...input, id: existing.id }
      await db.items.put(updated)
      await writeAudit({
        userId: actor.userId,
        username: actor.username,
        action: 'UPDATE',
        entity: 'items',
        entityId: existing.id,
        summary: `Updated item ${input.sku} ${input.name}`,
        before: existing,
        after: updated,
      })
      return updated
    }

    const item: Item = { ...input, id: newId('item'), createdAt: timestamp, createdBy: actor.userId }
    await db.items.add(item)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'items',
      entityId: item.id,
      summary: `Created item ${input.sku} ${input.name}`,
      after: item,
    })
    return item
  })
}

export async function itemsBySkuPrefix(prefix: string): Promise<Item[]> {
  const rows = await db.items.toArray()
  return rows.filter((item) => item.sku.startsWith(prefix))
}

/* ==========================================================================
 * Employees and attendance
 * ========================================================================== */

export type EmployeeInput = Omit<Employee, 'id' | 'createdAt' | 'createdBy'>

export async function listEmployees(): Promise<Employee[]> {
  const rows = await db.employees.toArray()
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

export async function nextEmployeeCode(): Promise<string> {
  const rows = await db.employees.toArray()
  return `E${String(rows.length + 1).padStart(3, '0')}`
}

export async function saveEmployee(
  actor: Actor,
  input: EmployeeInput & { id?: string },
): Promise<Employee> {
  return writeTx(async () => {
    const timestamp = Date.now()

    if (input.id) {
      const existing = await db.employees.get(input.id)
      if (!existing) throw new Error(`Employee ${input.id} not found`)
      const updated: Employee = { ...existing, ...input, id: existing.id }
      await db.employees.put(updated)
      await writeAudit({
        userId: actor.userId,
        username: actor.username,
        action: 'UPDATE',
        entity: 'employees',
        entityId: existing.id,
        summary: `Updated employee ${input.name}`,
        before: existing,
        after: updated,
      })
      return updated
    }

    const employee: Employee = {
      ...input,
      id: newId('emp'),
      createdAt: timestamp,
      createdBy: actor.userId,
    }
    await db.employees.add(employee)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'employees',
      entityId: employee.id,
      summary: `Created employee ${input.name} (${input.code})`,
      after: employee,
    })
    return employee
  })
}

export async function listAttendance(month: string): Promise<Attendance[]> {
  return db.attendance.where('month').equals(month).toArray()
}

export async function saveAttendance(
  actor: Actor,
  input: { employeeId: string; month: string; daysPresent: number },
): Promise<Attendance> {
  return writeTx(async () => {
    const [year, monthNumber] = input.month.split('-').map(Number)
    const daysInMonthValue = new Date(year, monthNumber, 0).getDate()

    const existing = await db.attendance
      .where('[employeeId+month]')
      .equals([input.employeeId, input.month])
      .first()

    const row: Attendance = {
      id: existing?.id ?? newId('att'),
      employeeId: input.employeeId,
      month: input.month,
      daysPresent: input.daysPresent,
      daysInMonth: daysInMonthValue,
      createdAt: existing?.createdAt ?? Date.now(),
      createdBy: existing?.createdBy ?? actor.userId,
    }

    await db.attendance.put(row)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: existing ? 'UPDATE' : 'CREATE',
      entity: 'attendance',
      entityId: row.id,
      summary: `Attendance for ${input.employeeId} in ${input.month}: ${input.daysPresent}/${daysInMonthValue} days`,
      after: row,
    })
    return row
  })
}

/** Attendance for a month, defaulting to full attendance when not recorded. */
export async function attendanceForMonth(month: string): Promise<Map<string, number>> {
  const rows = await listAttendance(month)
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.employeeId, row.daysPresent)
  return map
}
