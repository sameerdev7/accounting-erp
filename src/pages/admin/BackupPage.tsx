import { useState, type ChangeEvent } from 'react'
import { useAsync, useTask } from '@/hooks/async'
import { useSession } from '@/store/session'
import { Alert, Button, Card, Modal, PageHeader, StatCard } from '@/components/ui'
import {
  BACKUP_REMINDER_DAYS,
  backupFileName,
  daysSinceLastBackup,
  exportBackup,
  importBackup,
  lastBackupAt,
  resetAllData,
  type BackupFile,
} from '@/services/backup'
import { downloadJSON } from '@/lib/export'
import { formatDateTime } from '@/lib/format'

/**
 * Backup, restore and data management. The whole database lives in the browser,
 * so a portable JSON export is the only durable safety net.
 */
export function BackupPage() {
  const actor = useSession((state) => state.actor)
  const task = useTask()

  const status = useAsync(
    async () => ({ last: await lastBackupAt(), days: await daysSinceLastBackup() }),
    [],
  )

  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  function exportNow() {
    void task.run(async () => {
      const file = await exportBackup(actor())
      downloadJSON(file, backupFileName())
      status.reload()
      task.setNotice('Backup exported.')
    })
  }

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setParseError(null)
    try {
      const parsed = JSON.parse(await file.text()) as BackupFile
      setPendingImport(parsed)
    } catch (caught) {
      setParseError(caught instanceof Error ? caught.message : 'That file could not be read.')
    }
  }

  function confirmImport() {
    if (!pendingImport) return
    void task.run(async () => {
      await importBackup(actor(), pendingImport)
      setPendingImport(null)
      status.reload()
      task.setNotice('Backup restored.')
    })
  }

  function confirmReset() {
    void task.run(async () => {
      await resetAllData(actor())
      setResetOpen(false)
      status.reload()
      task.setNotice('Data reset.')
    })
  }

  const days = status.data?.days ?? null
  const overdue = days !== null && days >= BACKUP_REMINDER_DAYS

  return (
    <>
      <PageHeader title="Backup & data" subtitle="Export, restore and reset the books" />

      {task.error && (
        <div className="mb-3">
          <Alert tone="error">{task.error}</Alert>
        </div>
      )}
      {task.notice && (
        <div className="mb-3">
          <Alert tone="success">{task.notice}</Alert>
        </div>
      )}
      {overdue && (
        <div className="mb-3">
          <Alert tone="warning">
            It has been {days} days since the last backup. The application asks for one every{' '}
            {BACKUP_REMINDER_DAYS} days.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Last backup"
          value={status.data?.last ? formatDateTime(status.data.last) : 'Never'}
          hint={status.loading ? 'Checking…' : undefined}
        />
        <StatCard
          label="Days since backup"
          value={days === null ? '—' : days}
          tone={overdue ? 'warning' : 'default'}
        />
        <StatCard label="Reminder after" value={`${BACKUP_REMINDER_DAYS} days`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Export backup">
          <p className="mb-3 text-sm text-slate-600">
            Writes the full database — masters, documents, the ledger, the audit trail and
            settings — to a single JSON file you can keep off the machine.
          </p>
          <Button variant="primary" onClick={exportNow} disabled={task.running}>
            {task.running ? 'Working…' : 'Export backup'}
          </Button>
        </Card>

        <Card title="Import backup">
          <p className="mb-3 text-sm text-slate-600">
            Restoring replaces the entire database with the contents of the file. This cannot be
            undone.
          </p>
          {parseError && (
            <div className="mb-3">
              <Alert tone="error">{parseError}</Alert>
            </div>
          )}
          <label className="btn-secondary inline-flex cursor-pointer items-center">
            Choose backup file
            <input type="file" accept="application/json,.json" className="hidden" onChange={onFileChosen} />
          </label>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Reset all data" className="border-red-200">
          <p className="mb-3 text-sm text-slate-600">
            Rebuilds the seeded dataset from scratch. Every change you have made is discarded.
          </p>
          <Button variant="danger" onClick={() => setResetOpen(true)} disabled={task.running}>
            Reset data
          </Button>
        </Card>
      </div>

      <Modal
        open={pendingImport !== null}
        title="Restore from backup?"
        onClose={() => setPendingImport(null)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setPendingImport(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmImport} disabled={task.running}>
              {task.running ? 'Restoring…' : 'Replace all data'}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-600">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          <p>
            This will erase the current database and load the backup
            {pendingImport?.exportedAt ? ` exported on ${formatDateTime(pendingImport.exportedAt)}` : ''}
            {pendingImport?.exportedBy ? ` by ${pendingImport.exportedBy}` : ''}.
          </p>
          <p className="font-medium text-red-700">This action cannot be undone.</p>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        title="Reset all data?"
        onClose={() => setResetOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={confirmReset} disabled={task.running}>
              {task.running ? 'Resetting…' : 'Reset everything'}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-600">
          {task.error && <Alert tone="error">{task.error}</Alert>}
          <p>
            All current masters, documents, ledger entries and audit history will be replaced by a
            fresh seeded dataset.
          </p>
          <p className="font-medium text-red-700">This action cannot be undone.</p>
        </div>
      </Modal>
    </>
  )
}
