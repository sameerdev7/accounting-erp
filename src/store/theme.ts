import { create } from 'zustand'

/**
 * UI-only theme state. Three modes — light, dark or follow the OS — persisted to
 * localStorage under a key that the inline bootstrap script in `index.html` reads
 * so the correct scheme is painted before first render (no flash).
 *
 * Everything here touches the DOM class list and a storage key; no application
 * data is involved.
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'sai-erp-theme'

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode
}

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* ignore */
  }
  return 'system'
}

/** Paint the resolved theme onto <html> and return what was applied. */
function paint(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }
  return resolved
}

const initialMode = typeof window === 'undefined' ? 'system' : readStoredMode()
paint(initialMode)

interface ThemeState {
  mode: ThemeMode
  /** What is actually showing once `system` is resolved. */
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  /** Cycle light → dark → system. */
  cycle: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: resolveTheme(initialMode),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
    set({ mode, resolved: paint(mode) })
  },
  cycle: () => {
    const order: ThemeMode[] = ['light', 'dark', 'system']
    get().setMode(order[(order.indexOf(get().mode) + 1) % order.length])
  },
}))

if (typeof window !== 'undefined') {
  // Keep in step with the OS while in `system` mode.
  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (useTheme.getState().mode === 'system') {
        useTheme.setState({ resolved: paint('system') })
      }
    })
  }

  // Printing always looks best on white, so drop the dark class for the duration
  // of the print job and restore it afterwards.
  window.addEventListener('beforeprint', () => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = 'light'
  })
  window.addEventListener('afterprint', () => {
    paint(useTheme.getState().mode)
  })
}
