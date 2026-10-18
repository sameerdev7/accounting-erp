# Printable Voucher Formats

The application prints eight voucher types. This document gives the exact A4
layout for each, followed by the data fields that populate every position on the
page.

## Common conventions

- The **company header** is common to all eight vouchers. Its values are read
  from the single row of the `company` table (`name`, `gstin`, `pan`, `state`,
  `stateCode`, `address`, `city`, `pincode`, `phone`, `email`). The values shown
  in the samples below are illustrative placeholders; the live values are seeded
  from the company master.
- The **voucher number** comes from the `vouchers.number` field. Numbers are
  allocated by `allocateSequence` in `src/engine/numbering.ts` in the form
  `PREFIX/FYKEY/0000`, where the financial-year key for 2026-27 is `2627`. The
  prefixes are `RV` Receipt, `PYV` Payment, `INV` Sales, `PIV` Purchase, `JV`
  Journal, `CV` Contra, `CN` Credit Note and `DN` Debit Note
  (`DEFAULT_PREFIXES` in `src/services/ledger.ts`).
- The **amount in words** line is produced by `amountInWords()` in
  `src/lib/money.ts`, which renders integer paise in the Indian numbering system
  (`Rupees Fifty Nine Thousand Only`, `Rupees ... and Fifty Paise Only`). Paise
  are printed only when the amount is not a whole number of rupees.
- **The Dr column total must equal the Cr column total on every voucher.** The
  printed total is `vouchers.amount`, which is the sum of the debit side, and it
  can only exist because `assertBalanced` in `src/engine/validators.ts` rejected
  any unbalanced set of lines before the voucher was saved.
- The three signature boxes print the display names of `vouchers.preparedBy`,
  `vouchers.approvedBy` and the authorised signatory. Where a voucher was posted
  directly, `preparedBy` and `approvedBy` may be the same user; where it passed
  through the approval chain they are always different, because
  `assertMakerChecker` forbids the preparer from approving.

---

## 1. Receipt Voucher (`type = 'RECEIPT'`)

Dr Bank or Cash · Cr customer sub-ledger.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  RECEIPT VOUCHER                                            Voucher No.: RV/2627/0007    |
|  Date: 18-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Received from : Rahul Traders                                                           |
|  Party code    : CUST-004                 GSTIN : 27AACCR5678E1Z9                        |
|  Address       : 22 Laxmi Road, Pune, Maharashtra                                        |
|  Against       : Sales Invoice INV/2627/0012                                             |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | 1002 Bank HDFC Current A/c     | Amount received            |  94400.00 |         |
|  Cr   | Rahul Traders                  | Being receipt against      |           | 94400.00|
|       | Sub-ledger under 1003 A/c Rec  | INV/2627/0012              |           |         |
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |  94400.00 | 94400.00|
+==========================================================================================+
|  Amount in words : Rupees Ninety Four Thousand Four Hundred Only                         |
|  Narration       : Receipt against sales invoice INV/2627/0012                           |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.status`,
`Voucher.narration`, `Voucher.amount`, `Voucher.preparedBy`, `Voucher.approvedBy`,
`Voucher.partyId`; `Customer.name`, `Customer.code`, `Customer.gstin`,
`Customer.address`, `Customer.ledgerAccountId`; `LedgerEntry.accountId`,
`LedgerEntry.debit`, `LedgerEntry.credit`, `LedgerEntry.narration`;
`Account.code`, `Account.name`; `Allocation.invoiceId`, `Allocation.amount` for
the "Against" line; `Invoice.number` for the invoice reference; company header
fields listed above.

---

## 2. Payment Voucher (`type = 'PAYMENT'`)

Dr supplier sub-ledger · Cr Bank or Cash.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  PAYMENT VOUCHER                                            Voucher No.: PYV/2627/0003   |
|  Date: 22-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Paid to    : Techno Distributors                                                        |
|  Party code : SUP-002                    GSTIN : 27AAECT9012F1Z3                         |
|  Address    : 9 Shivaji Nagar, Pune, Maharashtra                                         |
|  Against    : Purchase Invoice PIV/2627/0005                                             |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | Techno Distributors            | Being payment against       |  59000.00 |         |
|       | Sub-ledger under 2001 A/c Pay  | PIV/2627/0005              |           |         |
|  Cr   | 1002 Bank HDFC Current A/c     | Amount paid by NEFT        |           | 59000.00|
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |  59000.00 | 59000.00|
+==========================================================================================+
|  Amount in words : Rupees Fifty Nine Thousand Only                                       |
|  Narration       : Payment to supplier against purchase invoice PIV/2627/0005            |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Finance Head       |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.status`,
`Voucher.amount`, `Voucher.preparedBy`, `Voucher.approvedBy`, `Voucher.partyId`;
`Supplier.name`, `Supplier.code`, `Supplier.gstin`, `Supplier.address`,
`Supplier.ledgerAccountId`; `LedgerEntry.accountId`, `LedgerEntry.debit`,
`LedgerEntry.credit`; `Account.code`, `Account.name`; `Allocation.invoiceId`,
`Allocation.amount`; `Invoice.number`.

