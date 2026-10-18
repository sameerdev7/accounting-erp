# Sample Journal Entries

This document works through the posting rules in section 7.1 of the architecture
specification using the real account codes from `src/db/coa.ts` and the real
posting functions in `src/engine/posting.ts`. Every entry is shown as a
`Date | Particulars | Account code | Debit | Credit` table and is followed by an
explicit statement of the two column totals so the arithmetic can be checked.

## How to read these entries

- **Money.** Internally every amount is an integer number of paise (`Paise`, from
  `src/lib/money.ts`), where ₹1 = 100 paise. The tables below are shown in rupees
  for readability; for example ₹50,000.00 is stored as `5,000,000` paise. Because
  the figures chosen here are whole rupees, each rupee column total is also an
  exact whole number of rupees.
- **Account codes.** Codes such as `1004`, `2002` and `5004` are the real
  constants in `src/db/coa.ts` (`ACC.INVENTORY`, `ACC.OUTPUT_CGST`,
  `ACC.SALARIES`). The number in front of a dot is the control account; a code
  written `1003·C04` or `2001·S02` denotes the **party sub-ledger** that the
  seeding step generates beneath that control account — one per customer under
  `1003` Accounts Receivable and one per supplier under `2001` Accounts Payable.
- **Balancing rule.** Each entry was produced by the corresponding poster in
  `src/engine/posting.ts`, and every poster calls `assertBalanced` in
  `src/engine/validators.ts`, so **total debits = total credits** for every entry.
- **GST split.** `splitGst` in `src/lib/money.ts` gives half the tax rate as
  CGST and half as SGST for an intra-state supply, or the full rate as IGST for
  an inter-state supply, decided by `isInterState` in `src/engine/gst.ts`. A
  same-state supply of ₹50,000 at 18% therefore becomes ₹4,500 CGST plus ₹4,500
  SGST; a different-state supply becomes ₹9,000 IGST.
- **Dates.** The examples sit in financial year 2026-27 (`FY 2026-27`, sequence
  key `2627`).

---

## 1. Intra-state purchase — ₹50,000 + 18% GST

Goods are bought for resale from a Maharashtra supplier and received into
inventory. The periodic method debits `5001` Purchases, matching
`postPurchaseInvoice`. (Inventory `1004` is only written at the period-end
close, from the goods movements.)

GST: ₹50,000 × 18% = ₹9,000, split ₹4,500 CGST + ₹4,500 SGST. Total = ₹59,000.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-05 | Purchases — goods for resale | 5001 | 50,000.00 | |
| 2026-04-05 | Input CGST at 9% | 1005 | 4,500.00 | |
| 2026-04-05 | Input SGST at 9% | 1006 | 4,500.00 | |
| 2026-04-05 | Techno Distributors (supplier sub-ledger under 2001) | 2001·S02 | | 59,000.00 |
| | **Total** | | **59,000.00** | **59,000.00** |

**Balances:** debits ₹50,000 + ₹4,500 + ₹4,500 = **₹59,000.00**; credits
**₹59,000.00**. Balanced.

---

## 2. Inter-state purchase — ₹50,000 + 18% IGST

The same purchase from a Karnataka supplier attracts IGST instead of CGST/SGST.

GST: ₹50,000 × 18% = ₹9,000 IGST. Total = ₹59,000.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-08 | Purchases — goods for resale | 5001 | 50,000.00 | |
| 2026-04-08 | Input IGST at 18% | 1007 | 9,000.00 | |
| 2026-04-08 | Karnataka supplier (sub-ledger under 2001) | 2001·S05 | | 59,000.00 |
| | **Total** | | **59,000.00** | **59,000.00** |

**Balances:** debits ₹50,000 + ₹9,000 = **₹59,000.00**; credits **₹59,000.00**.
Balanced.

---

## 3. Intra-state sale — ₹80,000 + 18% GST

Goods are sold on credit to a Maharashtra customer (`postSalesInvoice`).

