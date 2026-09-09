import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useApp } from './app/AppProvider'
import { Shell } from './components/Shell'
import { Spinner } from './components/ui'
import { useT } from './i18n/I18nProvider'
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

export function App() {
  const app = useApp()
  const location = useLocation()
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
