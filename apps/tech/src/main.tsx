import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { AppProvider } from './app/AppProvider'
import { ToastProvider } from './components/Toast'
import { I18nProvider } from './i18n/I18nProvider'
import './styles.css'

const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <AppProvider>
          <BrowserRouter basename={basename}>
            <App />
          </BrowserRouter>
        </AppProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
)
