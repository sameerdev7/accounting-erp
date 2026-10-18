import type { AccountType, NormalBalance } from './schema'

/**
 * Account codes are referenced throughout the engine, so they live in one
 * place. The engine never hard-codes a database id — services resolve these
 * codes to real account ids via `loadAccountResolver()`.
 */
export const ACC = {
  CASH: '1001',
  BANK: '1002',
  RECEIVABLE: '1003',
  INVENTORY: '1004',
  INPUT_CGST: '1005',
  INPUT_SGST: '1006',
  INPUT_IGST: '1007',
  TDS_RECEIVABLE: '1008',
  PREPAID: '1009',

  FURNITURE: '1101',
  COMPUTERS: '1102',
  VEHICLES: '1103',
  ACCUM_DEPRECIATION: '1104',

  PAYABLE: '2001',
  OUTPUT_CGST: '2002',
  OUTPUT_SGST: '2003',
  OUTPUT_IGST: '2004',
  GST_PAYABLE: '2005',
  TDS_PAYABLE: '2006',
  PF_PAYABLE: '2007',
  PT_PAYABLE: '2008',
  SALARY_PAYABLE: '2009',
  EXPENSES_PAYABLE: '2010',
  BANK_LOAN: '2101',

  SHARE_CAPITAL: '3001',
  RESERVES: '3002',
  RETAINED_EARNINGS: '3003',
  DRAWINGS: '3004',

  SALES: '4001',
  SALES_RETURNS: '4002',
  SERVICE_INCOME: '4003',
  INTEREST_INCOME: '4004',
  DISCOUNT_RECEIVED: '4005',

  PURCHASES: '5001',
  PURCHASE_RETURNS: '5002',
  COGS: '5003',
  SALARIES: '5004',
  EMPLOYER_PF: '5005',
  RENT: '5006',
  UTILITIES: '5007',
  DEPRECIATION: '5008',
  OFFICE_ADMIN: '5009',
  MARKETING: '5010',
  BANK_CHARGES: '5011',
  INTEREST_ON_LOAN: '5012',
  DISCOUNT_ALLOWED: '5013',
  ROUND_OFF: '5014',
} as const

export type AccountCode = (typeof ACC)[keyof typeof ACC]

export interface AccountSeed {
  code: string
  name: string
  type: AccountType
  normalBalance: NormalBalance
  parentCode?: string
  isControl?: boolean
  isBank?: boolean
  isCash?: boolean
  isContra?: boolean
  note?: string
}

/**
 * The 40-account chart of accounts from the specification. Party sub-ledgers
 * (one per customer and supplier) are generated on top of this during seeding.
 */
