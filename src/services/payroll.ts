import { db, type Employee, type PayrollRun, type Payslip } from '@/db/schema'
import { loadResolver, makeContext, writeTx } from '@/db/tx'
import { postPayroll, postSalaryPayment, postStatutoryPayment } from '@/engine/posting'
import { PostingError } from '@/engine/types'
import { ACC } from '@/db/coa'
import { daysInMonth as daysInMonthOf } from '@/lib/dates'
import { formatMonthKey } from '@/lib/format'
import { newId } from '@/lib/id'
import type { Paise } from '@/lib/money'
import { writeAudit } from './audit'
import { createVoucher, type Actor } from './ledger'
import { attendanceForMonth } from './masters'

/* ==========================================================================
 * Salary computation
 * ========================================================================== */

/** Statutory rates. PF is 12% of basic for employee and employer alike. */
export const PF_RATE = 0.12

/**
 * Professional tax slabs (Maharashtra-style, monthly).
 */
export function professionalTax(grossMonthly: Paise): Paise {
  if (grossMonthly >= 1_000_000) return 20_000 // ₹10,000+  ->  ₹200
  if (grossMonthly >= 750_000) return 15_000 //  ₹7,500+  ->  ₹150
  return 0
}

export interface PayslipComputation {
  employeeId: string
  employeeCode: string
  employeeName: string
  month: string
  daysPresent: number
  daysInMonth: number
  basic: Paise
  hra: Paise
  allowances: Paise
  gross: Paise
  pfEmployee: Paise
  pfEmployer: Paise
  pt: Paise
  tds: Paise
  otherDeductions: Paise
  net: Paise
}

/**
 * Full-month salary is pro-rated by attendance: gross components are scaled by
 * days present over days in the month, and PF follows the pro-rated basic
 * because it is a percentage of basic pay.
 */
export function computePayslip(
  employee: Employee,
  month: string,
  daysPresent: number,
): PayslipComputation {
  const total = daysInMonthOf(month)
  const present = Math.max(0, Math.min(daysPresent, total))
  const ratio = total > 0 ? present / total : 1

  const basic = Math.round(employee.basic * ratio)
  const hra = Math.round(employee.hra * ratio)
  const allowances = Math.round(employee.allowances * ratio)
  const gross = basic + hra + allowances

  const pfEmployee = employee.pfApplicable ? Math.round(basic * PF_RATE) : 0
  const pfEmployer = employee.pfApplicable ? Math.round(basic * PF_RATE) : 0
  const pt = employee.ptApplicable ? professionalTax(employee.basic + employee.hra + employee.allowances) : 0
  const tds = employee.tdsMonthly
  const otherDeductions = 0

  const net = gross - pfEmployee - pt - tds - otherDeductions

  return {
    employeeId: employee.id,
    employeeCode: employee.code,
    employeeName: employee.name,
    month,
    daysPresent: present,
    daysInMonth: total,
    basic,
    hra,
    allowances,
    gross,
    pfEmployee,
    pfEmployer,
    pt,
    tds,
    otherDeductions,
    net,
  }
}

/** Computes the whole payroll without writing anything — used for the preview. */
export async function previewPayroll(month: string): Promise<PayslipComputation[]> {
  const employees = (await db.employees.toArray()).filter((employee) => employee.active)
  const attendance = await attendanceForMonth(month)
  const total = daysInMonthOf(month)

  return employees
    .map((employee) => computePayslip(employee, month, attendance.get(employee.id) ?? total))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
}

export function summarisePayroll(rows: PayslipComputation[]): {
  gross: Paise
  pfEmployee: Paise
  pfEmployer: Paise
  pt: Paise
  tds: Paise
  other: Paise
  net: Paise
} {
  return rows.reduce(
    (totals, row) => ({
      gross: totals.gross + row.gross,
      pfEmployee: totals.pfEmployee + row.pfEmployee,
      pfEmployer: totals.pfEmployer + row.pfEmployer,
      pt: totals.pt + row.pt,
      tds: totals.tds + row.tds,
      other: totals.other + row.otherDeductions,
      net: totals.net + row.net,
    }),
    { gross: 0, pfEmployee: 0, pfEmployer: 0, pt: 0, tds: 0, other: 0, net: 0 },
  )
}

/* ==========================================================================
 * Running payroll
 * ========================================================================== */

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const rows = await db.payrollRuns.toArray()
  return rows.sort((a, b) => (a.month < b.month ? 1 : -1))
}

export async function payslipsForRun(runId: string): Promise<Payslip[]> {
  return db.payslips.where('runId').equals(runId).toArray()
}

export async function payslipsForMonth(month: string): Promise<Payslip[]> {
  return db.payslips.where('month').equals(month).toArray()
}

/**
 * Runs payroll for a month: writes the payslips and posts a single journal that
 * charges gross salaries and employer PF, and recognises every statutory
 * liability plus the net amount payable to employees.
 */
