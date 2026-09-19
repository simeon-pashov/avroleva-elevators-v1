import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { EnrollResponse } from '@avroleva/contracts'
import { useApp } from '../app/AppProvider'
import { saveSession } from '../app/session'
import { Field } from '../components/ui'
import { useI18n } from '../i18n/I18nProvider'
import type { EnrollLink } from '../lib/enrollLink'
import { parseEnrollLink } from '../lib/enrollLink'
import { guessDeviceName } from '../lib/maps'
import { ApiError, platform } from '../platform'
import { defaultApiBase, effectiveApiBase, persistApiBase } from '../platform/http'
import { pull } from '../sync'
import { APP_VERSION } from '../version'

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function barcodeDetector(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

/**
 * Example server for the hint under the "Server" field: the build's default (`DEFAULT_API_ORIGIN`
 * in the native build), made absolute for the web build where it is only BASE_PATH.
 */
function apiBaseExample(): string {
  const base = defaultApiBase()
  if (/^https?:\/\//i.test(base) || typeof window === 'undefined') return base
  return `${window.location.origin}${base}`
}

function canScan(): boolean {
  return !!barcodeDetector() && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

function Scanner({
  onResult,
  onError,
}: {
  onResult: (link: EnrollLink) => void
  onError: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const Ctor = barcodeDetector()
    const video = videoRef.current
    if (!Ctor || !video) {
      onError()
      return
    }
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let stopped = false
    const detector = new Ctor({ formats: ['qr_code'] })
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          for (const track of s.getTracks()) track.stop()
          return
        }
        stream = s
        video.srcObject = s
        return video.play().catch(() => undefined)
      })
      .then(() => {
        if (stopped) return
        timer = setInterval(() => {
          if (video.readyState < 2) return
          void detector
            .detect(video)
            .then((codes) => {
              const hit = codes.find((c) => c.rawValue)
              const link = hit ? parseEnrollLink(hit.rawValue) : null
              if (link) onResult(link)
            })
            .catch(() => undefined)
        }, 300)
      })
      .catch(() => onError())
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      if (stream) for (const track of stream.getTracks()) track.stop()
    }
  }, [onResult, onError])
  return (
    <div className="scanner">
      <video ref={videoRef} muted playsInline autoPlay />
    </div>
  )
}

function readChosenLocale(): string | null {
  try {
    return localStorage.getItem('avroleva.tech.locale')
  } catch {
    return null
  }
}

export function EnrollPage() {
  const { t, setLocale } = useI18n()
  const app = useApp()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const fromUrl = search.get('enroll') ?? ''
  // The office QR / deep link carries the server (everything before `/tech/`): prefill it.
  const fromServer = search.get('server') ?? ''
  const [code, setCode] = useState(fromUrl)
  const [deviceName, setDeviceName] = useState(() => app.meta.deviceName ?? guessDeviceName())
  const [apiBase, setApiBase] = useState(() => fromServer || effectiveApiBase())
  const [scanning, setScanning] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(!canScan())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // A deep link can arrive while this page is already open (native appUrlOpen -> navigate):
  // follow the URL params, do not only seed the initial state from them.
  useEffect(() => {
    if (fromUrl) {
      setCode(fromUrl)
      nameRef.current?.focus()
    }
  }, [fromUrl])
  useEffect(() => {
    if (fromServer) setApiBase(fromServer)
  }, [fromServer])

  /** A scanned or pasted link fills both fields; a bare code only the code. */
  const applyLink = (link: EnrollLink) => {
    setCode(link.code)
    if (link.server) setApiBase(link.server)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      persistApiBase(apiBase)
      const res = await platform.http.request<EnrollResponse>('POST', '/auth/enroll', {
        body: { token: code.trim(), deviceName: deviceName.trim(), clientVersion: APP_VERSION },
        auth: false,
      })
      await saveSession(res.data, deviceName.trim())
      if (!readChosenLocale()) setLocale(res.data.locale)
      app.refreshSession()
      await pull()
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401 && err.problem.title)
        setError(err.problem.title)
      else setError(t('tech.enroll.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-plain">
      <div className="hero-icon" aria-hidden="true">
        🛗
      </div>
      <h1 className="center">{t('tech.appName')}</h1>
      {app.needsReenroll ? (
        <div className="banner banner-info">{t('tech.enroll.reenroll')}</div>
      ) : null}
      <h2>{t('tech.enroll.title')}</h2>
      <p className="muted small">{t('tech.enroll.hint')}</p>

      {scanning ? (
        <div className="stack">
          <Scanner
            onResult={(link) => {
              applyLink(link)
              setScanning(false)
              nameRef.current?.focus()
            }}
            onError={() => {
              setScanning(false)
              setCameraFailed(true)
            }}
          />
          <button type="button" className="btn" onClick={() => setScanning(false)}>
            {t('tech.enroll.stopScan')}
          </button>
        </div>
      ) : cameraFailed ? (
        <p className="muted small">{t('tech.enroll.noCamera')}</p>
      ) : (
        <button type="button" className="btn btn-outline btn-big" onClick={() => setScanning(true)}>
          {t('tech.enroll.scan')}
        </button>
      )}

      <form className="stack" onSubmit={submit}>
        <Field label={t('tech.enroll.code')}>
          <input
            type="text"
            className="input-code"
            value={code}
            onChange={(e) => {
              const link = parseEnrollLink(e.target.value)
              if (link?.server) applyLink(link)
              else setCode(e.target.value)
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </Field>
        <Field label={t('tech.enroll.deviceName')} hint={t('tech.enroll.deviceNameHint')}>
          <input
            ref={nameRef}
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            maxLength={80}
            required
          />
        </Field>
        {platform.isNative ? (
          <Field
            label={t('tech.enroll.apiBase')}
            hint={t('tech.enroll.apiBaseHint', { example: apiBaseExample() })}
          >
            <input
              type="url"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder={defaultApiBase() || 'https://'}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </Field>
        ) : (
          <details className="advanced">
            <summary>{t('tech.enroll.apiBase')}</summary>
            <input
              type="url"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder={defaultApiBase() || 'https://'}
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="muted small">
              {t('tech.enroll.apiBaseHint', { example: apiBaseExample() })}
            </p>
          </details>
        )}
        {error ? <div className="banner banner-danger">{error}</div> : null}
        <button
          type="submit"
          className="btn btn-primary btn-big"
          disabled={
            busy || !code.trim() || !deviceName.trim() || (platform.isNative && !apiBase.trim())
          }
        >
          {busy ? t('tech.enroll.working') : t('tech.enroll.submit')}
        </button>
      </form>
      <p className="muted small center">{`v${APP_VERSION}`}</p>
    </div>
  )
}