export const CHART_OF_ACCOUNTS: AccountSeed[] = [
  // ----- Assets -----------------------------------------------------------
  { code: ACC.CASH, name: 'Cash in Hand', type: 'ASSET', normalBalance: 'DEBIT', isCash: true },
  {
    code: ACC.BANK,
    name: 'Bank — HDFC Current A/c',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    isBank: true,
  },
  {
    code: ACC.RECEIVABLE,
    name: 'Accounts Receivable (Control)',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    isControl: true,
    note: 'Control account. Every customer has a sub-ledger beneath it.',
  },
  {
    code: ACC.INVENTORY,
    name: 'Inventory — Stock in Trade',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    note: 'Periodic method: untouched during the period, then set to the closing stock by the period-end inventory close.',
  },
  { code: ACC.INPUT_CGST, name: 'Input CGST', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.INPUT_SGST, name: 'Input SGST', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.INPUT_IGST, name: 'Input IGST', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.TDS_RECEIVABLE, name: 'TDS Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.PREPAID, name: 'Prepaid Expenses', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.FURNITURE, name: 'Furniture & Fixtures', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.COMPUTERS, name: 'Computers & Equipment', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: ACC.VEHICLES, name: 'Vehicles', type: 'ASSET', normalBalance: 'DEBIT' },
  {
    code: ACC.ACCUM_DEPRECIATION,
    name: 'Accumulated Depreciation',
    type: 'ASSET',
    normalBalance: 'CREDIT',
    isContra: true,
    note: 'Contra-asset: carried on the asset side and deducted from gross block.',
  },

  // ----- Liabilities ------------------------------------------------------
  {
    code: ACC.PAYABLE,
    name: 'Accounts Payable (Control)',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    isControl: true,
    note: 'Control account. Every supplier has a sub-ledger beneath it.',
  },
  { code: ACC.OUTPUT_CGST, name: 'Output CGST', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.OUTPUT_SGST, name: 'Output SGST', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.OUTPUT_IGST, name: 'Output IGST', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.GST_PAYABLE, name: 'GST Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.TDS_PAYABLE, name: 'TDS Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.PF_PAYABLE, name: 'PF Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  {
    code: ACC.PT_PAYABLE,
    name: 'Professional Tax Payable',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
  },
  { code: ACC.SALARY_PAYABLE, name: 'Salary Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.EXPENSES_PAYABLE, name: 'Expenses Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: ACC.BANK_LOAN, name: 'Bank Loan — HDFC Term Loan', type: 'LIABILITY', normalBalance: 'CREDIT' },

  // ----- Capital & equity -------------------------------------------------
  { code: ACC.SHARE_CAPITAL, name: 'Share Capital', type: 'EQUITY', normalBalance: 'CREDIT' },
  { code: ACC.RESERVES, name: 'Reserves & Surplus', type: 'EQUITY', normalBalance: 'CREDIT' },
  { code: ACC.RETAINED_EARNINGS, name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT' },
  { code: ACC.DRAWINGS, name: 'Drawings / Dividend', type: 'EQUITY', normalBalance: 'DEBIT', isContra: true },

  // ----- Income -----------------------------------------------------------
  { code: ACC.SALES, name: 'Sales — Electronics', type: 'INCOME', normalBalance: 'CREDIT' },
  {
    code: ACC.SALES_RETURNS,
    name: 'Sales Returns',
    type: 'INCOME',
    normalBalance: 'DEBIT',
    isContra: true,
    note: 'Contra-income: deducted from gross sales.',
  },
  { code: ACC.SERVICE_INCOME, name: 'Service & Installation Income', type: 'INCOME', normalBalance: 'CREDIT' },
  { code: ACC.INTEREST_INCOME, name: 'Interest Income', type: 'INCOME', normalBalance: 'CREDIT' },
  { code: ACC.DISCOUNT_RECEIVED, name: 'Discount Received', type: 'INCOME', normalBalance: 'CREDIT' },

  // ----- Expenses ---------------------------------------------------------
  {
    code: ACC.PURCHASES,
    name: 'Purchases (goods for resale)',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    note: 'Periodic method: debited by every purchase invoice for resale goods and cleared to Cost of Goods Sold by the period-end inventory close.',
  },
  {
    code: ACC.PURCHASE_RETURNS,
    name: 'Purchase Returns',
    type: 'EXPENSE',
    normalBalance: 'CREDIT',
    isContra: true,
    note: 'Retained for reference. Returns are credited straight back to Purchases.',
  },
  { code: ACC.COGS, name: 'Cost of Goods Sold', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.SALARIES, name: 'Salaries & Wages', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.EMPLOYER_PF, name: 'Employer PF Contribution', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.RENT, name: 'Rent', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.UTILITIES, name: 'Electricity & Utilities', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.DEPRECIATION, name: 'Depreciation', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.OFFICE_ADMIN, name: 'Office & Administration', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.MARKETING, name: 'Marketing & Advertising', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.BANK_CHARGES, name: 'Bank Charges', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.INTEREST_ON_LOAN, name: 'Interest on Loan', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: ACC.DISCOUNT_ALLOWED, name: 'Discount Allowed', type: 'EXPENSE', normalBalance: 'DEBIT' },
  {
    code: ACC.ROUND_OFF,
    name: 'Round-off',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    note: 'Absorbs the paise difference created when an invoice total is rounded to the nearest rupee.',
  },
]

export const EXPENSE_ACCOUNTS = CHART_OF_ACCOUNTS.filter((account) => account.type === 'EXPENSE')
export const INCOME_ACCOUNTS = CHART_OF_ACCOUNTS.filter((account) => account.type === 'INCOME')
export const ASSET_ACCOUNTS = CHART_OF_ACCOUNTS.filter((account) => account.type === 'ASSET')

/** GST slabs used for item master validation. */
export const GST_RATES = [0, 5, 12, 18, 28] as const

/** Indian state codes, used for the GSTIN and place-of-supply logic. */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
}

export const STATE_NAMES = Object.values(STATE_CODES).sort()

export function stateCodeFor(stateName: string): string {
  const entry = Object.entries(STATE_CODES).find(
    ([, name]) => name.toLowerCase() === stateName.trim().toLowerCase(),
  )
  return entry ? entry[0] : ''
}
