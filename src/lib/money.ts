/**
 * Money helpers.
 *
 * ---------------------------------------------------------------------------
 * GOLDEN RULE: every monetary value in this application is an INTEGER number
 * of paise. Never store, compute with, or pass around rupee floats. 1 rupee =
 * 100 paise.
 *
 * All arithmetic helpers here assert integer paise so that a stray float is
 * caught during development rather than silently corrupting a trial balance.
 * ---------------------------------------------------------------------------
 */

/** An integer amount in paise. */
export type Paise = number

export const PAISE_PER_RUPEE = 100

/** Convert a rupee figure (number or user-typed string) into integer paise. */
export function toPaise(input: number | string | null | undefined): Paise {
  if (input === null || input === undefined || input === '') return 0

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0
    return Math.round(input * PAISE_PER_RUPEE)
  }

  const cleaned = input.trim().replace(/[,\s₹]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return 0

  const negative = cleaned.startsWith('-')
  const unsigned = negative ? cleaned.slice(1) : cleaned
  const [intPart = '0', fracPart = ''] = unsigned.split('.')

  const intDigits = intPart.replace(/\D/g, '') || '0'
  const fracDigits = (fracPart.replace(/\D/g, '') + '00').slice(0, 2)

  const value = Number(intDigits) * PAISE_PER_RUPEE + Number(fracDigits)
  if (!Number.isFinite(value)) return 0
  return negative ? -value : value
}

/** Convert integer paise back to a rupee number (for charts / display only). */
export function toRupees(paise: Paise): number {
  return paise / PAISE_PER_RUPEE
}

/** Round a paise amount to the nearest whole rupee. */
export function roundToRupee(paise: Paise): Paise {
  return Math.round(paise / PAISE_PER_RUPEE) * PAISE_PER_RUPEE
}

/** The amount of rounding that roundToRupee() would apply. */
export function roundingDifference(paise: Paise): Paise {
  return roundToRupee(paise) - paise
}

export function assertIntegerPaise(value: Paise, label = 'amount'): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of paise, received ${value}`)
  }
}

/** Sum paise, rejecting any non-integer input. */
export function sumPaise(values: Paise[]): Paise {
  let total = 0
  for (const value of values) {
    assertIntegerPaise(value)
    total += value
  }
  return total
}

export function isZero(value: Paise): boolean {
  return value === 0
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const inrFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const plainFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** "1234567.5" rupees -> "12,34,567.50" (Indian digit grouping, no symbol). */
export function formatAmount(paise: Paise): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}${inrFormatter.format(Math.abs(paise) / PAISE_PER_RUPEE)}`
}

/** Indian digit grouping without forcing 2 decimal places. */
export function formatAmountShort(paise: Paise): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}${plainFormatter.format(Math.abs(paise) / PAISE_PER_RUPEE)}`
}

/** "₹12,34,567.50" — the sign is emitted once, in front of the symbol. */
export function formatINR(paise: Paise): string {
  return `${paise < 0 ? '-' : ''}₹${formatAmount(Math.abs(paise))}`
}

/** Compact Indian notation for dashboards: ₹9.50 K, ₹1.25 L, ₹2.10 Cr */
export function formatCompactINR(paise: Paise): string {
  const sign = paise < 0 ? '-' : ''
  const rupees = Math.abs(paise) / PAISE_PER_RUPEE
  if (rupees >= 10_000_000) return `${sign}₹${(rupees / 10_000_000).toFixed(2)} Cr`
  if (rupees >= 100_000) return `${sign}₹${(rupees / 100_000).toFixed(2)} L`
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)} K`
  return `${sign}₹${rupees.toFixed(2)}`
}

/** Format a plain rupee quantity (not paise) with Indian grouping. */
export function formatRupees(rupees: number, decimals = 2): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rupees)
}

/** Format a non-money number, e.g. quantities. */
export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering system) — required on printed vouchers
// ---------------------------------------------------------------------------

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return TENS[tens] + (ones ? ` ${ONES[ones]}` : '')
}

function threeDigitWords(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const head = hundreds ? `${ONES[hundreds]} Hundred${rest ? ' ' : ''}` : ''
  return `${head}${rest ? twoDigitWords(rest) : ''}`
}

function integerToIndianWords(value: number): string {
  if (value === 0) return 'Zero'

  const parts: string[] = []
  let remaining = value

  const crore = Math.floor(remaining / 10_000_000)
  remaining %= 10_000_000

  const lakh = Math.floor(remaining / 100_000)
  remaining %= 100_000

  const thousand = Math.floor(remaining / 1_000)
  remaining %= 1_000

  if (crore) parts.push(`${threeDigitWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`)
  if (remaining) parts.push(threeDigitWords(remaining))

  return parts.join(' ')
}

/** "Rupees Fifty Nine Thousand Only" / "Rupees ... and Fifty Paise Only" */
export function amountInWords(paise: Paise): string {
  const negative = paise < 0
  const absolute = Math.abs(Math.round(paise))
  const rupees = Math.floor(absolute / PAISE_PER_RUPEE)
  const paisePart = absolute % PAISE_PER_RUPEE

  let words = `Rupees ${integerToIndianWords(rupees)}`
  if (paisePart) words += ` and ${twoDigitWords(paisePart)} Paise`
  if (negative) words = `Minus ${words}`

  return `${words} Only`
}

// ---------------------------------------------------------------------------
// GST helpers
// ---------------------------------------------------------------------------

/**
 * GST is computed on the taxable value and split into CGST+SGST (intra-state)
 * or IGST (inter-state). Each component is rounded to the nearest paise; the
 * invoice total is then rounded to the nearest rupee and the difference is
 * posted to the Round-off account.
 */
export function splitGst(taxable: Paise, gstRatePercent: number, interState: boolean): {
  cgst: Paise
  sgst: Paise
  igst: Paise
  gstTotal: Paise
} {
  if (!gstRatePercent) return { cgst: 0, sgst: 0, igst: 0, gstTotal: 0 }

  const rawGst = (taxable * gstRatePercent) / 100

  if (interState) {
    const igst = Math.round(rawGst)
    return { cgst: 0, sgst: 0, igst, gstTotal: igst }
  }

  const half = rawGst / 2
  const cgst = Math.round(half)
  const sgst = Math.round(half)
  return { cgst, sgst, igst: 0, gstTotal: cgst + sgst }
}
