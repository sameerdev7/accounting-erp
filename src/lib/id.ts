/**
 * Identifier helpers. Every document gets a stable, collision-free string id so
 * that references between tables stay valid regardless of insertion order.
 */

export function newId(prefix?: string): string {
  const uuid =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackUuid()

  return prefix ? `${prefix}_${uuid}` : uuid
}

function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

/** Deterministic key for singleton tables such as `company` and `settings`. */
export const SINGLETON_KEYS = {
  company: 'company',
} as const
