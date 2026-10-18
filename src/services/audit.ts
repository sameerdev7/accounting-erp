import { db, type AuditLogEntry } from '@/db/schema'
import { newId } from '@/lib/id'

export interface AuditInput {
  userId: string
  username: string
  /** Verb, e.g. CREATE, SUBMIT, APPROVE, POST, REVERSE, LOGIN, BACKUP, RESET */
  action: string
  /** Logical table / domain, e.g. 'vouchers', 'invoices', 'users' */
  entity: string
  entityId: string
  /** One-line description rendered in the audit viewer */
  summary: string
  before?: unknown
  after?: unknown
}

/**
 * Appends a row to the audit trail.
 *
 * Called from inside the same Dexie transaction as the change it describes, so
 * a failure to audit rolls back the business change too — the log can never be
 * missing an entry for a successful posting. Rows are append-only: there is no
 * update or delete path anywhere in the application.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  const entry: AuditLogEntry = {
    id: newId('audit'),
    ts: Date.now(),
    userId: input.userId,
    username: input.username,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    summary: input.summary,
    before: input.before,
    after: input.after,
  }

  await db.auditLog.add(entry)
}

export interface AuditQuery {
  from?: string
  to?: string
  userId?: string
  action?: string
  entity?: string
  search?: string
  limit?: number
}

/** Newest first. Filtering is done in memory — the log is small by design. */
export async function queryAuditLog(query: AuditQuery = {}): Promise<AuditLogEntry[]> {
  let rows = await db.auditLog.orderBy('ts').reverse().toArray()

  if (query.from) rows = rows.filter((row) => row.ts >= Date.parse(`${query.from}T00:00:00`))
  if (query.to) rows = rows.filter((row) => row.ts <= Date.parse(`${query.to}T23:59:59.999`))
  if (query.userId) rows = rows.filter((row) => row.userId === query.userId)
  if (query.action) rows = rows.filter((row) => row.action === query.action)
  if (query.entity) rows = rows.filter((row) => row.entity === query.entity)

  if (query.search) {
    const needle = query.search.trim().toLowerCase()
    rows = rows.filter(
      (row) =>
        row.summary.toLowerCase().includes(needle) ||
        row.entity.toLowerCase().includes(needle) ||
        row.action.toLowerCase().includes(needle) ||
        row.username.toLowerCase().includes(needle),
    )
  }

  return query.limit ? rows.slice(0, query.limit) : rows
}

export async function countAuditEntries(): Promise<number> {
  return db.auditLog.count()
}

/** Convenience wrapper so services can log in one line. */
export function auditSummary(action: string, what: string, reference: string): string {
  return `${action} ${what} ${reference}`.trim()
}
