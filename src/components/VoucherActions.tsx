import { useState } from 'react'
import type { Voucher } from '@/db/schema'
import { releaseSettlement } from '@/services/cashbank'
import {
  approveVoucher,
  postVoucher,
  reverseVoucher,
  submitVoucher,
} from '@/services/ledger'
import { useSession } from '@/store/session'
import { Button, Modal, Textarea } from './ui'

/**
 * The approval-lifecycle buttons for a voucher, permission-gated by the session
 * role. Every action routes through the ledger service, so the same maker–checker
 * and threshold rules apply here as anywhere else — the UI cannot bypass them.
 */
export function VoucherActions({
  voucher,
  onChanged,
}: {
  voucher: Voucher
  onChanged?: () => void
}) {
  const actor = useSession((state) => state.actor)
  const can = useSession((state) => state.can)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')

  const doWork = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChanged?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {voucher.status === 'DRAFT' && (can('voucher.create') || can('voucher.post')) && (
        <Button variant="primary" disabled={busy} onClick={() => doWork(() => submitVoucher(actor(), voucher.id))}>
          Submit for approval
        </Button>
      )}

      {voucher.status === 'PENDING' && can('voucher.approve') && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            doWork(() =>
              voucher.type === 'PAYMENT'
                ? releaseSettlement(actor(), voucher.id)
                : approveVoucher(actor(), voucher.id),
            )
          }
        >
          {voucher.type === 'PAYMENT' ? 'Approve & post' : 'Approve'}
        </Button>
      )}

      {voucher.status === 'APPROVED' && can('voucher.post') && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            doWork(() =>
              voucher.type === 'PAYMENT'
                ? releaseSettlement(actor(), voucher.id)
                : postVoucher(actor(), voucher.id),
            )
          }
        >
          {voucher.type === 'PAYMENT' ? 'Post & settle' : 'Post to ledger'}
        </Button>
      )}

      {voucher.status === 'POSTED' && can('voucher.post') && (
        <Button variant="danger" disabled={busy} onClick={() => setReversing(true)}>
          Reverse
        </Button>
      )}

      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}

      <Modal
        open={reversing}
        title={`Reverse ${voucher.number}`}
        onClose={() => setReversing(false)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setReversing(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy || !reason.trim()}
              onClick={() =>
                doWork(async () => {
                  await reverseVoucher(actor(), voucher.id, reason)
                  setReversing(false)
                  setReason('')
                })
              }
            >
              Post reversal
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
          A posted voucher is never edited. Reversing it posts a mirror entry so the ledger and the
          audit trail both remain intact.
        </p>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for the reversal (required)"
        />
      </Modal>
    </div>
  )
}
