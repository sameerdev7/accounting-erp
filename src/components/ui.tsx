import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/* ==========================================================================
 * Primitives
 * ========================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variantClass = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    danger: 'btn-danger',
    ghost: 'btn-ghost',
  }[variant]
  return <button type="button" className={`${variantClass} ${className}`} {...props} />
}

export interface FieldProps {
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, className = '', children }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="label">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>
      )}
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input ${className}`} rows={2} {...props} />
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input ${className}`} {...props}>
      {children}
    </select>
  )
}

/* ==========================================================================
 * Layout helpers
 * ========================================================================== */

export function Card({
  title,
  actions,
  className = '',
  bodyClassName = 'card-pad',
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'warning'
}) {
  const toneClass = {
    default: 'text-slate-900 dark:text-slate-100',
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-red-600 dark:text-red-400',
    warning: 'text-amber-600 dark:text-amber-400',
  }[tone]
  return (
    <div className="card card-pad group relative overflow-hidden transition-shadow hover:shadow-card-lg">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-brand-500/70 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

export type BadgeTone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet'

export function Badge({ tone = 'slate', children }: { tone?: BadgeTone; children: ReactNode }) {
  const toneClass: Record<BadgeTone, string> = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}
    >
      {children}
    </span>
  )
}

/** Colour-coded badge for the many status enums in the system. */
const STATUS_TONES: Record<string, BadgeTone> = {
  POSTED: 'green',
  APPROVED: 'blue',
  CONFIRMED: 'blue',
  RECEIVED: 'green',
  DELIVERED: 'green',
  INVOICED: 'violet',
  CLOSED: 'slate',
  PENDING: 'amber',
  SUBMITTED: 'amber',
  DRAFT: 'slate',
  PARTIAL: 'amber',
  REVERSED: 'red',
  CANCELLED: 'red',
  REJECTED: 'red',
  DISPOSED: 'red',
}

export function StatusBadge({ status }: { status: string | undefined | null }) {
  if (!status) return <span className="text-slate-400 dark:text-slate-500">—</span>
  const tone = STATUS_TONES[status] ?? 'slate'
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success'
  children: ReactNode
}) {
  const toneClass = {
    info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  }[tone]
  return <div className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>{children}</div>
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <p className="text-sm text-slate-400 dark:text-slate-500">{message}</p>
      {action}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-400 dark:text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-700 dark:border-t-brand-400" />
      {label}
    </div>
  )
}

/* ==========================================================================
 * Modal
 * ========================================================================== */

export function Modal({
  open,
  title,
  onClose,
  footer,
  width = 'max-w-3xl',
  children,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8 dark:bg-black/70">
      <div className={`w-full ${width} animate-scale-in rounded-xl bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="card-pad">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
 * Page header
 * ========================================================================== */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
