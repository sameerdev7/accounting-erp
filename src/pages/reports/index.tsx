import { ReportPage } from '@/components/ReportPage'
import {
  balanceSheet,
  cashFlow,
  creditorsOutstanding,
  debtorsOutstanding,
  gstr1,
  gstr3b,
  profitAndLoss,
  purchaseReport,
  salesReport,
  stockSummary,
  trialBalance,
} from '@/reports'

export function TrialBalancePage() {
  return <ReportPage run={({ from, to }) => trialBalance({ from, to })} />
}

export function ProfitLossPage() {
  return <ReportPage run={({ from, to }) => profitAndLoss({ from, to })} />
}

export function BalanceSheetPage() {
  return <ReportPage mode="asOn" run={({ to }) => balanceSheet({ asOn: to })} />
}

export function CashFlowPage() {
  return <ReportPage run={({ from, to }) => cashFlow({ from, to })} />
}

export function DebtorAgeingPage() {
  return <ReportPage mode="asOn" run={({ to }) => debtorsOutstanding({ asOn: to })} />
}

export function CreditorAgeingPage() {
  return <ReportPage mode="asOn" run={({ to }) => creditorsOutstanding({ asOn: to })} />
}

export function Gstr1Page() {
  return <ReportPage run={({ from, to }) => gstr1({ from, to })} />
}

export function Gstr3bPage() {
  return <ReportPage run={({ from, to }) => gstr3b({ from, to })} />
}

export function StockSummaryPage() {
  return <ReportPage mode="asOn" run={({ to }) => stockSummary({ asOn: to })} />
}

export function SalesRegisterPage() {
  return <ReportPage run={({ from, to }) => salesReport({ from, to })} />
}

export function PurchaseRegisterPage() {
  return <ReportPage run={({ from, to }) => purchaseReport({ from, to })} />
}