---

## 3. Sales Voucher (`type = 'SALES'`)

Dr customer · Cr Sales and the output GST control accounts.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  SALES VOUCHER                                              Voucher No.: INV/2627/0012   |
|  Date: 15-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Billed to   : Rahul Traders                                                             |
|  Party code  : CUST-004                  GSTIN : 27AACCR5678E1Z9                        |
|  Place of supply : Maharashtra 27        Our invoice no. : INV/2627/0012                 |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | Rahul Traders                  | Being goods sold on credit |  94400.00 |         |
|       | Sub-ledger under 1003 A/c Rec  |                            |           |         |
|  Cr   | 4001 Sales Electronics         | Taxable value of goods     |           | 80000.00|
|  Cr   | 2002 Output CGST               | CGST at 9 percent          |           |  7200.00|
|  Cr   | 2003 Output SGST               | SGST at 9 percent          |           |  7200.00|
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |  94400.00 | 94400.00|
+==========================================================================================+
|  Amount in words : Rupees Ninety Four Thousand Four Hundred Only                         |
|  Narration       : Sale of electronic goods to Rahul Traders                             |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Sales Officer      |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Invoice.number`, `Invoice.partyInvoiceNumber` (for the
counterparty's reference, when applicable), `Invoice.date`, `Invoice.dueDate`,
`Invoice.placeOfSupply`, `Invoice.interState`, `Invoice.taxable`, `Invoice.cgst`,
`Invoice.sgst`, `Invoice.igst`, `Invoice.roundOff`, `Invoice.total`,
`Invoice.status`; `InvoiceLine.description`, `InvoiceLine.hsn`,
`InvoiceLine.qty`, `InvoiceLine.rate`, `InvoiceLine.gstRate`,
`InvoiceLine.taxable`, `InvoiceLine.cgst`, `InvoiceLine.sgst`,
`InvoiceLine.igst`; `Voucher.number`, `Voucher.date`, `Voucher.amount`;
`Customer.name`, `Customer.code`, `Customer.gstin`, `Customer.ledgerAccountId`;
`LedgerEntry` rows for the six OR more posting lines. The clean 18% split shown
is produced by `splitGst` in `src/lib/money.ts`: half the rate becomes CGST, half
becomes SGST, and inter-state invoices use `1007`/`2004` IGST instead.

---

## 4. Purchase Voucher (`type = 'PURCHASE'`)

Dr Purchases (or a fixed asset) and input GST · Cr supplier.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  PURCHASE VOUCHER                                           Voucher No.: PIV/2627/0005   |
|  Date: 20-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Received from : Techno Distributors                                                     |
|  Party code    : SUP-002                 GSTIN : 27AAECT9012F1Z3                         |
|  Party invoice : TD/2026/4471            Our reference : PO/2627/0009 / GRN 0004         |
|  Place of supply : Maharashtra 27                                                        |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | 5001 Purchases (goods for resale)| Goods received on PO       |  50000.00 |         |
|       |                                | PO/2627/0009               |           |         |
|  Dr   | 1005 Input CGST                | CGST at 9 percent          |   4500.00 |         |
|  Dr   | 1006 Input SGST                | SGST at 9 percent          |   4500.00 |         |
|  Cr   | Techno Distributors            | Being goods purchased      |           | 59000.00|
|       | Sub-ledger under 2001 A/c Pay  | on credit                  |           |         |
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |  59000.00 | 59000.00|
+==========================================================================================+
|  Amount in words : Rupees Fifty Nine Thousand Only                                       |
|  Narration       : Purchase of goods against PO/2627/0009                                |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Invoice.number`, `Invoice.partyInvoiceNumber` (the supplier's
own number, protected against duplicates by the unique index
`&[type+partyId+partyInvoiceNumber]`), `Invoice.date`, `Invoice.dueDate`,
`Invoice.taxable`, `Invoice.cgst`, `Invoice.sgst`, `Invoice.igst`,
`Invoice.roundOff`, `Invoice.total`; `Invoice.sourceDocId`,
`Invoice.sourceDocType` for the PO/GRN reference; `Voucher.number`,
`Voucher.amount`; `Supplier.name`, `Supplier.code`, `Supplier.gstin`,
`Supplier.address`, `Supplier.ledgerAccountId`; `Account.code`, `Account.name`
for `1004`, `1005`, `1006`, `1007`, `2001`; `LedgerEntry` rows.

