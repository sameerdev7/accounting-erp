import { describe, expect, it } from 'vitest'
import {
  amountInWords,
  formatAmount,
  formatINR,
  roundToRupee,
  splitGst,
  toPaise,
  toRupees,
} from '@/lib/money'

describe('toPaise', () => {
  it('converts rupee numbers to integer paise', () => {
    expect(toPaise(50000)).toBe(5_000_000)
    expect(toPaise(0.01)).toBe(1)
    expect(toPaise(1234.56)).toBe(123456)
  })

  it('parses user-typed strings, including Indian digit grouping', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678)
    expect(toPaise('₹ 59,000')).toBe(5_900_000)
    expect(toPaise('  1234.5 ')).toBe(123450)
    expect(toPaise('-250.25')).toBe(-25025)
  })

  it('treats blanks and junk as zero rather than NaN', () => {
    expect(toPaise('')).toBe(0)
    expect(toPaise(null)).toBe(0)
    expect(toPaise(undefined)).toBe(0)
    expect(toPaise('.')).toBe(0)
    expect(toPaise('abc')).toBe(0)
  })

  it('always returns an integer, never a float', () => {
    expect(Number.isInteger(toPaise(0.1 + 0.2))).toBe(true)
    expect(Number.isInteger(toPaise('9999999.99'))).toBe(true)
  })
})

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatAmount(12345678)).toBe('1,23,456.78')
    expect(formatINR(5_900_000)).toBe('₹59,000.00')
    expect(formatINR(-25025)).toBe('-₹250.25')
  })

  it('round-trips through toRupees', () => {
    expect(toRupees(123456)).toBe(1234.56)
  })
})

describe('roundToRupee', () => {
  it('rounds half up to the nearest whole rupee', () => {
    expect(roundToRupee(1456789)).toBe(1456800)
    expect(roundToRupee(1456749)).toBe(1456700)
    expect(roundToRupee(500)).toBe(500)
  })
})

describe('amountInWords', () => {
  it('uses the Indian lakh/crore system', () => {
    expect(amountInWords(5_900_000)).toBe('Rupees Fifty Nine Thousand Only')
    expect(amountInWords(5_000_000)).toBe('Rupees Fifty Thousand Only')
    expect(amountInWords(10_000_000)).toBe('Rupees One Lakh Only')
    expect(amountInWords(100)).toBe('Rupees One Only')
  })

  it('appends paise when present', () => {
    expect(amountInWords(123456)).toBe('Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only')
  })

  it('handles zero and negatives', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only')
    expect(amountInWords(-500)).toBe('Minus Rupees Five Only')
  })
})

describe('splitGst', () => {
  it('splits intra-state tax equally into CGST and SGST', () => {
    const result = splitGst(5_000_000, 18, false)
    expect(result.cgst).toBe(450_000)
    expect(result.sgst).toBe(450_000)
    expect(result.igst).toBe(0)
    expect(result.gstTotal).toBe(900_000)
  })

  it('charges IGST for inter-state supply', () => {
    const result = splitGst(5_000_000, 18, true)
    expect(result.igst).toBe(900_000)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
  })

  it('returns zero for a nil-rated line', () => {
    const result = splitGst(5_000_000, 0, false)
    expect(result.gstTotal).toBe(0)
  })
})