GST: ₹80,000 × 18% = ₹14,400, split ₹7,200 CGST + ₹7,200 SGST.
Total invoice = ₹94,400.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-12 | Rahul Traders (customer sub-ledger under 1003) | 1003·C04 | 94,400.00 | |
| 2026-04-12 | Sales — Electronics | 4001 | | 80,000.00 |
| 2026-04-12 | Output CGST at 9% | 2002 | | 7,200.00 |
| 2026-04-12 | Output SGST at 9% | 2003 | | 7,200.00 |
| | **Total** | | **94,400.00** | **94,400.00** |

**Balances:** debits **₹94,400.00**; credits ₹80,000 + ₹7,200 + ₹7,200 =
**₹94,400.00**. Balanced.

### 3a. Service invoice — ₹4,500 + 18% GST

Services are billed straight off a tax invoice with no order, delivery or stock movement, and their
taxable value is credited to Service Income (`4003`) instead of Sales (`4001`).

GST: ₹4,500 × 18% = ₹810, split ₹405 CGST + ₹405 SGST. Total invoice = ₹5,310.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-20 | Rahul Traders (customer sub-ledger under 1003) | 1003·C04 | 5,310.00 | |
| 2026-04-20 | Service Income — AMC & installation | 4003 | | 4,500.00 |
| 2026-04-20 | Output CGST at 9% | 2002 | | 405.00 |
| 2026-04-20 | Output SGST at 9% | 2003 | | 405.00 |
| | **Total** | | **5,310.00** | **5,310.00** |

**Balances:** debits **₹5,310.00**; credits ₹4,500 + ₹405 + ₹405 = **₹5,310.00**. Balanced.


**Cost of goods sold (periodic).** Nothing is posted to the ledger when the
goods leave the warehouse; quantity is tracked in the goods movements. The cost
of the goods sold is recognised once at the period-end close, as
`opening stock + purchases − closing stock`, by `postInventoryClosing`. Assuming
an opening stock of ₹40,000, purchases of ₹1,00,000 and a closing stock of
₹30,000:

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-30 | Cost of Goods Sold — opening stock | 5003 | 40,000.00 | |
| 2026-04-30 | Inventory — opening stock cleared | 1004 | | 40,000.00 |
| 2026-04-30 | Cost of Goods Sold — purchases | 5003 | 1,00,000.00 | |
| 2026-04-30 | Purchases — cleared for the period | 5001 | | 1,00,000.00 |
| 2026-04-30 | Inventory — closing stock carried forward | 1004 | 30,000.00 | |
| 2026-04-30 | Cost of Goods Sold — closing stock | 5003 | | 30,000.00 |
| | **Total** | | **1,70,000.00** | **1,70,000.00** |

**Balances:** debits ₹40,000 + ₹1,00,000 + ₹30,000 = **₹1,70,000.00**; credits
**₹1,70,000.00**. Balanced. Net cost of goods sold = ₹40,000 + ₹1,00,000 −
₹30,000 = **₹1,10,000.00**. The closing stock is the weighted-average valuation
of the goods remaining, computed by `inventoryValueAsOf` in
`src/services/inventory.ts`.

---

## 4. Inter-state sale — ₹80,000 + 18% IGST

The same sale to a customer in Tamil Nadu attracts IGST.

GST: ₹80,000 × 18% = ₹14,400 IGST. Total invoice = ₹94,400.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-15 | Chennai customer (sub-ledger under 1003) | 1003·C07 | 94,400.00 | |
| 2026-04-15 | Sales — Electronics | 4001 | | 80,000.00 |
| 2026-04-15 | Output IGST at 18% | 2004 | | 14,400.00 |
| | **Total** | | **94,400.00** | **94,400.00** |

**Balances:** debits **₹94,400.00**; credits ₹80,000 + ₹14,400 = **₹94,400.00**.
Balanced.

---

## 5. Receipt from a customer

The customer pays the full intra-state invoice of ₹94,400 by bank transfer
(`postReceipt`: Dr Bank/Cash · Cr customer sub-ledger).

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-20 | Bank — HDFC Current A/c | 1002 | 94,400.00 | |
| 2026-04-20 | Rahul Traders (sub-ledger under 1003) | 1003·C04 | | 94,400.00 |
| | **Total** | | **94,400.00** | **94,400.00** |

