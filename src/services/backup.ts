import type { Table } from 'dexie'
import { db } from '@/db/schema'
import { getSetting, setSetting, writeTx } from '@/db/tx'
import { newId } from '@/lib/id'
import { writeAudit } from './audit'
import type { Actor } from './ledger'

/**
 * Full-fidelity JSON backup.
 *
 * The application keeps all of its data in IndexedDB, which a browser can clear
 * without warning, so a portable export is the only durable safety net. Import
 * replaces the database wholesale rather than merging, which keeps the restore
 * path simple and predictable.
 */

export const BACKUP_TABLES: Record<string, Table<any>> = {
  company: db.company,
  accounts: db.accounts,
  customers: db.customers,
  suppliers: db.suppliers,
  items: db.items,
  employees: db.employees,
  attendance: db.attendance,
  purchaseRequisitions: db.purchaseRequisitions,
  purchaseRequisitionLines: db.purchaseRequisitionLines,
  purchaseOrders: db.purchaseOrders,
  purchaseOrderLines: db.purchaseOrderLines,
  grns: db.grns,
  grnLines: db.grnLines,
  salesOrders: db.salesOrders,
  salesOrderLines: db.salesOrderLines,
  deliveries: db.deliveries,
  deliveryLines: db.deliveryLines,
  invoices: db.invoices,
  invoiceLines: db.invoiceLines,
  vouchers: db.vouchers,
  ledgerEntries: db.ledgerEntries,
  stockMovements: db.stockMovements,
  allocations: db.allocations,
  assets: db.assets,
  depreciationEntries: db.depreciationEntries,
  payrollRuns: db.payrollRuns,
  payslips: db.payslips,
  users: db.users,
  auditLog: db.auditLog,
  sequences: db.sequences,
  periodLocks: db.periodLocks,
  settings: db.settings,
}

export const BACKUP_FORMAT_VERSION = 1
export const LAST_BACKUP_KEY = 'backup.lastAt'

export interface BackupFile {
  format: 'sai-erp-backup'
  version: number
  exportedAt: string
  exportedBy: string
  counts: Record<string, number>
  data: Record<string, unknown[]>
}

export async function exportBackup(actor: Actor): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}

  for (const [name, table] of Object.entries(BACKUP_TABLES)) {
    const rows = await table.toArray()
    data[name] = rows
    counts[name] = rows.length
  }

  const file: BackupFile = {
    format: 'sai-erp-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: actor.username,
    counts,
    data,
  }

  await setSetting(LAST_BACKUP_KEY, Date.now())
  await writeAudit({
    userId: actor.userId,
    username: actor.username,
    action: 'BACKUP',
    entity: 'settings',
    entityId: 'backup',
    summary: `Exported a full JSON backup (${counts.ledgerEntries ?? 0} ledger lines, ${counts.invoices ?? 0} invoices)`,
  })

  return file
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `sai-erp-backup-${stamp}.json`
}

export async function importBackup(actor: Actor, file: BackupFile): Promise<void> {
  if (file.format !== 'sai-erp-backup') {
    throw new Error('That file is not a backup produced by this application.')
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was written by a newer version (v${file.version}); this build understands up to v${BACKUP_FORMAT_VERSION}.`,
    )
  }

  await writeTx(async () => {
    for (const [name, table] of Object.entries(BACKUP_TABLES)) {
      await table.clear()
      const rows = file.data[name]
      if (Array.isArray(rows) && rows.length > 0) {
        await table.bulkAdd(rows as never[])
      }
    }

    await db.auditLog.add({
      id: newId('audit'),
      ts: Date.now(),
      userId: actor.userId,
      username: actor.username,
      action: 'RESTORE',
      entity: 'database',
      entityId: 'backup',
      summary: `Restored a backup exported on ${file.exportedAt}`,
      after: { exportedAt: file.exportedAt, exportedBy: file.exportedBy },
    })
  })
}

/** Rebuilds the seeded dataset from scratch (all user changes are discarded). */
export async function resetAllData(actor: Actor): Promise<void> {
  const { seedDatabase } = await import('@/db/seed')
  await seedDatabase({ reset: true, actor })
}

export async function lastBackupAt(): Promise<number | null> {
  const value = await getSetting<number | null>(LAST_BACKUP_KEY, null)
  return typeof value === 'number' ? value : null
}

/** Days since the last backup, or null when there has never been one. */
export async function daysSinceLastBackup(): Promise<number | null> {
  const at = await lastBackupAt()
  if (!at) return null
  return Math.floor((Date.now() - at) / 86_400_000)
}

export const BACKUP_REMINDER_DAYS = 7

/**
 * The specification asks for an automatic reminder when no backup has been taken
 * for a week. Returns the number of days overdue, or 0 when nothing is due.
 */
export async function backupReminderDays(): Promise<number> {
  const days = await daysSinceLastBackup()
  if (days === null) return 0
  return days >= BACKUP_REMINDER_DAYS ? days : 0
}
