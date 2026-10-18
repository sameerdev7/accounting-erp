# Documentation Generation Brief — Accounting ERP System

> **How to use this file.** This is a *master prompt*. Paste this whole document into an AI
> assistant (Claude, etc.) and ask it to produce the eleven submission documents listed in
> **Part C**. Part A is the immutable source of truth about the built system; Part B fixes the
> house style; Part C specifies exactly what each document must contain. Do not let the model
> invent accounts, modules, pathways or figures that contradict Part A.

---

## Part A — Source of truth (the system being documented)

### A.1 The company

| Field | Value |
|---|---|
| Legal name | **Sai Electronics & Appliances Pvt. Ltd.** |
| Short name | Sai Electronics |
| Location | Shop 14, Sai Trade Centre, FC Road, Pune 411005, Maharashtra, India |
| GSTIN | 27AABCS1429P1ZQ |
| PAN | AABCS1429P |
| Nature of business | Retail and wholesale trading of consumer electronics, home appliances and electrical goods, together with after-sales installation, repair and annual maintenance services. |
| Financial year | 1 April – 31 March |
| Bank | HDFC Bank — Current Account, 50200012345678, IFSC HDFC0000123 |
| Type | Small Indian trading + service business (GST registered, Maharashtra state code 27) |

**Products and services**

1. Televisions, refrigerators and washing machines
2. Air conditioners, fans and voltage stabilisers
3. Kitchen appliances, mixer grinders and microwave ovens
4. Water purifiers and geysers
5. Lighting and electrical wiring accessories
6. Installation and commissioning services
7. Annual maintenance contracts and out-of-warranty repairs

Items are classified **GOODS** (stocked, valued, despatched) or **SERVICE** (billed straight off a
tax invoice, no stock movement). Services post to *Service & Installation Income*, not *Sales*.

**Departments**

Sales & Marketing · Purchase & Procurement · Stores & Logistics · Accounts & Finance ·
Human Resources · Service & After-Sales

**Major financial transactions**

- Purchase of trade goods from manufacturers and distributors (with input GST)
- Retail and wholesale sales of goods (with output GST, intra- and inter-state)
- Provision of installation and maintenance services
- Receipts from customers and payments to suppliers
- Payment of salaries, PF, professional tax and TDS
- Purchase and depreciation of furniture, computers and vehicles
- Monthly GST settlement and statutory remittances

**Trading parties (seed data)**

- Customers: Shree Ganesh Traders (Pune), Krishna Electricals (Mumbai), Reliance Digital Stores
  (Bengaluru), Croma Retail Ltd (Ahmedabad), Sai Distributors (Nashik), Vijay Home Appliances
  (Nagpur), Techno World Pvt Ltd (Hyderabad), Metro Cash & Carry (New Delhi).
- Suppliers: Whirlpool India Ltd, Samsung India Electronics, LG Electronics India, Havells India Ltd,
  Bajaj Electricals, Voltas Limited, Blue Star Ltd, Godrej & Boyce Mfg Co.

**User roles (six)**

| Username | Role | Authority |
|---|---|---|
| `admin` | Administrator (Finance Head) | Everything; sole approver above ₹25,000 |
| `accountant` | Accountant | Masters, vouchers, payments, payroll, GST, reports — **cannot approve** |
| `purchase` | Purchase Officer | Requisitions and purchase orders only |
| `sales` | Sales Officer | Sales orders and deliveries only |
| `manager` | Approver / Manager | Approves documents up to ₹25,000 |
| `auditor` | Auditor | Read-only: reports and the audit log |

All six share the initial password `erp1234` (changeable per user).

### A.2 Technology and architecture

A **fully client-side** single-page application. No backend, no server database.

