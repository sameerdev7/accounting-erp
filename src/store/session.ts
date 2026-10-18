import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/db/schema'
import { can, type Permission } from '@/services/auth'
import type { Actor } from '@/services/ledger'

/**
 * The signed-in session. Persisted to localStorage so a refresh does not throw
 * the user back to the login screen, but the password is never kept — only the
 * identity and role needed to render the UI and build an `Actor` for services.
 */
export interface SessionState {
  user: {
    id: string
    username: string
    name: string
    role: UserRole
  } | null
  signIn: (user: SessionState['user']) => void
  signOut: () => void
  /** True when the current role holds `permission`. */
  can: (permission: Permission) => boolean
  /** The actor passed to every service call. Throws when signed out. */
  actor: () => Actor
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
      can: (permission) => {
        const role = get().user?.role
        return role ? can(role, permission) : false
      },
      actor: () => {
        const user = get().user
        if (!user) throw new Error('Not signed in')
        return { userId: user.id, username: user.username, role: user.role }
      },
    }),
    {
      name: 'sai-erp-session',
      partialize: (state) => ({ user: state.user }),
    },
  ),
)

/** Convenience selector hook for permission checks inside components. */
export function usePermission(permission: Permission): boolean {
  return useSession((state) => (state.user ? can(state.user.role, permission) : false))
}
