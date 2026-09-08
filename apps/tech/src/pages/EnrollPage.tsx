import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { EnrollResponse } from '@avroleva/contracts'
import { useApp } from '../app/AppProvider'
import { saveSession } from '../app/session'
import { Field } from '../components/ui'
import { setMeta } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { guessDeviceName } from '../lib/maps'
import { ApiError, platform } from '../platform'
import { getApiBaseOverride, setApiBaseOverride } from '../platform/http'
import { pull } from '../sync'
import { APP_VERSION } from '../version'

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function barcodeDetector(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

function canScan(): boolean {
  return !!barcodeDetector() && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/** The QR payload is the app URL with `?enroll=<code>`; a bare code is accepted too. */
function codeFromScan(raw: string): string {
  try {
    const u = new URL(raw)
    return u.searchParams.get('enroll') ?? raw
  } catch {
    return raw.trim()
  }
}

function Scanner({ onResult, onError }: { onResult: (code: string) => void; onError: () => void }) {
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
              if (hit) onResult(codeFromScan(hit.rawValue))
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
  const [code, setCode] = useState(fromUrl)
  const [deviceName, setDeviceName] = useState(() => app.meta.deviceName ?? guessDeviceName())
  const [apiBase, setApiBase] = useState(getApiBaseOverride())
  const [scanning, setScanning] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(!canScan())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (fromUrl) nameRef.current?.focus()
  }, [fromUrl])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const base = apiBase.trim().replace(/\/$/, '')
      setApiBaseOverride(base)
      await setMeta('apiBase', base)
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
            onResult={(c) => {
              setCode(c)
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
            onChange={(e) => setCode(e.target.value)}
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
        <details className="advanced">
          <summary>{t('tech.enroll.apiBase')}</summary>
          <input
            type="url"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="https://"
            autoCapitalize="off"
            spellCheck={false}
          />
        </details>
        {error ? <div className="banner banner-danger">{error}</div> : null}
        <button
          type="submit"
          className="btn btn-primary btn-big"
          disabled={busy || !code.trim() || !deviceName.trim()}
        >
          {busy ? t('tech.enroll.working') : t('tech.enroll.submit')}
        </button>
      </form>
      <p className="muted small center">{`v${APP_VERSION}`}</p>
    </div>
  )
}
