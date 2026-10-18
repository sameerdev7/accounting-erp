import { roundToRupee, splitGst, type Paise } from '@/lib/money'

/**
 * Place of supply rules (section 7.2 of the specification):
 *   company state === party state  ->  CGST + SGST, half the rate each
 *   otherwise                      ->  IGST at the full rate
 *
 * State comparison is name-based and case-insensitive. When the party's state
 * is unknown we treat the supply as intra-state, which is the conservative
 * choice for an Indian trading company.
 */
export function isInterState(companyState: string, partyState: string | undefined | null): boolean {
  if (!partyState) return false
  return normaliseState(companyState) !== normaliseState(partyState)
}

function normaliseState(state: string): string {
  return state.trim().toLowerCase().replace(/\s+/g, ' ').replace(/&/g, 'and')
}

export interface GstLineInput {
  /** Taxable value of the line, in paise */
  taxable: Paise
  /** GST percentage for the line, e.g. 18 */
  gstRate: number
}

export interface InvoiceGst {
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  gstTotal: Paise
  /** taxable + all tax components, before rounding to the rupee */
  subTotal: Paise
  /** Rounded-to-rupee total minus subTotal; posted to the Round-off account */
  roundOff: Paise
  /** The amount the customer owes / we owe the supplier */
  total: Paise
  interState: boolean
}

/**
 * Computes GST for a whole invoice. Tax is derived line by line (each component
 * rounded to the nearest paisa), then the invoice total is rounded to the
 * nearest rupee and the difference is reported as `roundOff`.
 */
export function computeInvoiceGst(lines: GstLineInput[], interState: boolean): InvoiceGst {
  let taxable = 0
  let cgst = 0
  let sgst = 0
  let igst = 0

  for (const line of lines) {
    const component = splitGst(line.taxable, line.gstRate, interState)
    taxable += line.taxable
    cgst += component.cgst
    sgst += component.sgst
    igst += component.igst
  }

  const gstTotal = cgst + sgst + igst
  const subTotal = taxable + gstTotal
  const total = roundToRupee(subTotal)

  return {
    taxable,
    cgst,
    sgst,
    igst,
    gstTotal,
    subTotal,
    roundOff: total - subTotal,
    total,
    interState,
  }
}

/** Tax component for a single line, exposed for invoice-line storage. */
export function lineTax(
  taxable: Paise,
  gstRate: number,
  interState: boolean,
): { cgst: Paise; sgst: Paise; igst: Paise } {
  const { cgst, sgst, igst } = splitGst(taxable, gstRate, interState)
  return { cgst, sgst, igst }
}

/** Snapshot of the GST returns position for a period. */
export interface GstSummary {
  outputCgst: Paise
  outputSgst: Paise
  outputIgst: Paise
  inputCgst: Paise
  inputSgst: Paise
  inputIgst: Paise
  outputTotal: Paise
  inputTotal: Paise
  /** Positive = payable to the government, negative = credit carried forward */
  netPayable: Paise
}

export function summariseGst(parts: {
  outputCgst: Paise
  outputSgst: Paise
  outputIgst: Paise
  inputCgst: Paise
  inputSgst: Paise
  inputIgst: Paise
}): GstSummary {
  const outputTotal = parts.outputCgst + parts.outputSgst + parts.outputIgst
  const inputTotal = parts.inputCgst + parts.inputSgst + parts.inputIgst
  return {
    ...parts,
    outputTotal,
    inputTotal,
    netPayable: outputTotal - inputTotal,
  }
}

/** GSTIN shape check: 2-digit state code + 10-char PAN + entity + Z + checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export function isValidGstin(gstin: string): boolean {
  if (!gstin) return true // optional
  return GSTIN_PATTERN.test(gstin.trim().toUpperCase())
}