**Balances:** debits **₹94,400.00**; credits **₹94,400.00**. Balanced. The
`allocations` row links this receipt voucher to invoice `INV/2627/0012` for the
same ₹94,400, which clears the customer's outstanding balance.

---

## 6. Payment to a supplier

The full intra-state purchase invoice of ₹59,000 is settled by NEFT (`postPayment`:
Dr supplier sub-ledger · Cr Bank/Cash).

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-22 | Techno Distributors (sub-ledger under 2001) | 2001·S02 | 59,000.00 | |
| 2026-04-22 | Bank — HDFC Current A/c | 1002 | | 59,000.00 |
| | **Total** | | **59,000.00** | **59,000.00** |

**Balances:** debits **₹59,000.00**; credits **₹59,000.00**. Balanced.

---

## 7. Sales return — Credit Note

A customer returns goods invoiced at ₹5,000 plus 18% GST. The credit note
reverses the original sale (`postSalesReturn`): Dr Sales Returns and the output
GST accounts · Cr customer.

GST: ₹5,000 × 18% = ₹900, split ₹450 CGST + ₹450 SGST. Total credit = ₹5,900.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-25 | Sales Returns (contra-income) | 4002 | 5,000.00 | |
| 2026-04-25 | Output CGST reversed | 2002 | 450.00 | |
| 2026-04-25 | Output SGST reversed | 2003 | 450.00 | |
| 2026-04-25 | Rahul Traders (sub-ledger under 1003) | 1003·C04 | | 5,900.00 |
| | **Total** | | **5,900.00** | **5,900.00** |

**Balances:** debits ₹5,000 + ₹450 + ₹450 = **₹5,900.00**; credits **₹5,900.00**.
Balanced.

**Inventory.** No ledger entry is posted when the goods come back. The return is
recorded as a goods movement (a `RETURN_IN` at the weighted-average cost), so
the quantity is right and the next period-end close values whatever is on hand.

---

## 8. Purchase return — Debit Note

Goods bought at ₹5,000 plus 18% GST are returned to the supplier
(`postPurchaseReturn`): Dr supplier · Cr Purchases (the account the invoice
debited) and the input GST accounts.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-26 | Techno Distributors (sub-ledger under 2001) | 2001·S02 | 5,900.00 | |
| 2026-04-26 | Purchases — returned | 5001 | | 5,000.00 |
| 2026-04-26 | Input CGST reversed | 1005 | | 450.00 |
| 2026-04-26 | Input SGST reversed | 1006 | | 450.00 |
| | **Total** | | **5,900.00** | **5,900.00** |

**Balances:** debits **₹5,900.00**; credits ₹5,000 + ₹450 + ₹450 = **₹5,900.00**.
Balanced.

---

## 9. Contra entry — cash deposited into bank

₹25,000 in cash is deposited into the bank (`postContra`: Dr Bank · Cr Cash).

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-28 | Bank — HDFC Current A/c | 1002 | 25,000.00 | |
| 2026-04-28 | Cash in Hand | 1001 | | 25,000.00 |
| | **Total** | | **25,000.00** | **25,000.00** |

**Balances:** debits **₹25,000.00**; credits **₹25,000.00**. Balanced.

---

## 10. Salary run — PF 12%, professional tax and TDS

A single employee for the month of April 2026:

- Basic ₹30,000 + HRA ₹12,000 + allowances ₹8,000 = **gross ₹50,000**
- Employee PF at 12% of basic = 12% × ₹30,000 = **₹3,600**
- Employer PF (matching) = **₹3,600**
- Professional tax = **₹200**
- TDS on salary = **₹3,000**
- Other deductions = ₹0
- **Net payable = ₹50,000 − ₹3,600 − ₹200 − ₹3,000 = ₹43,200**

