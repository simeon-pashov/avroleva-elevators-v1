import { useEffect, useState } from 'react'
import type { ElevatorDto, Page } from '@avroleva/contracts'
import { get, qs } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'

/**
 * Type-ahead over the elevators (address, internal no, reg no) for the intake forms. Picks one
 * elevator; the picked one is shown with a "change" link.
 */
export function ElevatorSearch({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: ElevatorDto | null
  onChange: (e: ElevatorDto | null) => void
  error?: string
  autoFocus?: boolean
}) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<ElevatorDto[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (value) return
    let cancelled = false
    const h = setTimeout(() => {
      get<Page<ElevatorDto>>(`/elevators${qs({ q, limit: 12 })}`)
        .then((p) => !cancelled && setItems(p.items))
        .catch(() => !cancelled && setItems([]))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [q, value])

  if (value)
    return (
      <div className={`field${error ? ' has-error' : ''}`}>
        <span className="field-label">
          {t('callbacks.elevator')}
          <span className="req"> *</span>
        </span>
        <div className="picked">
          <strong>{value.internalNo}</strong>
          {value.regNo ? <span className="muted"> · {value.regNo}</span> : null}
          <div className="small">{value.buildingAddressText}</div>
          <button type="button" className="btn btn-small" onClick={() => onChange(null)}>
            {t('common.edit')}
          </button>
        </div>
      </div>
    )

  return (
    <div className={`field search-field${error ? ' has-error' : ''}`}>
      <span className="field-label">
        {t('callbacks.elevator')}
        <span className="req"> *</span>
      </span>
      <input
        type="search"
        autoFocus={autoFocus}
        value={q}
        placeholder={t('callbacks.elevatorSearch')}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {error ? <span className="field-error">{error}</span> : null}
      {open && items.length > 0 ? (
        <ul className="search-results">
          {items.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  onChange(e)
                  setOpen(false)
                }}
              >
                <strong>{e.internalNo}</strong>
                {e.regNo ? <span className="muted"> · {e.regNo}</span> : null}
                <span className="small muted"> — {e.buildingAddressText}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