export async function runPayroll(actor: Actor, month: string): Promise<PayrollRun> {
  return writeTx(async () => {
    const existing = await db.payrollRuns.where('month').equals(month).first()
    if (existing) {
      throw new PostingError(`Payroll for ${formatMonthKey(month)} has already been run.`)
    }

    const rows = await previewPayroll(month)
    if (rows.length === 0) throw new PostingError('There are no active employees to pay.')

    const totals = summarisePayroll(rows)
    const postDate = `${month}-${String(daysInMonthOf(month)).padStart(2, '0')}`
    const resolver = await loadResolver()

    const lines = postPayroll(makeContext(resolver, `Payroll for ${formatMonthKey(month)}`), {
      gross: totals.gross,
      pfEmployee: totals.pfEmployee,
      pfEmployer: totals.pfEmployer,
      pt: totals.pt,
      tds: totals.tds,
      otherDeductions: totals.other,
      net: totals.net,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'PAYROLL',
      date: postDate,
      narration: `Payroll for ${formatMonthKey(month)} — ${rows.length} employee(s)`,
      lines,
      refDocType: 'PAYROLL_RUN',
    })

    const now = Date.now()
    const run: PayrollRun = {
      id: newId('payrun'),
      month,
      status: 'POSTED',
      employeeCount: rows.length,
      grossTotal: totals.gross,
      pfTotal: totals.pfEmployee + totals.pfEmployer,
      ptTotal: totals.pt,
      tdsTotal: totals.tds,
      otherDeductionsTotal: totals.other,
      netTotal: totals.net,
      voucherId: voucher.id,
      narration: `Payroll for ${formatMonthKey(month)}`,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.payrollRuns.add(run)

    await db.payslips.bulkAdd(
      rows.map((row) => ({
        id: newId('slip'),
        runId: run.id,
        employeeId: row.employeeId,
        month,
        daysPresent: row.daysPresent,
        daysInMonth: row.daysInMonth,
        basic: row.basic,
        hra: row.hra,
        allowances: row.allowances,
        gross: row.gross,
        pf: row.pfEmployee,
        pt: row.pt,
        tds: row.tds,
        otherDeductions: row.otherDeductions,
        net: row.net,
        createdAt: now,
        createdBy: actor.userId,
      })),
    )

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'payrollRuns',
      entityId: run.id,
      summary: `Ran payroll for ${formatMonthKey(month)}: gross ${totals.gross}, net ${totals.net}`,
      after: { month, net: totals.net, employees: rows.length },
    })

    return run
  })
}

/** Pays the net salary out of the bank. */
export async function paySalary(
  actor: Actor,
  runId: string,
  options: { date: string; bankAccountId?: string },
): Promise<{ voucherId: string }> {
  return writeTx(async () => {
    const run = await db.payrollRuns.get(runId)
    if (!run) throw new PostingError('Payroll run not found')

    const resolver = await loadResolver()
    const bankAccountId = options.bankAccountId ?? resolver(ACC.BANK)

    const lines = postSalaryPayment(makeContext(resolver, `Salary payout for ${formatMonthKey(run.month)}`), {
      amount: run.netTotal,
      bankAccountId,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'PAYMENT',
      date: options.date,
      narration: `Salary paid for ${formatMonthKey(run.month)}`,
      lines,
      refDocId: run.id,
      refDocType: 'PAYROLL_RUN',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Paid salaries for ${formatMonthKey(run.month)} — ${run.netTotal}`,
      after: { netTotal: run.netTotal },
    })

    return { voucherId: voucher.id }
  })
}

export type StatutoryLiability = 'PF' | 'PT' | 'TDS'

const LIABILITY_CODES: Record<StatutoryLiability, string> = {
  PF: ACC.PF_PAYABLE,
  PT: ACC.PT_PAYABLE,
  TDS: ACC.TDS_PAYABLE,
}

/** Remits a statutory liability to the government. */
export async function remitStatutory(
  actor: Actor,
  options: { liability: StatutoryLiability; amount: Paise; date: string; bankAccountId?: string; narration?: string },
): Promise<{ voucherId: string }> {
  return writeTx(async () => {
    const resolver = await loadResolver()
    const bankAccountId = options.bankAccountId ?? resolver(ACC.BANK)
    const code = LIABILITY_CODES[options.liability]

    const lines = postStatutoryPayment(makeContext(resolver, options.narration ?? `${options.liability} remittance`), {
      liabilityCode: code,
      amount: options.amount,
      bankAccountId,
    })

    const { voucher } = await createVoucher(actor, {
      type: 'PAYMENT',
      date: options.date,
      narration: options.narration ?? `${options.liability} remitted to the government`,
      lines,
      refDocType: 'STATUTORY',
    })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'POST',
      entity: 'vouchers',
      entityId: voucher.id,
      summary: `Remitted ${options.liability} of ${options.amount}`,
      after: { amount: options.amount },
    })

    return { voucherId: voucher.id }
  })
}

/** Outstanding statutory balance for a given liability. */
export async function statutoryBalance(liability: StatutoryLiability): Promise<Paise> {
  const account = await db.accounts.where('code').equals(LIABILITY_CODES[liability]).first()
  if (!account) return 0

  const entries = await db.ledgerEntries.where('accountId').equals(account.id).toArray()
  return entries.reduce((total, entry) => total + entry.credit - entry.debit, 0)
}
