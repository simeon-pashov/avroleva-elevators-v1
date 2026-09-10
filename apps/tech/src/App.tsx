import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useApp } from './app/AppProvider'
import { Shell } from './components/Shell'
import { Spinner } from './components/ui'
import { useT } from './i18n/I18nProvider'
import { parseEnrollLink } from './lib/enrollLink'
import { platform } from './platform'
import { EnrollPage } from './pages/EnrollPage'
import { TodayPage } from './pages/TodayPage'
import { ElevatorPage } from './pages/ElevatorPage'
import { VisitPage } from './pages/VisitPage'
import { CallbacksPage } from './pages/CallbacksPage'
import { JobPage } from './pages/JobPage'
import { OutboxPage } from './pages/OutboxPage'
import { SettingsPage } from './pages/SettingsPage'

function RequireSession() {
  const app = useApp()
  if (!app.hasSession || app.needsReenroll) return <Navigate to="/enroll" replace />
  return <Shell />
}

function UpdateRequired() {
  const t = useT()
  const app = useApp()
  return (
    <div className="page-plain">
      <div className="hero-icon" aria-hidden="true">
        ⬆️
      </div>
      <p className="center">{t('tech.updateRequired')}</p>
      <button type="button" className="btn btn-primary btn-big" onClick={app.applyUpdate}>
        {t('tech.reload')}
      </button>
    </div>
  )
}

/**
 * Native shell hooks (no-ops on the web): a deep link (`avroleva-elevators://enroll?...` or the
 * https `/tech/?enroll=` link) opens the Enroll screen with server + code prefilled, both on a
 * cold start and while running; the Android back button pops the router history and leaves the
 * app from the root screen.
 */
function useAppHost() {
  const navigate = useNavigate()
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  useEffect(() => {
    pathRef.current = location.pathname
  }, [location.pathname])
  useEffect(() => {
    const open = (url: string) => {
      const link = parseEnrollLink(url)
      if (!link) return
      const q = new URLSearchParams({ enroll: link.code })
      if (link.server) q.set('server', link.server)
      navigate(`/enroll?${q.toString()}`, { replace: true })
    }
    void platform.appHost.takeLaunchUrl().then((url) => {
      if (url) open(url)
    })
    const offUrl = platform.appHost.onUrlOpen(open)
    const offBack = platform.appHost.onBackButton((canGoBack) => {
      if (pathRef.current === '/' || pathRef.current === '/enroll' || !canGoBack)
        platform.appHost.exit()
      else navigate(-1)
    })
    return () => {
      offUrl()
      offBack()
    }
  }, [navigate])
}

export function App() {
  const app = useApp()
  const location = useLocation()
  useAppHost()
  if (app.updateRequired) return <UpdateRequired />
  if (!app.ready) return <Spinner />
  // The office QR encodes `<origin>/tech/?enroll=<code>`: hand the code to the Enroll screen.
  const enrollCode = new URLSearchParams(location.search).get('enroll')
  if (enrollCode && location.pathname !== '/enroll') {
    return <Navigate to={`/enroll?enroll=${encodeURIComponent(enrollCode)}`} replace />
  }
  return (
    <Routes>
      <Route path="/enroll" element={<EnrollPage />} />
      <Route element={<RequireSession />}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/elevators/:id" element={<ElevatorPage />} />
        <Route path="/elevators/:id/visit" element={<VisitPage />} />
        <Route path="/callbacks" element={<CallbacksPage />} />
        <Route path="/jobs/:id" element={<JobPage />} />
        <Route path="/outbox" element={<OutboxPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
