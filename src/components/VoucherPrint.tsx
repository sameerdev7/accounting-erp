import type { Account, Company, LedgerEntry, Voucher } from '@/db/schema'
import { amountInWords, formatINR } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { VOUCHER_TYPE_LABELS } from '@/services/ledger'
import { Card } from './ui'

/**
 * The printable voucher. Sections 7 and 10 ask for a voucher that can be
 * printed and filed, so this is a self-contained document with the accounting
 * equation visible (debits beside credits) and a narration in words.
 */
export function VoucherPrint({
  voucher,
  entries,
  accountsById,
  company,
  partyName,
}: {
  voucher: Voucher
  entries: LedgerEntry[]
  accountsById: Map<string, Account>
  company: Company | null | undefined
  partyName?: string
}) {
  const debitTotal = entries.reduce((total, entry) => total + entry.debit, 0)
  const creditTotal = entries.reduce((total, entry) => total + entry.credit, 0)

  return (
    <Card className="print-area" bodyClassName="p-6">
      <div className="mb-4 flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
        <div>
          <p className="text-base font-bold text-slate-900">{company?.name ?? 'Company'}</p>
          <p className="text-xs text-slate-500">
            {company?.address}, {company?.city} {company?.pincode}
          </p>
          <p className="text-xs text-slate-500">
            GSTIN {company?.gstin} · PAN {company?.pan}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {VOUCHER_TYPE_LABELS[voucher.type]} Voucher
          </p>
          <p className="text-sm text-slate-600">{voucher.number}</p>
          <p className="text-xs text-slate-500">Date: {formatDate(voucher.date)}</p>
        </div>
      </div>

      {partyName && (
        <p className="mb-3 text-sm text-slate-700">
          <span className="text-slate-500">Party: </span>
          {partyName}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-1.5">Particulars</th>
            <th className="py-1.5 text-right">Debit</th>
            <th className="py-1.5 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const account = accountsById.get(entry.accountId)
            return (
              <tr key={entry.id} className="border-b border-slate-100">
                <td className="py-1.5">
                  <span className="text-slate-800">
                    {account ? `${account.code} — ${account.name}` : entry.accountId}
                  </span>
                  {entry.narration && <span className="block text-xs text-slate-400">{entry.narration}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{entry.debit ? formatINR(entry.debit) : ''}</td>
                <td className="py-1.5 text-right tabular-nums">{entry.credit ? formatINR(entry.credit) : ''}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-400 font-semibold">
            <td className="py-1.5 text-right">Total</td>
            <td className="py-1.5 text-right tabular-nums">{formatINR(debitTotal)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatINR(creditTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-sm text-slate-700">
        <span className="text-slate-500">Amount in words: </span>
        {amountInWords(debitTotal)}
      </p>
      <p className="mt-2 text-sm text-slate-700">
        <span className="text-slate-500">Narration: </span>
        {voucher.narration}
      </p>

      <div className="mt-8 grid grid-cols-3 gap-6 text-xs text-slate-500">
        <div className="border-t border-slate-300 pt-1 text-center">Prepared by</div>
        <div className="border-t border-slate-300 pt-1 text-center">Checked by</div>
        <div className="border-t border-slate-300 pt-1 text-center">Authorised by</div>
      </div>
    </Card>
  )
}
