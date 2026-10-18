import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Account, type Customer, type Item, type Supplier } from '@/db/schema'
import { formatINR, toPaise, type Paise } from '@/lib/money'
import { Input, Select } from './ui'

/* ==========================================================================
 * Master-data hooks — every screen reads masters through these so a change in
 * one place (say, ordering) is consistent everywhere.
 * ========================================================================== */

export interface Masters {
  accounts: Account[]
  customers: Customer[]
  suppliers: Supplier[]
  items: Item[]
  loading: boolean
}

export function useMasters(): Masters {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [])
  const items = useLiveQuery(() => db.items.toArray(), [])

  return {
    accounts: accounts ?? [],
    customers: customers ?? [],
    suppliers: suppliers ?? [],
    items: items ?? [],
    loading: accounts === undefined,
  }
}

export function useAccountMap(): Map<string, Account> {
  const accounts = useLiveQuery(() => db.accounts.toArray(), [])
  return useMemo(() => new Map((accounts ?? []).map((account) => [account.id, account])), [accounts])
}

/* ==========================================================================
 * Selects
 * ========================================================================== */

export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder = 'Select an account',
  includeInactive = false,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  accounts: Account[]
  placeholder?: string
  includeInactive?: boolean
  className?: string
}) {
  const options = accounts
    .filter((account) => includeInactive || account.active)
    .sort((a, b) => a.code.localeCompare(b.code))
  return (
    <Select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} — {account.name}
        </option>
      ))}
    </Select>
  )
}

/** Party select that resolves to the party id (customers and suppliers share a shape). */
export function PartySelect({
  value,
  onChange,
  parties,
  placeholder = 'Select a party',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  parties: Array<Customer | Supplier>
  placeholder?: string
  className?: string
}) {
  return (
    <Select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {parties.map((party) => (
        <option key={party.id} value={party.id}>
          {party.code} — {party.name}
        </option>
      ))}
    </Select>
  )
}

export function ItemSelect({
  value,
  onChange,
  items,
  placeholder = 'Select an item',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  items: Item[]
  placeholder?: string
  className?: string
}) {
  return (
    <Select className={className} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.sku} — {item.name}
        </option>
      ))}
    </Select>
  )
}

/* ==========================================================================
 * Money input — edits rupees, hands back integer paise
 * ========================================================================== */

export function MoneyInput({
  value,
  onChange,
  placeholder = '0.00',
  disabled = false,
  className = '',
}: {
  /** Integer paise. */
  value: Paise
  onChange: (paise: Paise) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : '')

  // Keep in step when the parent resets the form.
  useEffect(() => {
    setText(value ? (value / 100).toFixed(2) : '')
  }, [value])

  return (
    <Input
      className={className}
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const paise = toPaise(text)
        onChange(paise)
        setText(paise ? (paise / 100).toFixed(2) : '')
      }}
    />
  )
}

export function DateInput({
  value,
  onChange,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Input
      type="date"
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** Read-only display of a paise amount, used inside line editors. */
export function MoneyCell({ value }: { value: Paise }) {
  return <span className="tabular-nums">{formatINR(value)}</span>
}
