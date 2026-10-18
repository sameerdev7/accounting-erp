import { describe, expect, it } from 'vitest'
import { computeInvoiceGst, isInterState, summariseGst } from '@/engine/gst'
import { toPaise } from '@/lib/money'

describe('isInterState', () => {
  it('treats a same-state supply as intra-state', () => {
    expect(isInterState('Maharashtra', 'Maharashtra')).toBe(false)
    expect(isInterState('maharashtra', ' Maharashtra ')).toBe(false)
  })

  it('treats a different state as inter-state', () => {
    expect(isInterState('Maharashtra', 'Karnataka')).toBe(true)
  })

  it('defaults to intra-state when the party state is unknown', () => {
    expect(isInterState('Maharashtra', '')).toBe(false)
    expect(isInterState('Maharashtra', undefined)).toBe(false)
  })
})

describe('computeInvoiceGst', () => {
  it('computes an intra-state invoice that needs no rounding', () => {
    const gst = computeInvoiceGst([{ taxable: toPaise(50000), gstRate: 18 }], false)
    expect(gst.taxable).toBe(5_000_000)
    expect(gst.cgst).toBe(450_000)
    expect(gst.sgst).toBe(450_000)
    expect(gst.gstTotal).toBe(900_000)
    expect(gst.roundOff).toBe(0)
    expect(gst.total).toBe(5_900_000)
  })

  it('computes an inter-state invoice using IGST', () => {
    const gst = computeInvoiceGst([{ taxable: toPaise(50000), gstRate: 18 }], true)
    expect(gst.igst).toBe(900_000)
    expect(gst.cgst).toBe(0)
    expect(gst.total).toBe(5_900_000)
  })

  it('rounds the invoice total to the rupee and reports the difference', () => {
    const gst = computeInvoiceGst([{ taxable: 1_234_567, gstRate: 18 }], false)
    // 12,345.67 + 18% = 14,567.89 -> rounds to 14,568.00
    expect(gst.subTotal).toBe(1_456_789)
    expect(gst.total).toBe(1_456_800)
    expect(gst.roundOff).toBe(11)
    expect(gst.subTotal + gst.roundOff).toBe(gst.total)
  })

  it('mixes nil-rated and standard-rated lines', () => {
    const gst = computeInvoiceGst(
      [
        { taxable: toPaise(10000), gstRate: 0 },
        { taxable: toPaise(10000), gstRate: 12 },
      ],
      false,
    )
    expect(gst.taxable).toBe(2_000_000)
    expect(gst.cgst).toBe(60_000)
    expect(gst.sgst).toBe(60_000)
    expect(gst.total).toBe(2_120_000)
  })

  it('always reconciles total = taxable + tax + roundOff', () => {
    const gst = computeInvoiceGst(
      [
        { taxable: 99_999, gstRate: 28 },
        { taxable: 45_555, gstRate: 5 },
      ],
      true,
    )
    expect(gst.taxable + gst.gstTotal + gst.roundOff).toBe(gst.total)
  })
})

describe('summariseGst', () => {
  it('computes a net payable position', () => {
    const summary = summariseGst({
      outputCgst: 100_000,
      outputSgst: 100_000,
      outputIgst: 50_000,
      inputCgst: 40_000,
      inputSgst: 40_000,
      inputIgst: 10_000,
    })
    expect(summary.outputTotal).toBe(250_000)
    expect(summary.inputTotal).toBe(90_000)
    expect(summary.netPayable).toBe(160_000)
  })

  it('reports a negative net as credit carried forward', () => {
    const summary = summariseGst({
      outputCgst: 0,
      outputSgst: 0,
      outputIgst: 0,
      inputCgst: 40_000,
      inputSgst: 40_000,
      inputIgst: 0,
    })
    expect(summary.netPayable).toBe(-80_000)
  })
})
