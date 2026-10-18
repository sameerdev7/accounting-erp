import { addMonths, eachMonthOfInterval, endOfMonth, format, getDaysInMonth, parseISO } from 'date-fns'

/**
 * The company's financial year starts on 1 April (Indian convention). Every
 * helper here is expressed in terms of `startMonth` (1 = January, 4 = April) so
 * the convention is configurable from the company master rather than hard-coded.
 */
export const DEFAULT_FY_START_MONTH = 4

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 'yyyy-MM-dd' -> 'YYYY-MM' */
export function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7)
}

/** 'YYYY-MM' -> 'yyyy-MM-dd' for the first day of that month. */
export function monthStartISO(key: string): string {
  return `${key}-01`
}

/** 'YYYY-MM' -> 'yyyy-MM-dd' for the last day of that month. */
export function monthEndISO(key: string): string {
  const date = parseISO(`${key}-01`)
  return format(endOfMonth(date), 'yyyy-MM-dd')
}

export function daysInMonth(key: string): number {
  const [year, month] = key.split('-').map(Number)
  return getDaysInMonth(new Date(year, month - 1, 1))
}

/** The calendar year in which the financial year containing `dateISO` began. */
export function fyStartYear(dateISO: string, startMonth = DEFAULT_FY_START_MONTH): number {
  const date = parseISO(dateISO)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  return month >= startMonth ? year : year - 1
}

export interface FinancialYear {
  /** First day, e.g. '2025-04-01' */
  start: string
  /** Last day, e.g. '2026-03-31' */
  end: string
  /** Calendar year the FY began, e.g. 2025 */
  startYear: number
  /** Sequence key used by the numbering engine, e.g. '2526' */
  key: string
  /** Human label, e.g. 'FY 2025-26' */
  label: string
}

export function financialYearOf(
  dateISO: string,
  startMonth = DEFAULT_FY_START_MONTH,
): FinancialYear {
  const startYear = fyStartYear(dateISO, startMonth)
  const start = `${startYear}-${pad2(startMonth)}-01`
  const endYear = startMonth === 1 ? startYear : startYear + 1
  const end = format(new Date(endYear, startMonth - 1, 0), 'yyyy-MM-dd')
  const shortStart = String(startYear).slice(2)
  const shortEnd = String(endYear).slice(2)

  return {
    start,
    end,
    startYear,
    key: `${shortStart}${shortEnd}`,
    label: `FY ${startYear}-${shortEnd}`,
  }
}

export function currentFinancialYear(
  reference: string = format(new Date(), 'yyyy-MM-dd'),
  startMonth = DEFAULT_FY_START_MONTH,
): FinancialYear {
  return financialYearOf(reference, startMonth)
}

/** All month keys ('YYYY-MM') inside a financial year, in chronological order. */
export function monthsInFinancialYear(
  fy: FinancialYear,
  startMonth = DEFAULT_FY_START_MONTH,
): string[] {
  const start = parseISO(fy.start)
  const end = parseISO(fy.end)
  return eachMonthOfInterval({ start, end }).map((date) => format(date, 'yyyy-MM'))
}

export function addMonthsKey(key: string, months: number): string {
  return format(addMonths(parseISO(`${key}-01`), months), 'yyyy-MM')
}

/** True when `dateISO` falls inside the financial year (inclusive). */
export function isWithinFinancialYear(dateISO: string, fy: FinancialYear): boolean {
  return dateISO >= fy.start && dateISO <= fy.end
}

export function compareDescDate(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0
}

export function inRange(dateISO: string, from: string, to: string): boolean {
  return dateISO >= from && dateISO <= to
}