---

## 5. Journal Voucher (`type = 'JOURNAL'`)

A manual, balanced entry created through `postJournal` for transactions that are
not a purchase, sale, receipt, payment or contra.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  JOURNAL VOUCHER                                            Voucher No.: JV/2627/0002    |
|  Date: 31-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Reference : Month-end interest accrual                                                  |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | 5012 Interest on Loan          | Interest accrued on HDFC   |   3000.00 |         |
|       |                                | term loan for October      |           |         |
|  Cr   | 2010 Expenses Payable          | Amount payable to bank     |           |  3000.00|
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |   3000.00 |  3000.00|
+==========================================================================================+
|  Amount in words : Rupees Three Thousand Only                                            |
|  Narration       : Interest accrued on HDFC term loan for October 2026                   |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Finance Head       |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.narration`,
`Voucher.amount`, `Voucher.status`, `Voucher.preparedBy`, `Voucher.approvedBy`,
`Voucher.approvedAt`, `Voucher.postedAt`; the full set of `LedgerEntry` rows
(`accountId`, `debit`, `credit`, `narration`, `partyId`); `Account.code` and
`Account.name`. A journal voucher may carry any number of lines, but total debits
must equal total credits or `assertBalanced` rejects it.

---

## 6. Contra Voucher (`type = 'CONTRA'`)

Cash deposited into the bank: Dr Bank · Cr Cash. Contra entries move value
between two of the company's own cash/bank accounts and never touch a party.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  CONTRA VOUCHER                                             Voucher No.: CV/2627/0001    |
|  Date: 24-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Reference : Cash deposited into HDFC Current A/c (pay-in slip 0042)                      |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | 1002 Bank HDFC Current A/c     | Cash deposited into bank   |  25000.00 |         |
|  Cr   | 1001 Cash in Hand              | Cash paid into bank        |           | 25000.00|
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |  25000.00 | 25000.00|
+==========================================================================================+
|  Amount in words : Rupees Twenty Five Thousand Only                                      |
|  Narration       : Cash deposited into HDFC Current A/c                                   |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.narration`,
`Voucher.amount`, `Voucher.status`, `Voucher.preparedBy`, `Voucher.approvedBy`;
`LedgerEntry.accountId`, `LedgerEntry.debit`, `LedgerEntry.credit` for the two
lines only; `Account.code`, `Account.name`, and the `Account.isCash` /
`Account.isBank` flags used to populate the cash/bank pickers (`1001` Cash in
Hand, `1002` Bank – HDFC Current A/c).

---

## 7. Credit Note (`type = 'CREDIT_NOTE'`)