`postPayroll` recomputes the net itself and refuses to post unless it agrees.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-30 | Salaries & Wages (gross) | 5004 | 50,000.00 | |
| 2026-04-30 | Employer PF Contribution | 5005 | 3,600.00 | |
| 2026-04-30 | PF Payable (₹3,600 employee + ₹3,600 employer) | 2007 | | 7,200.00 |
| 2026-04-30 | Professional Tax Payable | 2008 | | 200.00 |
| 2026-04-30 | TDS Payable | 2006 | | 3,000.00 |
| 2026-04-30 | Salary Payable (net) | 2009 | | 43,200.00 |
| | **Total** | | **53,600.00** | **53,600.00** |

**Balances:** debits ₹50,000 + ₹3,600 = **₹53,600.00**; credits
₹7,200 + ₹200 + ₹3,000 + ₹43,200 = **₹53,600.00**. Balanced.

---

## 11. Salary payment

The net salary of ₹43,200 is paid through the bank (`postSalaryPayment`:
Dr Salary Payable · Cr Bank).

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-04-30 | Salary Payable | 2009 | 43,200.00 | |
| 2026-04-30 | Bank — HDFC Current A/c | 1002 | | 43,200.00 |
| | **Total** | | **43,200.00** | **43,200.00** |

**Balances:** debits **₹43,200.00**; credits **₹43,200.00**. Balanced.

**Related statutory remittance** (`postStatutoryPayment`) — paying the withheld
dues to the government:

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-05-10 | PF Payable | 2007 | 7,200.00 | |
| 2026-05-10 | Professional Tax Payable | 2008 | 200.00 | |
| 2026-05-10 | TDS Payable | 2006 | 3,000.00 | |
| 2026-05-10 | Bank — HDFC Current A/c | 1002 | | 10,400.00 |
| | **Total** | | **10,400.00** | **10,400.00** |

**Balances:** debits ₹7,200 + ₹200 + ₹3,000 = **₹10,400.00**; credits
**₹10,400.00**. Balanced.

---

## 12. Asset purchase

Office computers are bought for ₹1,00,000 plus 18% intra-state GST and
capitalised (`postPurchaseInvoice` with the fixed-asset account `1102` as the
debit account).

GST: ₹1,00,000 × 18% = ₹18,000, split ₹9,000 CGST + ₹9,000 SGST.
Total = ₹1,18,000.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-05-02 | Computers & Equipment | 1102 | 1,00,000.00 | |
| 2026-05-02 | Input CGST at 9% | 1005 | 9,000.00 | |
| 2026-05-02 | Input SGST at 9% | 1006 | 9,000.00 | |
| 2026-05-02 | Vendor (sub-ledger under 2001) | 2001·S07 | | 1,18,000.00 |
| | **Total** | | **1,18,000.00** | **1,18,000.00** |

**Balances:** debits ₹1,00,000 + ₹9,000 + ₹9,000 = **₹1,18,000.00**; credits
**₹1,18,000.00**. Balanced.

---

## 13. Depreciation

Straight-line depreciation on the computers: cost ₹3,00,000, useful life 5 years,
no salvage value. Annual charge = ₹3,00,000 ÷ 5 = ₹60,000; monthly charge =
₹60,000 ÷ 12 = **₹5,000**. `postDepreciation`: Dr Depreciation · Cr Accumulated
Depreciation.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-05-31 | Depreciation for the month | 5008 | 5,000.00 | |
| 2026-05-31 | Accumulated Depreciation (contra-asset) | 1104 | | 5,000.00 |
| | **Total** | | **5,000.00** | **5,000.00** |

**Balances:** debits **₹5,000.00**; credits **₹5,000.00**. Balanced.

---

## 14. GST settlement for the period

Using the April figures above: output CGST ₹7,200, output SGST ₹7,200,
output IGST nil; input CGST ₹4,500, input SGST ₹4,500, input IGST nil.

Output tax = ₹7,200 + ₹7,200 = ₹14,400. Input credit = ₹4,500 + ₹4,500 = ₹9,000.
**Net GST payable = ₹14,400 − ₹9,000 = ₹5,400.**

