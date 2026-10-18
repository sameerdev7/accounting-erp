# Sai Electronics & Appliances Pvt. Ltd. — Accounting ERP

A **fully client-side** accounting and ERP application for a fictional Pune electronics
retailer. There is no backend and no server database: the whole double-entry ledger,
GST computation, approval chain and reporting engine run in the browser, and the data
lives in IndexedDB (via [Dexie](https://dexie.org)). Open the page and the books
build themselves from a deterministic seed.

Built to `ARCHITECTURE.md`.

## Run it

```bash
cd accounting-erp
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # tsc --noEmit && vite build  → static bundle in dist/
npm test           # the Vitest suite
npm run typecheck  # types only
```

Requires Node 20+ (developed on Node 20.20.2 / npm 10.8.2).

### Theme

The interface ships with a light and a dark theme, chosen from the three-way switch in the top
bar (or the sign-in screen): **Light**, **Dark**, or **System** to follow the operating system.
The choice is remembered in `localStorage` and applied before first paint, so there is no flash of
the wrong colours. Printing always renders on white regardless of the active theme.

### Sign-in accounts

All six users share the password **`erp1234`** (the sign-in page lists them as one-click
shortcuts):

| Username | Role | What it can do |
|---|---|---|
| `admin` | Administrator (Finance Head) | Everything; sole approver above ₹25,000 |
| `accountant` | Accountant | Masters, vouchers, payments, payroll, GST, reports — **cannot approve** |
| `purchase` | Purchase Officer | Requisitions and purchase orders only |
| `sales` | Sales Officer | Orders and deliveries only |
| `manager` | Approver / Manager | Approves documents up to ₹25,000 |
| `auditor` | Auditor | Read-only: reports and the audit log |

## What is implemented

- **Company master** (with a business profile: nature of business, products & services,
  departments, major transactions), 40-account chart of accounts, customers, suppliers, items,
  employees, attendance.
- **Posting engine** (`src/engine`) — pure `(document) → balanced JournalLines[]`. The *only* code
  that writes to `ledgerEntries` is `createVoucher()` in `src/services/ledger.ts`, and it rejects
  any unbalanced entry. Books therefore balance by construction, not by convention.
- **Purchase cycle**: requisition → approval → purchase order → GRN → purchase invoice (3-way match,
  duplicate-supplier-invoice block) → payment.
- **Sales cycle**: order → delivery (draws stock at weighted-average cost) → invoice
  (intra CGST/SGST vs inter IGST) → receipt → credit/debit notes; the cost of the goods sold is
  recognised at the period-end inventory close.
- **Goods and services**: items are marked **Goods** (stocked, valued, despatched) or **Service**
  (billed straight off a tax invoice — no stock movement, no availability check — posting to
  Service Income rather than Sales).
- **Cash & Bank**: receipts, payments, contra, expenses with TDS, oldest-first allocation,
  duplicate-receipt warning, party ageing, and a **payment-request → approval → payment** pathway
  (a payment may be raised as a pending request that an authorised user must approve and release).
- **Periodic inventory**: stock movements are the single source of truth for quantity; purchases are
  debited to the Purchases account, and a **period-end close** charges opening stock plus purchases
  less closing stock to Cost of Goods Sold, leaving the Inventory account holding the closing stock.
- **Payroll**: PF (12%), Maharashtra professional tax, TDS, payslips, payroll journal, salary
  payment, statutory remittances.
- **Fixed assets**: SLM and WDV depreciation, depreciation runs, disposal.
- **GST**: input/output control accounts, monthly working, settlement, payment.
- **Reports**: trial balance, P&L, balance sheet, cash flow, day/cash/bank books, ledger, debtors and
  creditors ageing, GSTR-1, GSTR-3B, stock summary, sales and purchase registers — every one with
  CSV and XLSX export and print.
- **Internal controls** (`§11`): authentication, role-based access, amount-based approval hierarchy,
  maker–checker, immutable posted vouchers (corrections only by reversal or note), append-only audit
  trail, JSON backup/restore with a 7-day reminder, duplicate prevention, and period locks.

## Architecture

Strict one-way layering:

```
UI (src/pages, src/components)
        ↓  calls services only
Services (src/services)        business actions, approval chain, audit
        ↓
Engine (src/engine)            pure posting rules, GST maths, numbering, validators
        ↓
Repositories (src/db)          Dexie schema, transactions, chart of accounts, seed
        ↓
IndexedDB
```

The UI never writes to IndexedDB. It may *read* it directly for lists, but every mutation goes through
a service function, and every posting goes through `createVoucher()`.

Money is always an **integer number of paise**. There are no rupee floats anywhere.

## Testing

`npm test` runs the Vitest suite — **111 tests across 9 files**:

- `money.test.ts` — paise arithmetic and rupee formatting;
- `gst.test.ts` — GST computation, inter vs intra-state split, GSTIN validation;
- `posting.test.ts` — the posting-engine rule table for every transaction type, including the
  periodic inventory close and the goods/service revenue split;
- `numbering.test.ts` — gapless document numbering;
- `reports.test.ts` — the reporting contract, built by posting known entries through the real engine;
- `controls.test.ts` — the section-11 controls through the real services: the approval threshold, maker–checker,
  duplicate supplier invoices, reversal-instead-of-edit, receipt clearing, and period locks;
- `payment-approval.test.ts` — the payment-request pathway: a request stays unposted until approved,
  the maker cannot approve their own request, the amount threshold is enforced, and releasing a
  request posts the ledger entry and settles the invoices atomically;
- `ui-smoke.test.tsx` — every major screen renders without throwing;
- `seed.test.ts` — drives the *entire* stack the way the seeder does and then audits the invariants that matter:

  - the trial balance's debit total equals its credit total;
  - Assets = Liabilities + Equity + profit;
  - the Inventory ledger account equals the independently derived stock valuation;
  - Purchases clears to Cost of Goods Sold and service revenue lands in Service Income;
  - each party control account rolls up exactly to the sum of its sub-ledgers;
  - GST output and input streams both moved and were settled.

## Assumptions

The specification left a number of things ambiguous or self-contradictory. Where it did, the simplest
correct option was chosen and recorded here.

1. **Inventories are periodic, matching the specification's own worked example.** A purchase of goods
   for resale posts `Dr Purchases`, and Cost of Goods Sold is worked out at the period-end close as
   `opening stock + purchases − closing stock` (the stock being valued from the goods movements at
   weighted-average cost). Consequences:
   - a **GRN moves quantity only** and posts no ledger entry; the purchase invoice debits Purchases;
   - a **delivery moves quantity only** and posts no ledger entry — the cost of sales is recognised
     once per period by the close;
   - a **purchase return credits Purchases** back (the same account the invoice debited); the
     Purchase Returns account (5002) is retained in the chart of accounts but is not posted to;
   - the close is triggered from the Inventory screen (or automatically during seeding) and a month is
     closed at most once, re-openable only by reversing the previous closing journal.
2. **`§12b` contradicts `§11` on approval limits.** The test plan's step 3 says a manager approves a
   ₹50,000 requisition, but `§11` says anything above ₹25,000 needs the Finance Head. `§11` is the
   control, so it wins for *vouchers and invoices* (amount-based). Requisition and purchase-order
   approvals are role-based only, so the manager can still approve the requisition the test plan
   describes.
3. **`§16` does not exist.** The document header refers to "the prompt in section 16", but the file
   ends at `§15`. The build follows `§1–§15`.
4. **Sub-ledgers.** Every customer and supplier gets its own account under the Accounts Receivable
   (1003) / Accounts Payable (2001) control account. Postings go to the sub-ledger; the control
   account's own balance is nil and its reported figure is the roll-up of its children. The trial
   balance lists sub-ledgers so that it balances.
5. **Extra voucher types.** The eight voucher types in the spec are extended with `PAYROLL`,
   `DEPRECIATION` and `OPENING` so that those documents post through the same audited path.
6. **Password hashing.** Passwords are salted SHA-256 digests via Web Crypto. This keeps plaintext out
   of the database but is *not* a substitute for a real KDF (bcrypt/argon2), which a browser cannot
   provide natively. Acceptable for this application; noted for honesty.
7. **Financial-year start month** is configurable and seeded to April (Indian convention), but is not
   editable from the Company screen — changing it would re-cut every financial year and every
   document number already issued.
8. **Backup reminder** has no scheduler in a static page, so the "7 days without a backup" reminder is
   evaluated when an administrator loads a screen rather than fired by a background timer.
9. **Seed data is deterministic but relative to today.** A fixed RNG seed produces the same company,
   parties and item catalogue every time, while document dates are computed from the current date so
   the books always look current and ageing buckets stay realistic. It is roughly two months of
   back-dated, fully posted transactions.
10. **Goods vs services.** The specification asks for "products/services" in the company profile. An
    item is therefore marked `GOODS` (default) or `SERVICE`. A service is sold straight off a tax
    invoice — no sales order, delivery or stock movement — and its taxable value is credited to
    Service Income (4003) instead of Sales (4001), so the two revenue streams stay separable. EXCEPT:
    a sales *return* of a service still debits Sales Returns (4002), the same as goods, rather than
    reducing Service Income, because a business can always attribute a credit note to trade rather
    than to service revenue.
11. **Payment requests.** A payment (or expense) can be raised as a *request* rather than posted
    immediately. It is stored as a PENDING voucher, and the intended settlement of specific supplier
    invoices is held in a plan until an authorised user releases the request. Releasing it enforces
    the same maker–checker and ₹25,000 threshold rules as any other voucher, then posts the ledger
    entry and applies the allocations in one transaction. A pending request is intentionally *not*
    deletable — the operator either releases or leaves it pending — which keeps the audit trail
    complete.

## Deployment

`npm run build` produces a static `dist/` with no server requirement, so the app can be
hosted anywhere that serves files. Step-by-step Netlify instructions (dashboard upload and
Git-connected), plus the `netlify.toml` used for the SPA build, are in
[`docs/deployment.md`](docs/deployment.md).

## Documentation

Design and submission documents live in `docs/`:

- [`instructions.md`](docs/instructions.md) — the master brief you can hand to an AI to generate the
  full project documentation set (blueprint, architecture, module structure, pathways, flowcharts,
  chart of accounts, ER diagram, voucher formats, sample journal entries, reports, wireframes);
- [`flowcharts.md`](docs/flowcharts.md) — process flowcharts (Mermaid);
- [`er-diagram.md`](docs/er-diagram.md) — entity-relationship diagram (Mermaid);
- [`voucher-formats.md`](docs/voucher-formats.md) — the eight voucher formats;
- [`sample-journal-entries.md`](docs/sample-journal-entries.md) — worked double-entry examples;
- [`internal-controls.md`](docs/internal-controls.md) — the §11 controls and how each is enforced;
- [`deployment.md`](docs/deployment.md) — how to publish the build to Netlify.