Sales return: Dr Sales Returns and the output GST accounts · Cr customer.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  CREDIT NOTE                                                Voucher No.: CN/2627/0002    |
|  Date: 27-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Issued to  : Rahul Traders                                                              |
|  Party code : CUST-004                   GSTIN : 27AACCR5678E1Z9                        |
|  Against    : Sales Invoice INV/2627/0012                                                |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | 4002 Sales Returns             | Goods returned by customer |   5000.00 |         |
|  Dr   | 2002 Output CGST               | Output CGST reversed       |    450.00 |         |
|  Dr   | 2003 Output SGST               | Output SGST reversed       |    450.00 |         |
|  Cr   | Rahul Traders                  | Credit allowed to customer |           |  5900.00|
|       | Sub-ledger under 1003 A/c Rec  |                            |           |         |
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |   5900.00 |  5900.00|
+==========================================================================================+
|  Amount in words : Rupees Five Thousand Nine Hundred Only                                |
|  Narration       : Sales return credited against INV/2627/0012                           |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.narration`,
`Voucher.amount`, `Voucher.refDocId`, `Voucher.refDocType`, `Voucher.partyId`;
`Customer.name`, `Customer.code`, `Customer.gstin`, `Customer.ledgerAccountId`;
`LedgerEntry` rows against `4002`, `2002`, `2003` (and `2004` for an inter-state
return) and the customer sub-ledger; `Account.code`, `Account.name`.
`4002` Sales Returns is a contra-income account (`isContra = true`), so it is
shown as a deduction from gross sales on the profit and loss statement.

---

## 8. Debit Note (`type = 'DEBIT_NOTE'`)

Purchase return: Dr supplier · Cr Purchase Returns and the input GST accounts.

```text
+==========================================================================================+
|  SAI ELECTRONICS & APPLIANCES PVT. LTD.                                                  |
|  GSTIN: 27AABCS1234D1Z5     PAN: AABCS1234D     State: Maharashtra 27                    |
|  Plot 12, MIDC Industrial Area, Bhosari, Pune, Maharashtra 411026                        |
|  Phone: 020-2712 3456       Email: accounts@saielectronics.example                       |
+==========================================================================================+
|  DEBIT NOTE                                                 Voucher No.: DN/2627/0001    |
|  Date: 28-Oct-2026                                          Status: POSTED                |
+==========================================================================================+
|  Issued to  : Techno Distributors                                                        |
|  Party code : SUP-002                    GSTIN : 27AAECT9012F1Z3                         |
|  Against    : Purchase Invoice PIV/2627/0005                                             |
+==========================================================================================+
| Dr/Cr | Account                        | Particulars                |   Debit   |  Credit |
+-------+--------------------------------+----------------------------+-----------+---------+
|  Dr   | Techno Distributors            | Goods returned to supplier |   5900.00 |         |
|       | Sub-ledger under 2001 A/c Pay  |                            |           |         |
|  Cr   | 5002 Purchase Returns          | Return of purchased goods  |           |  5000.00|
|  Cr   | 1005 Input CGST                | Input CGST reversed        |           |   450.00|
|  Cr   | 1006 Input SGST                | Input SGST reversed        |           |   450.00|
+-------+--------------------------------+----------------------------+-----------+---------+
|       |                                       TOTAL                |   5900.00 |  5900.00|
+==========================================================================================+
|  Amount in words : Rupees Five Thousand Nine Hundred Only                                |
|  Narration       : Purchase return debited against PIV/2627/0005                          |
+==========================================================================================+
|  Prepared by        |  Approved by        |  Authorised by                             |
|  ______________     |  ______________     |  ______________                            |
|  Accountant         |  Manager            |  Director                                  |
+==========================================================================================+
```

**Data fields:** `Voucher.number`, `Voucher.date`, `Voucher.narration`,
`Voucher.amount`, `Voucher.refDocId`, `Voucher.refDocType`, `Voucher.partyId`;
`Supplier.name`, `Supplier.code`, `Supplier.gstin`, `Supplier.ledgerAccountId`;
`LedgerEntry` rows against the supplier sub-ledger, `5002`, `1005`/`1006` (and
`1007` for an inter-state return); `Account.code`, `Account.name`.

---

## Why the two columns must agree

Every layout above shows the same safeguard: the debit total and the credit total
printed at the foot of the table are identical. This is not a presentation
choice. It is the golden rule of double entry, enforced in code by
`assertBalanced` in `src/engine/validators.ts`, which is called by
`postJournal`, every transaction-specific poster, and `createVoucher` in
`src/services/ledger.ts` before a single `LedgerEntry` row is written. The
`balanceWithRoundOff` helper handles the one legitimate discrepancy a real
invoice can produce — the paise created when a total is rounded to the nearest
rupee — by posting the difference to the Round-off account (`5014`), so the
voucher still balances to the paisa. If the two column totals ever failed to
agree, the engine would raise a `PostingError` rather than save the voucher, and
the printed voucher could not exist.
