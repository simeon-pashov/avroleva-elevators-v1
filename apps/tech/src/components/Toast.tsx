import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  text: string
  action?: ToastAction
  tone: 'info' | 'error'
}

export interface Toasts {
  show: (text: string, opts?: { action?: ToastAction; tone?: 'info' | 'error' }) => void
}

const ToastContext = createContext<Toasts | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback<Toasts['show']>(
    (text, opts) => {
      seq.current += 1
      const id = seq.current
      setItems((prev) => [
        ...prev.slice(-2),
        { id, text, action: opts?.action, tone: opts?.tone ?? 'info' },
      ])
      setTimeout(() => dismiss(id), opts?.action ? 8000 : 4000)
    },
    [dismiss],
  )

  const value = useMemo<Toasts>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="btn btn-sm btn-light"
                onClick={(e) => {
                  e.stopPropagation()
                  t.action?.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): Toasts {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