`postGstSettlement` debits the output accounts to extinguish the liability,
credits the input accounts to claim the credit, and posts the net to `2005` GST
Payable.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-05-31 | Output CGST cleared | 2002 | 7,200.00 | |
| 2026-05-31 | Output SGST cleared | 2003 | 7,200.00 | |
| 2026-05-31 | Input CGST claimed | 1005 | | 4,500.00 |
| 2026-05-31 | Input SGST claimed | 1006 | | 4,500.00 |
| 2026-05-31 | GST Payable (net) | 2005 | | 5,400.00 |
| | **Total** | | **14,400.00** | **14,400.00** |

**Balances:** debits ₹7,200 + ₹7,200 = **₹14,400.00**; credits
₹4,500 + ₹4,500 + ₹5,400 = **₹14,400.00**. Balanced. (Any IGST legs would be
cleared on `2004` and `1007`; they are absent here because both the purchase and
the sale were intra-state.)

**Related GST payment:**

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-06-20 | GST Payable | 2005 | 5,400.00 | |
| 2026-06-20 | Bank — HDFC Current A/c | 1002 | | 5,400.00 |
| | **Total** | | **5,400.00** | **5,400.00** |

**Balances:** debits **₹5,400.00**; credits **₹5,400.00**. Balanced.

---

## 15. Rent — ₹20,000 with 10% TDS

Office rent of ₹20,000 is payable; 10% tax is withheld at source and the net is
paid by bank. `postExpense`: Dr Rent (gross) · Cr TDS Payable · Cr Bank (net).

TDS = ₹20,000 × 10% = ₹2,000. Net paid = ₹20,000 − ₹2,000 = ₹18,000.

| Date | Particulars | Account code | Debit (₹) | Credit (₹) |
|---|---|---|---|---|
| 2026-05-31 | Rent | 5006 | 20,000.00 | |
| 2026-05-31 | TDS Payable (10% withheld) | 2006 | | 2,000.00 |
| 2026-05-31 | Bank — HDFC Current A/c (net paid) | 1002 | | 18,000.00 |
| | **Total** | | **20,000.00** | **20,000.00** |

**Balances:** debits **₹20,000.00**; credits ₹2,000 + ₹18,000 = **₹20,000.00**.
Balanced.

---

## Summary of totals

Every entry above records equal totals on the two sides. Collected together:

| # | Entry | Total debit (₹) | Total credit (₹) |
|---|---|---|---|
| 1 | Intra-state purchase | 59,000.00 | 59,000.00 |
| 2 | Inter-state purchase | 59,000.00 | 59,000.00 |
| 3 | Intra-state sale | 94,400.00 | 94,400.00 |
| 3a | Service invoice | 5,310.00 | 5,310.00 |
| 3b | Period-end inventory close (COGS + closing stock) | 1,70,000.00 | 1,70,000.00 |
| 4 | Inter-state sale | 94,400.00 | 94,400.00 |
| 5 | Receipt from customer | 94,400.00 | 94,400.00 |
| 6 | Payment to supplier | 59,000.00 | 59,000.00 |
| 7 | Sales return (Credit Note) | 5,900.00 | 5,900.00 |
| 8 | Purchase return (Debit Note) | 5,900.00 | 5,900.00 |
| 9 | Contra — cash to bank | 25,000.00 | 25,000.00 |
| 10 | Salary run | 53,600.00 | 53,600.00 |
| 11 | Salary payment | 43,200.00 | 43,200.00 |
| 11b | Statutory remittance | 10,400.00 | 10,400.00 |
| 12 | Asset purchase | 1,18,000.00 | 1,18,000.00 |
| 13 | Depreciation | 5,000.00 | 5,000.00 |
| 14 | GST settlement | 14,400.00 | 14,400.00 |
| 14b | GST payment | 5,400.00 | 5,400.00 |
| 15 | Rent with TDS | 20,000.00 | 20,000.00 |

Because every individual voucher balances, the trial balance built from the whole
ledger also balances (`mapTotals` in `src/reports/core.ts` compares the debit and
credit columns of the derived balance map).
