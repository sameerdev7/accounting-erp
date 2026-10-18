import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'

/** Today as 'yyyy-MM-dd' using local time (not UTC). */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** 'yyyy-MM-dd' -> '18-Oct-2026' */
export function formatDate(dateISO: string | undefined | null): string {
  if (!dateISO) return '—'
  const date = parseISO(dateISO)
  if (!isValid(date)) return '—'
  return format(date, 'dd-MMM-yyyy')
}

/** 'yyyy-MM-dd' -> '18 Oct 2026' */
export function formatDateLong(dateISO: string | undefined | null): string {
  if (!dateISO) return '—'
  const date = parseISO(dateISO)
  if (!isValid(date)) return '—'
  return format(date, 'dd MMM yyyy')
}

/** 'yyyy-MM-ddTHH:mm:ss.sssZ' -> '18-Oct-2026 14:32' */
export function formatDateTime(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (!isValid(date)) return '—'
  return format(date, 'dd-MMM-yyyy HH:mm')
}

export function relativeTime(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (!isValid(date)) return '—'
  return `${formatDistanceToNowStrict(date)} ago`
}

/** '2025-04' -> 'Apr 2025' */
export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  if (!year || !month) return monthKey
  const date = new Date(Number(year), Number(month) - 1, 1)
  return format(date, 'MMM yyyy')
}

/** '2025-04' -> 'Apr 25' (compact, for chart axes) */
export function formatMonthShort(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  if (!year || !month) return monthKey
  const date = new Date(Number(year), Number(month) - 1, 1)
  return format(date, 'MMM yy')
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Friendly label for SCREAMING_SNAKE enum values: 'PURCHASE_OFFICER' -> 'Purchase Officer' */
export function labelize(value: string | undefined | null): string {
  if (!value) return '—'
  return titleCase(value)
}
