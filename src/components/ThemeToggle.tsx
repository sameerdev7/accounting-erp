import type { ReactNode } from 'react'
import { useTheme, type ThemeMode } from '@/store/theme'

const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

const MoonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

const SystemIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
)

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: ReactNode }> = [
  { mode: 'light', label: 'Light', icon: SunIcon },
  { mode: 'dark', label: 'Dark', icon: MoonIcon },
  { mode: 'system', label: 'System', icon: SystemIcon },
]

/** A three-way light / dark / follow-system switch. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const mode = useTheme((state) => state.mode)
  const setMode = useTheme((state) => state.setMode)

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-slate-800/70 ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = mode === option.mode
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(option.mode)}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            className={`rounded-full p-1.5 transition-colors ${
              active
                ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-950 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {option.icon}
          </button>
        )
      })}
    </div>
  )
}
