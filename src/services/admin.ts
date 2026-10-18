import { db, type PeriodLock, type User, type UserRole } from '@/db/schema'
import { writeTx } from '@/db/tx'
import {
  DEFAULT_PASSWORD,
  hashPassword,
  makeSalt,
  validatePasswordStrength,
  verifyPassword,
} from './auth'
import { writeAudit, writeAudit as audit } from './audit'
import { newId } from '@/lib/id'
import { describePeriodLock } from './controls'
import type { Actor } from './ledger'

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/* ==========================================================================
 * Authentication
 * ========================================================================== */

export interface SessionUser {
  id: string
  username: string
  name: string
  role: UserRole
}

/**
 * Verifies credentials and records the attempt in the audit trail. The
 * username is compared case-insensitively; the password never leaves the
 * browser and is compared as a salted SHA-256 digest.
 */
export async function login(username: string, password: string): Promise<SessionUser> {
  const normalised = username.trim().toLowerCase()
  const user = await db.users.where('username').equals(normalised).first()

  if (!user) {
    await audit({
      userId: 'anonymous',
      username: normalised || 'unknown',
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: normalised,
      summary: `Failed sign-in attempt for "${normalised}" — no such user`,
    })
    throw new AuthenticationError('Those credentials were not recognised.')
  }

  if (!user.active) {
    await audit({
      userId: user.id,
      username: user.username,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: user.id,
      summary: `Blocked sign-in attempt for deactivated user ${user.username}`,
    })
    throw new AuthenticationError('This account has been deactivated. Speak to the administrator.')
  }

  const ok = await verifyPassword(password, user.salt, user.passwordHash)
  if (!ok) {
    await audit({
      userId: user.id,
      username: user.username,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: user.id,
      summary: `Incorrect password for ${user.username}`,
    })
    throw new AuthenticationError('Those credentials were not recognised.')
  }

  await db.users.update(user.id, { lastLoginAt: Date.now() })
  await audit({
    userId: user.id,
    username: user.username,
    action: 'LOGIN',
    entity: 'users',
    entityId: user.id,
    summary: `${user.name} signed in as ${ROLE_LABELS[user.role]}`,
  })

  return { id: user.id, username: user.username, name: user.name, role: user.role }
}

/** Records a sign-out in the audit trail, then the caller clears the session. */
export async function logout(member: SessionUser): Promise<void> {
  await audit({
    userId: member.id,
    username: member.username,
    action: 'LOGOUT',
    entity: 'users',
    entityId: member.id,
    summary: `${member.name} signed out`,
  })
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  ACCOUNTANT: 'Accountant',
  PURCHASE_OFFICER: 'Purchase Officer',
  SALES_OFFICER: 'Sales Officer',
  APPROVER: 'Approver / Manager',
  AUDITOR: 'Auditor',
}

/* ==========================================================================
 * User administration
 * ========================================================================== */

export async function listUsers(): Promise<User[]> {
  const rows = await db.users.toArray()
  return rows.sort((a, b) => a.username.localeCompare(b.username))
}

export interface UserInput {
  username: string
  name: string
  role: UserRole
  password?: string
}

export async function createUser(actor: Actor, input: UserInput): Promise<User> {
  const username = input.username.trim().toLowerCase()
  if (!username) throw new Error('A username is required')

  const password = input.password && input.password.length > 0 ? input.password : DEFAULT_PASSWORD
  const problem = validatePasswordStrength(password)
  if (problem) throw new Error(problem)

  return writeTx(async () => {
    const clash = await db.users.where('username').equals(username).first()
    if (clash) throw new Error(`The username "${username}" is already taken.`)

    const salt = makeSalt()
    const passwordHash = await hashPassword(password, salt)
    const now = Date.now()

    const user: User = {
      id: newId('user'),
      username,
      name: input.name.trim(),
      salt,
      passwordHash,
      role: input.role,
      active: true,
      lastLoginAt: null,
      createdAt: now,
      createdBy: actor.userId,
    }
    await db.users.add(user)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'CREATE',
      entity: 'users',
      entityId: user.id,
      summary: `Created user ${username} with the ${ROLE_LABELS[input.role]} role`,
      after: { username, role: input.role },
    })

    return user
  })
}

export async function updateUser(
  actor: Actor,
  userId: string,
  patch: { name?: string; role?: UserRole; active?: boolean },
): Promise<User> {
  return writeTx(async () => {
    const user = await db.users.get(userId)
    if (!user) throw new Error('User not found')

    // Never let the last administrator be locked out of the system.
    if ((patch.role && patch.role !== 'ADMIN') || patch.active === false) {
      const admins = (await db.users.toArray()).filter(
        (row) => row.role === 'ADMIN' && row.active && row.id !== userId,
      )
      if (user.role === 'ADMIN' && admins.length === 0) {
        throw new Error('There must always be at least one active administrator.')
      }
    }

    await db.users.update(userId, patch)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'UPDATE',
      entity: 'users',
      entityId: userId,
      summary: `Updated user ${user.username}`,
      before: { name: user.name, role: user.role, active: user.active },
      after: patch,
    })

    return { ...user, ...patch }
  })
}

export async function resetPassword(
  actor: Actor,
  userId: string,
  newPassword: string,
): Promise<void> {
  const problem = validatePasswordStrength(newPassword)
  if (problem) throw new Error(problem)

  return writeTx(async () => {
    const user = await db.users.get(userId)
    if (!user) throw new Error('User not found')

    const salt = makeSalt()
    const passwordHash = await hashPassword(newPassword, salt)
    await db.users.update(userId, { salt, passwordHash })

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'RESET_PASSWORD',
      entity: 'users',
      entityId: userId,
      summary: `Reset the password for ${user.username}`,
    })
  })
}

/* ==========================================================================
 * Period locks
 * ========================================================================== */

export async function listPeriodLocks(): Promise<PeriodLock[]> {
  const rows = await db.periodLocks.toArray()
  return rows.sort((a, b) => (a.period < b.period ? 1 : -1))
}

/**
 * Closes a month (or a whole financial year) to new postings, so that historic
 * figures cannot be restated after they have been reported on.
 */
export async function lockPeriod(
  actor: Actor,
  input: { period: string; type: 'MONTH' | 'FY'; note: string },
): Promise<PeriodLock> {
  return writeTx(async () => {
    const clash = await db.periodLocks
      .where('[period+type]')
      .equals([input.period, input.type])
      .first()
    if (clash) throw new Error(`${describePeriodLock(clash)} is already locked.`)

    const lock: PeriodLock = {
      id: newId('lock'),
      period: input.period,
      type: input.type,
      lockedBy: actor.userId,
      note: input.note,
      createdAt: Date.now(),
      createdBy: actor.userId,
    }
    await db.periodLocks.add(lock)

    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'LOCK_PERIOD',
      entity: 'periodLocks',
      entityId: lock.id,
      summary: `Locked ${describePeriodLock(lock)}${input.note ? ` — ${input.note}` : ''}`,
      after: lock,
    })

    return lock
  })
}

export async function unlockPeriod(actor: Actor, lockId: string): Promise<void> {
  return writeTx(async () => {
    const lock = await db.periodLocks.get(lockId)
    if (!lock) throw new Error('That period lock no longer exists.')

    await db.periodLocks.delete(lockId)
    await writeAudit({
      userId: actor.userId,
      username: actor.username,
      action: 'UNLOCK_PERIOD',
      entity: 'periodLocks',
      entityId: lockId,
      summary: `Re-opened ${describePeriodLock(lock)}`,
      before: lock,
    })
  })
}