- **Stack:** React 18 + TypeScript, Vite build, Tailwind CSS, React Router (hash routing),
  [Dexie](https://dexie.org) over **IndexedDB** for all persistence, Recharts for dashboards,
  SheetJS (`xlsx`) for exports, Zustand for session state, Zod for validation, Vitest for tests.
- **Layering (strict, one-way):**

  ```
  UI            src/pages, src/components     – screens; call services only
      ↓
  Services      src/services                  – business actions, approval chain, audit
      ↓
  Engine        src/engine                     – pure posting rules, GST maths, numbering, validators
      ↓
  Repositories  src/db                         – Dexie schema, transactions, chart of accounts, seed
      ↓
  IndexedDB     (browser storage)
  ```

- **Invariants:**
  - Money is always an **integer number of paise**; there are no rupee floats anywhere.
  - The posting engine is a **pure function** `(document) → balanced JournalLines[]`. It is the
    *only* code that writes ledger entries, and it rejects any unbalanced entry — the books balance
    by construction.
  - Posted vouchers are **immutable**; corrections are made only by **reversal** or by a
    **credit/debit note**, never by editing.
  - Ledger balances are **derived**, never stored.
  - Every create / approve / post / reverse writes an **append-only audit row**.
  - The UI never writes to IndexedDB directly.

### A.3 Chart of accounts (40 accounts + party sub-ledgers)

Classified into Assets · Liabilities · Capital/Equity · Income · Expenses. Every customer and
supplier also gets a sub-ledger beneath the receivable / payable control account.

| Code | Account | Type | Normal balance | Notes |
|---|---|---|---|---|
| 1001 | Cash in Hand | Asset | Debit | cash |
| 1002 | Bank — HDFC Current A/c | Asset | Debit | bank |
| 1003 | Accounts Receivable (Control) | Asset | Debit | control; per-customer sub-ledgers |
| 1004 | Inventory — Stock in Trade | Asset | Debit | periodic: set to closing stock at period close |
| 1005 | Input CGST | Asset | Debit | |
| 1006 | Input SGST | Asset | Debit | |
| 1007 | Input IGST | Asset | Debit | |
| 1008 | TDS Receivable | Asset | Debit | |
| 1009 | Prepaid Expenses | Asset | Debit | |
| 1101 | Furniture & Fixtures | Asset | Debit | fixed asset |
| 1102 | Computers & Equipment | Asset | Debit | fixed asset |
| 1103 | Vehicles | Asset | Debit | fixed asset |
| 1104 | Accumulated Depreciation | Asset (contra) | Credit | deducted from gross block |
| 2001 | Accounts Payable (Control) | Liability | Credit | control; per-supplier sub-ledgers |
| 2002 | Output CGST | Liability | Credit | |
| 2003 | Output SGST | Liability | Credit | |
| 2004 | Output IGST | Liability | Credit | |
| 2005 | GST Payable | Liability | Credit | |
| 2006 | TDS Payable | Liability | Credit | |
| 2007 | PF Payable | Liability | Credit | |
| 2008 | Professional Tax Payable | Liability | Credit | |
| 2009 | Salary Payable | Liability | Credit | |
| 2010 | Expenses Payable | Liability | Credit | |
| 2101 | Bank Loan — HDFC Term Loan | Liability | Credit | |
| 3001 | Share Capital | Equity | Credit | |
| 3002 | Reserves & Surplus | Equity | Credit | |
| 3003 | Retained Earnings | Equity | Credit | |
| 3004 | Drawings / Dividend | Equity (contra) | Debit | |
| 4001 | Sales — Electronics | Income | Credit | goods revenue |
| 4002 | Sales Returns | Income (contra) | Debit | deducted from gross sales |
| 4003 | Service & Installation Income | Income | Credit | service revenue |
| 4004 | Interest Income | Income | Credit | |
| 4005 | Discount Received | Income | Credit | |
| 5001 | Purchases (goods for resale) | Expense | Debit | periodic; cleared to COGS at period close |
| 5002 | Purchase Returns | Expense (contra) | Credit | retained for reference |
| 5003 | Cost of Goods Sold | Expense | Debit | opening + purchases − closing |
| 5004 | Salaries & Wages | Expense | Debit | |
| 5005 | Employer PF Contribution | Expense | Debit | |
| 5006 | Rent | Expense | Debit | |
| 5007 | Electricity & Utilities | Expense | Debit | |
| 5008 | Depreciation | Expense | Debit | |
| 5009 | Office & Administration | Expense | Debit | |
| 5010 | Marketing & Advertising | Expense | Debit | |
| 5011 | Bank Charges | Expense | Debit | |
| 5012 | Interest on Loan | Expense | Debit | |
| 5013 | Discount Allowed | Expense | Debit | |
| 5014 | Round-off | Expense | Debit | absorbs paise rounding |

### A.4 Accounting conventions

- **Periodic inventory.** A purchase of goods for resale debits **Purchases (5001)**. Cost of goods
  sold is computed once per period at the *period-end inventory close* as
  `opening stock + purchases − closing stock`, the stock being valued from goods movements at
  weighted-average cost. A GRN and a delivery move **quantity only** and post no ledger entry. The
  Inventory account holds the closing stock after the close.
- **GST.** Intra-state supply splits into CGST + SGST; inter-state supply is IGST. Input tax sits in
  1005–1007, output tax in 2002–2004, and a monthly **GST settlement** nets the two into GST Payable
  (2005), which is then paid. Slabs: 0 / 5 / 12 / 18 / 28 %.
- **TDS** is deducted on qualifying expenses and salaries, credited to TDS Payable (2006).
- **Payroll.** Employer PF 12 %, Maharashtra professional tax, TDS, net salary → Salary Payable
  (2009) → payment.
- **Fixed assets / depreciation.** Straight-line (SLM) and written-down-value (WDV) methods, run
  periodically, credited to Accumulated Depreciation (1104) and debited to Depreciation (5008).
- **Approval.** Amount-based: above ₹25,000 requires the Finance Head; ₹25,000 and below may be
  approved by a Manager. Maker–checker applies (nobody approves their own document). A payment or
  expense can be raised as a **pending payment request** that an authorised user must release.

### A.5 Voucher types (11)

`RECEIPT` · `PAYMENT` · `SALES` · `PURCHASE` · `JOURNAL` · `CONTRA` · `CREDIT_NOTE` · `DEBIT_NOTE` ·
`PAYROLL` · `DEPRECIATION` · `OPENING`

Statuses: `DRAFT → PENDING → APPROVED → POSTED → REVERSED`.

The eight formats the brief requires are Receipt, Payment, Sales, Purchase, Journal, Contra,
Credit Note and Debit Note; PAYROLL, DEPRECIATION and OPENING reuse the same journal structure.

Document number prefixes: PR (requisition), PO (purchase order), GRN (goods receipt),
SO (sales order), DC (delivery), INV (sales invoice), PIV (purchase invoice), RV (receipt),
PYV (payment), JV (journal), CV (contra), CN (credit note), DN (debit note), PRV (payroll),
DEP (depreciation), OB (opening).

---

## Part B — House style for every document

1. **Format:** GitHub-flavoured Markdown, one file per document. Use tables for tabular data.
2. **Diagrams:** use **Mermaid** fenced code blocks (`flowchart`, `erDiagram`, `sequenceDiagram`,
   `graph`) so diagrams render directly on GitHub and in most Markdown viewers. Do not use external
   image links. For wireframes, use ASCII/box-drawing layouts inside fenced code blocks.
3. **Voice:** third person, present tense, concise. Define an acronym on first use.
4. **Money:** show Indian rupees with the ₹ symbol and Indian digit grouping (e.g. ₹1,25,000).
   Internally the system stores paise; only presentation is in rupees.
5. **Traceability:** where a rule comes from the assignment brief, tag it (e.g. "§11 internal
   controls"). Where the built system chose between ambiguous options, say so in a short
   *Assumptions* note rather than silently picking one.
6. **No invention:** use the accounts, modules, pathways and figures in Part A. If something is
   genuinely unspecified, mark it `TBD` and explain.
7. **File names** (put them in the same `docs/` folder but do not overwrite the existing
   `flowcharts.md`, `er-diagram.md`, `voucher-formats.md`, `sample-journal-entries.md`,
   `internal-controls.md`; name new files `blueprint.md`, `system-architecture.md`,
   `module-structure.md`, `transaction-pathways.md`, `financial-reports.md`, `dashboard-wireframes.md`).

---

## Part C — Deliverables to generate

Generate all eleven documents below, in this order.

### 1. Accounting ERP Blueprint

The executive summary of the whole submission. Include:

- Purpose and scope of the assignment and of the system.
- The company profile (name, nature of business, products/services, departments, major
  transactions) from **A.1**.
- Objectives of computerising the accounts (integration, accuracy, control, speed, GST compliance).
- A one-paragraph summary of the accounting model (double-entry, periodic inventory, GST,
  approval hierarchy).
- A high-level feature map: the modules, the reports, the dashboard and the controls.
- A short "assumptions and scope limits" section (client-side only, single-company, single-currency
  INR, one financial year editable at a time, no multi-branch consolidation).
- A contents list linking to the other ten documents.

### 2. System Architecture

- The layered architecture from **A.2**, drawn as a Mermaid `flowchart` (UI → Services → Engine →
  Repositories → IndexedDB) with the flows between layers.
- Explain each layer's responsibility and the rule that the UI never writes to the database.
- Explain the **posting engine** contract: pure `document → balanced JournalLines[]`, unbalanced
  entries rejected, posted vouchers immutable, balances derived.
- A short technology table (layer → technology → why).
- Deployment view: a static bundle served from any web host, all data in the browser's IndexedDB,
  JSON export/import for backup and portability.
- A cross-cutting concerns table: money as integer paise, audit trail, numbering, validation (Zod),
  access control.

### 3. Module Structure

Present the **module hierarchy** as a tree and as a Mermaid `flowchart` (or `graph TD`). Organise it
into the groups below, and for each module give a one-line purpose, its key screens, and the masters
it owns:

- **Masters:** Company Master, Chart of Accounts, Customer Management, Supplier Management, Item
  Master, Employee Master.
- **Purchase:** Requisitions → Purchase Orders → Goods Receipt → Purchase Invoices → Purchase
  Returns.
- **Sales:** Sales Orders → Deliveries → Sales Invoices → Sales Returns.
- **Cash & Bank:** Receipts, Payments, Contra, Expenses.
- **Books of Account:** General Ledger, Day Book, Journals, Voucher Approvals.
- **Receivables / Payables / Inventory.**
- **Payroll & Fixed Assets.**
- **GST / Taxation.**
- **Financial Statements & MIS reports.**
- **Administration:** Users, Period Locks, Audit Log, Backup & Reset.

Show how the modules map onto the brief's module list (Company Master, Chart of Accounts, Customer
Management, Supplier Management, Sales, Purchase, Cash & Bank, Receivables, Payables, Inventory,
Payroll, Fixed Assets, GST/Taxation, General Ledger, Financial Statements, MIS & Management
Reports).

### 4. Accounting Transaction Pathways

Document **all five pathways** from the brief, each as a numbered stage list **and** a Mermaid
`flowchart`. For every stage name the document(s) created and whether it posts a ledger entry
(mark quantity-only and no-posting stages explicitly).

1. **Purchase:** Purchase Requirement → Purchase Requisition → Approval → Purchase Order →
   Goods Received → Purchase Invoice → GST Calculation → Supplier Payable → Payment →
   Journal/Ledger Update.
2. **Sales:** Customer Order → Sales Order → Inventory Check → Delivery → Sales Invoice →
   GST Calculation → Customer Receivable → Receipt → Ledger Update.
3. **Cash Payment:** Payment Request → Approval → Payment → Cash/Bank Entry → Ledger Posting →
   Voucher → Report.
4. **Cash Receipt:** Customer Receipt → Receipt Voucher → Bank/Cash Update → Customer Account →
   Ledger Posting.
5. **Payroll:** Employee Data → Attendance → Salary Calculation → Deductions → Net Salary →
   Payment → Payroll Journal → Ledger.

Add a **control checkpoint** column per stage (who or what approves/validates: approval hierarchy,
three-way match, duplicate check, maker–checker, period lock) and a **status flow** line
(DRAFT → PENDING → APPROVED → POSTED → REVERSED).

### 5. Flowcharts

A diagram-only companion to document 4 plus the supporting processes. Provide, each as its own
Mermaid block:

- Purchase-to-payment flowchart.
- Order-to-cash (sales) flowchart.
- Cash payment (payment-request → approval → payment) flowchart.
- Cash receipt flowchart.
- Payroll flowchart.
- Month-end **inventory close** flowchart (goods movements → weighted-average valuation →
  Dr COGS / Cr Purchases & Inventory adjustment → closing stock in Inventory).
- Monthly **GST settlement** flowchart (output tax − input tax → GST Payable → payment).
- Voucher **lifecycle** flowchart (create → approve → post → reverse / credit note).
- **Approval decision** flowchart (amount vs ₹25,000, maker–checker, role).

### 6. Chart of Accounts

- Reproduce the 40-account chart from **A.3** grouped by the five classes (Assets, Liabilities,
  Capital/Equity, Income, Expenses), with code, name, type and normal balance.
- Explain the **coding convention** (1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income,
  5xxx expenses; control accounts 1003/2001).
- Explain **party sub-ledgers**: one account per customer/supplier beneath the control account; the
  control account's own balance is nil and its reported figure is the roll-up of its children.
- State that the brief's minimum of 30 accounts is exceeded (40 plus sub-ledgers).

### 7. ER Diagram

- A Mermaid `erDiagram` covering the master and transaction entities: Company, Account
  (self-referencing parent/child for the ledger tree), Party (Customer/Supplier), Item,
  Employee, PurchaseRequisition, PurchaseOrder, GRN, PurchaseInvoice, SalesOrder, Delivery,
  SalesInvoice, Voucher, VoucherLine, LedgerEntry, StockMovement, Payment/Receipt,
  PayrollRun/Payslip, FixedAsset, GstReturn, AuditLog, PeriodLock, User.
- Show cardinalities and the key relationships called out by the brief:
  Customer → Sales → Invoice → Receipt → Ledger; Supplier → Purchase → Invoice → Payment →
  Ledger; Employee → Payroll → Salary Payment → Ledger.
- A short entity → key-attributes table and a paragraph on the "one ledger entry per voucher line,
  balances derived" rule.

### 8. Voucher Formats

For **each of the eight voucher types** (Receipt, Payment, Sales, Purchase, Journal, Contra,
Credit Note, Debit Note) give:

- A sample **printed layout** as an ASCII/box wireframe (header with company name and GSTIN,
  voucher number, date, narration, line grid, totals-in-words, prepared/approved-by signature
  block).
- The **field list** with types.
- The **posting rule** as a Dr/Cr table (which accounts are debited and credited).
- Its **number prefix** and status flow.

Add a note that PAYROLL, DEPRECIATION and OPENING vouchers reuse the journal layout.

### 9. Sample Journal Entries

Worked, balanced double-entry examples for every major transaction, each shown as a Dr/Cr table
with amounts in ₹ and a one-line narration. Cover at least:

- Opening balances / capital introduced.
- **Purchase of goods ₹50,000 + GST 18 %** — the brief's own example:
  *Purchase A/c Dr · Input GST A/c Dr · To Supplier A/c Cr* (use the periodic Purchases account
  5001 with Input CGST/SGST or IGST).
- Purchase return.
- Sales invoice (intra-state CGST/SGST **and** a separate inter-state IGST example).
- Sales return / credit note.
- Receipt from customer and payment to supplier (with allocation against invoices).
- Contra (cash deposited into bank).
- Expense with TDS.
- Payroll journal and salary payment.
- Depreciation run.
- **Period-end inventory close** (opening + purchases − closing → COGS) and GST settlement.
- Reversal of a posted voucher.

For each, show the resulting effect on the ledger and how it appears in the trial balance.

### 10. Financial Reports

For each of the eleven reports the brief requires — Trial Balance, Profit & Loss Account,
Balance Sheet, Cash Flow Statement, Cash Book, Bank Book, Debtors Outstanding, Creditors
Outstanding, Sales Report, Purchase Report, GST/Tax Report — give:

- Purpose and the question it answers.
- The rows/columns structure (as a small sample table with illustrative figures).
- The source accounts/documents it draws from.
- The filters offered (date range, party, item, GST period) and the exports (CSV, XLSX, print).
- A one-line note on the accounting logic (e.g. balance sheet proves
  Assets = Liabilities + Equity + profit).

End with a short "reports map" table linking each report to its module.

### 11. ERP Dashboard / Wireframes

- A full-page **dashboard wireframe** as an ASCII layout containing **exactly these eight tiles**:
  **Sales | Purchases | Receivables | Payables | Cash/Bank | Expenses | Profit | Inventory** — each
  tile showing value, period and a trend sparkline/chart, plus additional panels for recent
  activity, ageing summary and a separate **GST position** card.
- Define each tile's metric and its source account(s)/report.
- Wireframes (ASCII) for the main screens: a list/table screen pattern (used by all masters and
  registers), a document **form** pattern, the **approval** screen, the **ledger/day-book**
  screen, and a **report** screen with filters and an export toolbar.
- A short navigation map (the sidebar groups) and a note that screens follow one consistent
  table-plus-form pattern with no bespoke animation.

---

## Part D — Final output checklist

When you are done, list the produced files and confirm that, for each of the eleven submission
documents required by the brief (Accounting ERP Blueprint, System Architecture, Module Structure,
Accounting Transaction Pathways, Flowcharts, Chart of Accounts, ER Diagram, Voucher Formats,
Sample Journal Entries, Financial Reports, ERP Dashboard/Wireframes), a Markdown document exists and
uses Part A figures consistently.
