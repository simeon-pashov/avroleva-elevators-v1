import { useState } from 'react'
import { ApiError } from '../lib/api'

/** Minimal form state: values, server field errors, submit wrapper. */
export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value }))

  const submit = async (fn: (values: T) => Promise<void>) => {
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await fn(values)
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setErrors(e.fieldErrors)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return { values, set, setValues, errors, error, busy, submit }
}

/** Input helpers: empty string -> null for optional numbers. */
export const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s))
export const strOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())
