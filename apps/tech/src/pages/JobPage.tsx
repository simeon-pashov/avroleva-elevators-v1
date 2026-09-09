import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import type { JobEventPayload } from '@avroleva/contracts'
import { useToast } from '../components/Toast'
import { Empty, PageHeader, Spinner, StatusPill, TelLink } from '../components/ui'
import type { AttachmentUploadPayload, BlobRow, RepairJobRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { uuidv7 } from '../lib/ids'
import { navigationUrl } from '../lib/maps'
import { processPhoto } from '../lib/photos'
import { platform } from '../platform'
import { buildOutboxRow, completePlanStops, deviceTime, requestDrain } from '../sync'
import { houseManager } from './TodayPage'

interface Photo {
  id: string
  blob: Blob
  sha256: string
  takenAt: string
  url: string
}

/**
 * One repair job assigned to me: start, notes, photos, complete. Every action is an outbox item
 * (`job.event`) with the device time; completion carries a client-generated visit id and the
 * photo links so the server records the repair visit, then the photos upload against it.
 */
export function JobPage() {
  const { id } = useParams()
  const { t, dateTime } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const job = useLiveQuery(() => (id ? db.repairJobs.get(id) : undefined), [id])
  const building = useLiveQuery(
    () => (job ? db.buildings.get(job.buildingId) : undefined),
    [job?.buildingId],
  )
  const contacts = useLiveQuery(
    () => (job ? db.contacts.where('buildingId').equals(job.buildingId).toArray() : []),
    [job?.buildingId],
  )
  const [note, setNote] = useState('')
  const [parts, setParts] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (job === undefined) {
    return (
      <>
        <PageHeader title={t('tech.jobs.title')} back />
        <Spinner />
      </>
    )
  }
  if (!job) {
    return (
      <>
        <PageHeader title={t('tech.jobs.title')} back />
        <div className="page">
          <Empty text={t('tech.jobs.empty')} />
        </div>
      </>
    )
  }
  const contact = houseManager(contacts ?? [])
  const localDone = job.local === 'done'

  const push = async (payload: JobEventPayload, patch: Partial<RepairJobRow>) => {
    await db.transaction('rw', [db.repairJobs, db.outbox], async () => {
      await db.outbox.add(
        buildOutboxRow({ kind: 'job.event', payload, elevatorId: job.elevatorId }),
      )
      await db.repairJobs.update(job.id, patch)
    })
    void requestDrain()
  }

  const start = async () => {
    setBusy(true)
    try {
      const dt = deviceTime()
      await push(
        { jobId: job.id, type: 'start', ...dt, notes: note.trim() || null, attachments: [] },
        { status: 'in_progress', startedAt: dt.at },
      )
      setNote('')
      toast.show(t('tech.jobs.done'))
    } finally {
      setBusy(false)
    }
  }

  const addNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    try {
      const dt = deviceTime()
      await push(
        { jobId: job.id, type: 'note', ...dt, notes: note.trim(), attachments: [] },
        { notes: job.notes ? `${job.notes}\n${note.trim()}` : note.trim() },
      )
      setNote('')
      toast.show(t('tech.jobs.done'))
    } finally {
      setBusy(false)
    }
  }

  const addPhoto = async () => {
    const file = await platform.camera.pickPhoto()
    if (!file) return
    const p = await processPhoto(file)
    const photo: Photo = {
      id: uuidv7(),
      blob: p.blob,
      sha256: p.sha256,
      takenAt: new Date().toISOString(),
      url: URL.createObjectURL(p.blob),
    }
    setPhotos((ps) => [...ps, photo])
  }

  const complete = async () => {
    setBusy(true)
    try {
      const dt = deviceTime()
      const visitId = uuidv7()
      const payload: JobEventPayload = {
        jobId: job.id,
        type: 'complete',
        ...dt,
        notes: note.trim() || null,
        partsUsed: parts.trim() || null,
        startedAt: job.startedAt ?? undefined,
        visitId,
        attachments: photos.map((p) => ({ id: p.id, role: 'photo' as const })),
      }
      const blobRows: BlobRow[] = photos.map((p) => ({
        id: p.id,
        blob: p.blob,
        sha256: p.sha256,
        takenAt: p.takenAt,
        visitId,
        role: 'photo',
        bytes: p.blob.size,
      }))
      // Parent before child: the completion (creates the visit), then its photos.
      const rows = [
        buildOutboxRow({ kind: 'job.event', payload, visitId, elevatorId: job.elevatorId }),
        ...photos.map((p) => {
          const up: AttachmentUploadPayload = {
            attachmentId: p.id,
            visitId,
            role: 'photo',
            takenAt: p.takenAt,
            sha256: p.sha256,
          }
          return buildOutboxRow({
            kind: 'attachment.upload',
            payload: up,
            visitId,
            elevatorId: job.elevatorId,
          })
        }),
      ]
      await db.transaction('rw', [db.repairJobs, db.blobs, db.outbox, db.dayPlans], async () => {
        if (blobRows.length) await db.blobs.bulkAdd(blobRows)
        await db.outbox.bulkAdd(rows)
        await db.repairJobs.update(job.id, {
          status: 'done',
          completedAt: dt.at,
          visitId,
          local: 'done',
        })
        // The job's stop in today's plan is done with it (step 9).
        await completePlanStops({ kind: 'job', refId: job.id }, dt)
      })
      void requestDrain()
      toast.show(t('tech.jobs.done'))
      navigate('/', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={job.title} back subtitle={job.buildingAddressText} />
      <div className="page">
        <div className="card">
          <div className="inline">
            <span className="strong">{`${t('callbacks.elevator')} ${job.elevatorInternalNo}`}</span>
            <StatusPill
              tone={job.status === 'in_progress' ? 'warn' : localDone ? 'ok' : 'muted'}
              text={localDone ? t('tech.jobs.completedLocal') : t(`enum.jobStage.${job.status}`)}
            />
            <StatusPill tone="muted" text={t(`enum.jobKind.${job.kind}`)} />
          </div>
          {job.scheduledAt ? (
            <div className="muted small">
              {t('tech.jobs.scheduledFor', { at: dateTime(job.scheduledAt) })}
            </div>
          ) : null}
          {job.description ? <p>{job.description}</p> : null}
          {job.notes ? <p className="small pre">{job.notes}</p> : null}
          <div className="card-actions">
            <TelLink phone={contact?.phone} />
            {building && building.lat != null && building.lng != null ? (
              <a
                className="btn btn-outline"
                href={navigationUrl(building.lat, building.lng)}
                target="_blank"
                rel="noreferrer"
              >
                {t('tech.today.navigate')}
              </a>
            ) : null}
          </div>
        </div>
        {!localDone ? (
          <div className="card">
            <label className="field">
              <span className="field-label">{t('tech.jobs.note')}</span>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
              />
            </label>
            <div className="card-actions">
              {job.status !== 'in_progress' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  {t('tech.jobs.start')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy || !note.trim()}
                onClick={() => void addNote()}
              >
                {t('tech.jobs.addNote')}
              </button>
            </div>
          </div>
        ) : null}
        {!localDone ? (
          <div className="card">
            <div className="card-title">{t('tech.jobs.complete')}</div>
            <p className="muted small">{t('tech.jobs.completeHint')}</p>
            <label className="field">
              <span className="field-label">{t('tech.jobs.partsUsed')}</span>
              <input value={parts} onChange={(e) => setParts(e.target.value)} maxLength={2000} />
            </label>
            <div className="field">
              <span className="field-label">{t('tech.jobs.photos')}</span>
              <div className="thumbs">
                {photos.map((p) => (
                  <img key={p.id} src={p.url} alt="" className="thumb" />
                ))}
              </div>
              <button type="button" className="btn btn-outline" onClick={() => void addPhoto()}>
                {t('tech.jobs.addPhoto')}
              </button>
            </div>
            <div className="card-actions">
              {confirming ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void complete()}
                  >
                    {t('tech.jobs.confirmComplete')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setConfirming(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  {t('tech.jobs.complete')}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
