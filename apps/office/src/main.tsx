import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { I18nProvider } from './i18n/I18nProvider'
import { AuthProvider } from './auth/AuthProvider'
import { AdminAuthProvider } from './auth/AdminAuthProvider'
import './styles.css'

const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <AdminAuthProvider>
          <BrowserRouter basename={basename}>
            <App />
          </BrowserRouter>
        </AdminAuthProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
)
