import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (value: T | null) => void
}

/**
 * Runs an async function on mount and whenever `deps` change. Kept deliberately
 * small — the app's lists mostly use Dexie's `useLiveQuery`, and this covers the
 * report runners and one-shot lookups.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fnRef
      .current()
      .then((value) => {
        if (!cancelled) setData(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, loading, error, reload, setData }
}

export interface TaskState {
  run: (work: () => Promise<void>) => Promise<boolean>
  running: boolean
  error: string | null
  notice: string | null
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  reset: () => void
}

/** Wraps a submit handler with running/error/notice state for forms. */
export function useTask(): TaskState {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<void>) => {
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      await work()
      return true
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      setRunning(false)
    }
  }, [])

  const reset = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  return { run, running, error, notice, setError, setNotice, reset }
}
