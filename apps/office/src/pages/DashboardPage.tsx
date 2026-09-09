import { useCallback, useEffect, useState } from 'react'
import type {
  BuildingWithElevatorResultDto,
  DashboardDto,
  GeoSuggestionDto,
} from '@avroleva/contracts'
import { get } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { ErrorBox, PageHeader } from '../components/ui'
import { ElevatorPanel } from '../components/ElevatorPanel'
import { DashboardMap } from './dashboard/DashboardMap'
import { DueWidget } from './dashboard/DueWidget'
import { PaymentsWidget } from './dashboard/PaymentsWidget'
import { CallbacksWidget } from './dashboard/CallbacksWidget'
import { DeadlinesStrip } from './dashboard/DeadlinesStrip'
import { ThisMonthStrip } from './dashboard/ThisMonthStrip'
import { JobsStrip } from './dashboard/JobsStrip'
import { AddElevatorHereDialog } from '../components/AddElevatorHereDialog'

/**
 * "Табло": the map with one pin per elevator (colour = due state), the due today/tomorrow list
 * and (owner/office) the payments widget. `version` is bumped after every mutation so all three
 * re-fetch together and pin colours follow.
 */
export function DashboardPage() {
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const [dash, setDash] = useState<DashboardDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [panelId, setPanelId] = useState<string | null>(null)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const closePanel = useCallback(() => setPanelId(null), [])
  // Step 8: a dropped pin (from the address search) and the "add an elevator here" dialog.
  const [dropped, setDropped] = useState<{ lat: number; lng: number } | null>(null)
  const [picked, setPicked] = useState<GeoSuggestionDto | null>(null)
  const [adding, setAdding] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const onCreated = useCallback((r: BuildingWithElevatorResultDto) => {
    setAdding(false)
    setDropped(null)
    setPicked(null)
    if (r.building.lat != null && r.building.lng != null)
      setFocus({ lat: r.building.lat, lng: r.building.lng, zoom: 17 })
    setVersion((v) => v + 1)
    setPanelId(r.elevator.id)
  }, [])

  useEffect(() => {
    let cancelled = false
    get<DashboardDto>('/dashboard')
      .then((d) => {
        if (cancelled) return
        setDash(d)
        setError(null)
      })
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [version])

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={
          dash ? (
            <>
              {date(dash.today)}
              {' · '}
              {t('dashboard.subtitle', {
                overdue: dash.counts.overdue,
                today: dash.counts.today,
                tomorrow: dash.counts.tomorrow,
              })}
            </>
          ) : null
        }
      />
      <ErrorBox error={error} />
      <ThisMonthStrip thisMonth={dash?.thisMonth ?? null} />
      <div className="card map-card">
        <div className="card-head">
          <h2>{t('dashboard.map')}</h2>
          {dash ? (
            <span className="muted small">
              {t('dashboard.elevatorsTotal', { count: dash.counts.elevators })}
            </span>
          ) : null}
        </div>
        <DashboardMap
          pins={dash?.pins ?? []}
          counts={dash?.counts ?? null}
          onOpen={setPanelId}
          search={hasRole('owner', 'office')}
          dropped={dropped}
          onDrop={(p, s) => {
            setDropped(p)
            if (s !== undefined) setPicked(s)
          }}
          onAddHere={() => setAdding(true)}
          focus={focus}
        />
      </div>
      {adding && dropped ? (
        <AddElevatorHereDialog
          point={dropped}
          suggestion={picked}
          onClose={() => setAdding(false)}
          onCreated={onCreated}
        />
      ) : null}
      <CallbacksWidget summary={dash?.callbacks ?? null} onOpen={setPanelId} />
      <DeadlinesStrip deadlines={dash?.deadlines ?? null} />
      {hasRole('owner', 'office') ? <JobsStrip version={version} /> : null}
      <div className="dash-grid">
        <DueWidget
          counts={dash?.counts ?? null}
          version={version}
          onChanged={bump}
          onOpen={setPanelId}
        />
        {hasRole('owner', 'office') ? <PaymentsWidget version={version} onChanged={bump} /> : null}
      </div>
      {panelId ? (
        <ElevatorPanel elevatorId={panelId} onClose={closePanel} onChanged={bump} />
      ) : null}
    </div>
  )
}
