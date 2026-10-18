import type { UserRole } from '@/db/schema'

export const ROLES: UserRole[] = [
  'ADMIN',
  'ACCOUNTANT',
  'PURCHASE_OFFICER',
  'SALES_OFFICER',
  'APPROVER',
  'AUDITOR',
]

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  ADMIN: 'Full access: masters, all vouchers, approvals, payroll, administration.',
  ACCOUNTANT: 'Keeps the books: masters, vouchers, payments, payroll, GST, reports. Cannot approve.',
  PURCHASE_OFFICER: 'Raises requisitions and purchase orders. Cannot post payments.',
  SALES_OFFICER: 'Takes orders and makes deliveries. Cannot post receipts.',
  APPROVER: 'Manager / Finance Head. Approves documents within an amount limit.',
  AUDITOR: 'Read-only: reports and the audit log, nothing else.',
}

export type Permission =
  | 'masters.manage'
  | 'purchase.create'
  | 'purchase.approve'
  | 'sales.create'
  | 'voucher.create'
  | 'voucher.approve'
  | 'voucher.post'
  | 'payment.create'
  | 'receipt.create'
  | 'payroll.run'
  | 'assets.manage'
  | 'gst.settle'
  | 'reports.view'
  | 'audit.view'
  | 'admin.users'
  | 'admin.backup'
  | 'admin.periodlock'
  | 'admin.reset'

const ALL_PERMISSIONS: Permission[] = [
  'masters.manage',
  'purchase.create',
  'purchase.approve',
  'sales.create',
  'voucher.create',
  'voucher.approve',
  'voucher.post',
  'payment.create',
  'receipt.create',
  'payroll.run',
  'assets.manage',
  'gst.settle',
  'reports.view',
  'audit.view',
  'admin.users',
  'admin.backup',
  'admin.periodlock',
  'admin.reset',
]

/**
 * The permission matrix from section 11 of the specification. Segregation of
 * duties is enforced here in one place rather than scattered across the UI.
 */
const MATRIX: Record<UserRole, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,

  // Keeps the books but can never approve — the preparer/approver split.
  ACCOUNTANT: [
    'masters.manage',
    'voucher.create',
    'voucher.post',
    'payment.create',
    'receipt.create',
    'payroll.run',
    'assets.manage',
    'gst.settle',
    'reports.view',
    'audit.view',
  ],

  // May raise demand but may never release money.
  PURCHASE_OFFICER: ['purchase.create', 'reports.view'],

  SALES_OFFICER: ['sales.create', 'reports.view'],

  // Approves what others prepared, within an amount limit.
  APPROVER: ['purchase.approve', 'voucher.approve', 'voucher.post', 'reports.view'],

  // Read-only, and explicitly cannot touch the books.
  AUDITOR: ['reports.view', 'audit.view'],
}

export function can(role: UserRole, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false
}

export function permissionsFor(role: UserRole): Permission[] {
  return MATRIX[role] ?? []
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission))
}

/* ==========================================================================
 * Password hashing — Web Crypto SHA-256 with a per-user salt
 * ========================================================================== */

const encoder = new TextEncoder()

export function makeSalt(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 over `salt:password`. This scheme keeps plaintext out of the database
 * but is not a substitute for a real password KDF such as bcrypt/argon2, which
 * the browser cannot provide natively.
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${password}`))
  return toHex(digest)
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPassword(password, salt)
  return timingSafeEqual(actual, expectedHash)
}

/** Constant-time-ish comparison to avoid leaking hash prefixes by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

/** Password policy for the user-administration screen. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 6) return 'Password must be at least 6 characters.'
  if (!/[A-Za-z]/.test(password)) return 'Password must contain a letter.'
  if (!/[0-9]/.test(password)) return 'Password must contain a digit.'
  return null
}

/**
 * The shared password given to every seeded user on first run. Administrators
 * are expected to change it per user from the User Management screen.
 */
export const DEFAULT_PASSWORD = 'erp1234'

/**
 * Idle timeout, as named under "user authentication" in section 11. After this
 * many minutes without any interaction the session is closed and the user must
 * sign in again. Enforced in the app shell; see `src/components/Layout.tsx`.
 */
export const SESSION_TIMEOUT_MINUTES = 30
export const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60 * 1000
