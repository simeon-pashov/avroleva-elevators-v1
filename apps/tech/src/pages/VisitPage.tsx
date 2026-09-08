import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { CHECK_VISIT_KINDS, applicableItems, summarizeChecklist } from '@avroleva/contracts'
import type {
  AttachmentRole,
  ChecklistItemDef,
  ChecklistResult,
  ChecklistSnapshotItem,
  DefectRecordPayload,
  VisitKind,
  VisitRecordPayload,
} from '@avroleva/contracts'
import { useApp } from '../app/AppProvider'
import { useToast } from '../components/Toast'
import { Field, PageHeader, Section, Spinner } from '../components/ui'
import type { AttachmentUploadPayload, BlobRow, DefectRow, VisitRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { uuidv7 } from '../lib/ids'
import { processPhoto } from '../lib/photos'
import { platform } from '../platform'
import { buildOutboxRow, getClockOffsetMs, nowIso, requestDrain } from '../sync'

const KINDS: VisitKind[] = ['functional_check', 'technical_maintenance', 'repair', 'other']
const RESULTS: ChecklistResult[] = ['ok', 'defect', 'na']
const OTHER = '__other__'

interface Answer {
  result: ChecklistResult | null
  note: string
  catalogCode: string
  stopLift: boolean
}
const EMPTY_ANSWER: Answer = { result: null, note: '', catalogCode: '', stopLift: false }

interface LocalPhoto {
  id: string
  blob: Blob
  sha256: string
  url: string
  role: AttachmentRole
  takenAt: string
}

export function VisitPage() {
  const { id = '' } = useParams()
  const { t, pick, time } = useI18n()
  const app = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const me = app.user
  const tenant = app.tenant

  const elevator = useLiveQuery(() => db.elevators.get(id).then((e) => e ?? null), [id])
  const building = useLiveQuery(
    () => (elevator ? db.buildings.get(elevator.buildingId) : undefined),
    [elevator?.buildingId],
  )
  const templates = useLiveQuery(
    () => db.checklistTemplates.where('key').equals('functional_check').toArray(),
    [],
  )
  const catalog = useLiveQuery(() => db.defectCatalog.toArray(), [])
  const users = useLiveQuery(() => db.users.toArray(), [])

  const [startedAt] = useState(() => nowIso())
  const [kind, setKind] = useState<VisitKind>('functional_check')
  const [second, setSecond] = useState('')
  const [otherName, setOtherName] = useState('')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  // Object URLs are released when the screen unmounts (the ref mirrors the latest list).
  const photosRef = useRef<LocalPhoto[]>([])
  useEffect(() => {
    photosRef.current = photos
  }, [photos])
  useEffect(
    () => () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.url)
    },
    [],
  )

  const template = useMemo(() => {
    const active = (templates ?? []).filter((x) => x.active)
    return (
      active.find((x) => x.tenantId && x.tenantId === tenant?.id) ??
      active.find((x) => x.tenantId === null) ??
      active[0]
    )
  }, [templates, tenant?.id])

  const items = useMemo(
    () =>
      template && elevator
        ? applicableItems(template.items, {
            driveType: elevator.driveType,
            doorType: elevator.doorType,
            goodsOnly: elevator.goodsOnly,
          })
        : [],
    [template, elevator],
  )

  const groups = useMemo(() => {
    if (!template) return []
    const byGroup = new Map<string, ChecklistItemDef[]>()
    for (const it of items) {
      const list = byGroup.get(it.group) ?? []
      list.push(it)
      byGroup.set(it.group, list)
    }
    const order = template.groups.map((g) => g.code)
    return [...byGroup.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([code, list]) => ({
        code,
        label: template.groups.find((g) => g.code === code),
        items: list,
      }))
  }, [template, items])

  const checklistOn = CHECK_VISIT_KINDS.includes(kind) && !!template
  const colleagues = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.isActive && u.id !== me?.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'bg')),
    [users, me?.id],
  )
  const unanswered = checklistOn ? items.filter((i) => !answers[i.code]?.result).length : 0
  const defectCount = checklistOn
    ? items.filter((i) => answers[i.code]?.result === 'defect').length
    : 0

  const setAnswer = useCallback((code: string, patch: Partial<Answer>) => {
    setAnswers((prev) => ({ ...prev, [code]: { ...(prev[code] ?? EMPTY_ANSWER), ...patch } }))
  }, [])

  const allOk = () => {
    setAnswers((prev) => {
      const next = { ...prev }
      for (const it of items)
        if (!next[it.code]?.result) next[it.code] = { ...EMPTY_ANSWER, result: 'ok' }
      return next
    })
  }

  const addPhoto = async (role: AttachmentRole) => {
    if (photoBusy) return
    setPhotoBusy(true)
    try {
      const file = await platform.camera.pickPhoto()
      if (!file) return
      const p = await processPhoto(file)
      const photo: LocalPhoto = {
        id: uuidv7(),
        blob: p.blob,
        sha256: p.sha256,
        url: URL.createObjectURL(p.blob),
        role,
        takenAt: nowIso(),
      }
      setPhotos((prev) => [
        ...prev.filter((x) => role !== 'logbook_page' || x.role !== role),
        photo,
      ])
    } catch {
      toast.show(t('attachments.notAnImage'), { tone: 'error' })
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = (photoId: string) => {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === photoId)
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter((p) => p.id !== photoId)
    })
  }

  const save = async () => {
    if (saving || !elevator || !me) return
    if (unanswered > 0 && !window.confirm(t('tech.visit.confirmUnanswered'))) return
    setSaving(true)
    try {
      const visitId = uuidv7()
      const endedAt = nowIso()
      const clientOffsetMs = getClockOffsetMs()
      const colleague = colleagues.find((u) => u.id === second)
      const technicians: VisitRecordPayload['technicians'] = [{ userId: me.id }]
      const technicianNames: Array<{ userId: string | null; name: string }> = [
        { userId: me.id, name: me.name },
      ]
      if (second === OTHER && otherName.trim()) {
        technicians.push({ name: otherName.trim() })
        technicianNames.push({ userId: null, name: otherName.trim() })
      } else if (colleague) {
        technicians.push({ userId: colleague.id })
        technicianNames.push({ userId: colleague.id, name: colleague.name })
      }

      const answered = checklistOn
        ? items.map((it) => {
            const a = answers[it.code]
            const result = a?.result ?? 'na'
            return {
              item: it,
              answer: a ?? EMPTY_ANSWER,
              code: it.code,
              result,
              note: result === 'defect' && a?.note.trim() ? a.note.trim() : null,
            }
          })
        : null

      const gps = tenant?.features.gpsCapture ? await platform.geolocation.getPosition(5000) : null

      const payload: VisitRecordPayload = {
        id: visitId,
        elevatorId: elevator.id,
        kind,
        startedAt,
        endedAt,
        technicians,
        notes: notes.trim() || null,
        source: 'app',
        timestampSource: 'device',
        clientOffsetMs,
        checklist:
          answered && template
            ? {
                templateKey: template.key,
                templateVersion: template.version,
                items: answered.map((x) => ({ code: x.code, result: x.result, note: x.note })),
              }
            : null,
        attachments: photos.map((p) => ({ id: p.id, role: p.role })),
        gps,
      }

      const snapshotItems: ChecklistSnapshotItem[] = (answered ?? []).map((x) => ({
        code: x.code,
        group: x.item.group,
        label: { bg: x.item.bg, en: x.item.en },
        result: x.result,
        note: x.note,
      }))
      const localVisit: VisitRow = {
        id: visitId,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        kind,
        startedAt,
        endedAt,
        technicians: technicianNames,
        notes: notes.trim() || null,
        source: 'app',
        timestampSource: 'device',
        clientOffsetMs,
        receivedAt: endedAt,
        qualityFlags: [],
        checklist:
          answered && template
            ? {
                templateKey: template.key,
                templateVersion: template.version,
                items: snapshotItems,
                summary: summarizeChecklist(snapshotItems),
              }
            : null,
        attachments: photos.map((p) => ({
          attachmentId: p.id,
          role: p.role,
          uploaded: false,
          attachment: null,
        })),
        gps,
        createdByUserId: me.id,
        supersedesVisitId: null,
        supersededAt: null,
        photosPurgedAt: null,
        createdAt: endedAt,
        local: true,
      }

      const blobRows: BlobRow[] = photos.map((p) => ({
        id: p.id,
        blob: p.blob,
        sha256: p.sha256,
        takenAt: p.takenAt,
        visitId,
        role: p.role,
        bytes: p.blob.size,
      }))

      const defectRows: DefectRow[] = []
      const defectPayloads: DefectRecordPayload[] = []
      for (const x of answered ?? []) {
        if (x.result !== 'defect') continue
        const cat = x.answer.catalogCode
          ? catalog?.find((c) => c.code === x.answer.catalogCode)
          : undefined
        const description = x.note || cat?.label || pick({ bg: x.item.bg, en: x.item.en })
        const defectId = uuidv7()
        defectPayloads.push({
          id: defectId,
          elevatorId: elevator.id,
          catalogCode: x.answer.catalogCode || null,
          description,
          severity: 'medium',
          stopLift: x.answer.stopLift,
          recordedAt: endedAt,
          sourceType: 'visit',
          sourceId: visitId,
          notes: null,
          clientOffsetMs,
          timestampSource: 'device',
        })
        defectRows.push({
          id: defectId,
          elevatorId: elevator.id,
          elevatorInternalNo: elevator.internalNo,
          buildingId: elevator.buildingId,
          buildingAddressText: building?.addressText ?? '',
          catalogCode: x.answer.catalogCode || null,
          catalogRef: cat?.ref ?? null,
          description,
          severity: 'medium',
          stopLift: x.answer.stopLift,
          status: 'open',
          recordedAt: endedAt,
          sourceType: 'visit',
          sourceId: visitId,
          noticeSentAt: null,
          customerRequestedAt: null,
          followUpDueAt: endedAt,
          followUpInDays: tenant?.settings.defectFollowUpDays ?? 0,
          resolvedAt: null,
          resolvedVisitId: null,
          notes: null,
          createdByUserId: me.id,
          createdAt: endedAt,
          local: true,
        })
      }

      // Parent before child: the visit, then its photos, then the defects it found.
      const outboxRows = [
        buildOutboxRow({ kind: 'visit.record', payload, visitId, elevatorId: elevator.id }),
        ...photos.map((p) => {
          const up: AttachmentUploadPayload = {
            attachmentId: p.id,
            visitId,
            role: p.role,
            takenAt: p.takenAt,
            sha256: p.sha256,
          }
          return buildOutboxRow({
            kind: 'attachment.upload',
            payload: up,
            visitId,
            elevatorId: elevator.id,
          })
        }),
        ...defectPayloads.map((d) =>
          buildOutboxRow({ kind: 'defect.record', payload: d, visitId, elevatorId: elevator.id }),
        ),
      ]

      await db.transaction('rw', [db.visits, db.blobs, db.defects, db.outbox], async () => {
        await db.visits.add(localVisit)
        if (blobRows.length) await db.blobs.bulkAdd(blobRows)
        if (defectRows.length) await db.defects.bulkAdd(defectRows)
        await db.outbox.bulkAdd(outboxRows)
      })
      void requestDrain()
      toast.show(
        gps ? `${t('tech.visit.saved')} ${t('tech.visit.gpsCaptured')}` : t('tech.visit.saved'),
      )
      navigate(`/elevators/${elevator.id}`, { replace: true })
    } catch (err) {
      toast.show(err instanceof Error ? err.message : String(err), { tone: 'error' })
      setSaving(false)
    }
  }

  if (elevator === undefined || templates === undefined || catalog === undefined) {
    return (
      <>
        <PageHeader title={t('tech.visit.title')} back />
        <Spinner />
      </>
    )
  }
  if (elevator === null) {
    return (
      <>
        <PageHeader title={t('tech.visit.title')} back />
        <div className="page">
          <p className="empty muted">{t('error.notFound')}</p>
        </div>
      </>
    )
  }

  const logbookPhoto = photos.find((p) => p.role === 'logbook_page')
  const plainPhotos = photos.filter((p) => p.role === 'photo')

  return (
    <>
      <PageHeader
        title={`${t('tech.visit.title')} · ${elevator.internalNo}`}
        back
        subtitle={`${building?.addressText ?? ''} · ${t('tech.visit.startedAt')} ${time(startedAt)}`}
      />
      <div className="page">
        <div className="card">
          <Field label={t('tech.visit.kind')}>
            <select value={kind} onChange={(e) => setKind(e.target.value as VisitKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`enum.visitKind.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('tech.visit.secondTech')}>
            <select value={second} onChange={(e) => setSecond(e.target.value)}>
              <option value="">{t('tech.visit.secondTechNone')}</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value={OTHER}>{t('tech.visit.secondTechOther')}</option>
            </select>
          </Field>
          {second === OTHER ? (
            <Field label={t('tech.visit.secondTechName')}>
              <input
                type="text"
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                maxLength={120}
              />
            </Field>
          ) : null}
        </div>

        {checklistOn && template ? (
          <Section title={pick(template.name)}>
            <p className="muted small">{t('tech.visit.checklistHint')}</p>
            <button type="button" className="btn btn-outline btn-block" onClick={allOk}>
              {t('tech.visit.allOk')}
            </button>
            {groups.map((g) => (
              <div key={g.code} className="chk-group">
                <div className="chk-group-title">{g.label ? pick(g.label) : g.code}</div>
                {g.items.map((it) => {
                  const a = answers[it.code] ?? EMPTY_ANSWER
                  return (
                    <div key={it.code} className="chk-item">
                      <div className="chk-label">
                        <span className="chk-code">{it.code}</span>
                        {pick({ bg: it.bg, en: it.en })}
                      </div>
                      <div className="seg" role="group">
                        {RESULTS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={`btn${a.result === r ? ` on-${r}` : ''}`}
                            aria-pressed={a.result === r}
                            onClick={() => setAnswer(it.code, { result: r })}
                          >
                            {t(`enum.checklistResult.${r}`)}
                          </button>
                        ))}
                      </div>
                      {a.result === 'defect' ? (
                        <div className="chk-defect">
                          <Field label={t('tech.visit.defectCatalog')}>
                            <select
                              value={a.catalogCode}
                              onChange={(e) => {
                                const code = e.target.value
                                const cat = catalog.find((c) => c.code === code)
                                setAnswer(it.code, {
                                  catalogCode: code,
                                  stopLift: cat ? cat.stopLift : a.stopLift,
                                })
                              }}
                            >
                              <option value="">{t('tech.visit.defectCatalogNone')}</option>
                              {catalog.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {`${c.ref ?? c.code} · ${c.label}`}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={t('tech.visit.defectNote')}>
                            <textarea
                              value={a.note}
                              onChange={(e) => setAnswer(it.code, { note: e.target.value })}
                              maxLength={500}
                              rows={2}
                            />
                          </Field>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={a.stopLift}
                              onChange={(e) => setAnswer(it.code, { stopLift: e.target.checked })}
                            />
                            {t('tech.visit.defectStopLift')}
                          </label>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
            {unanswered > 0 ? (
              <p className="muted small">{t('tech.visit.unanswered', { count: unanswered })}</p>
            ) : null}
            {defectCount > 0 ? (
              <p className="danger small">
                {t('tech.visit.defectsWillBeRecorded', { count: defectCount })}
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section title={t('tech.visit.photos')}>
          <div className="card">
            {plainPhotos.length ? (
              <div className="photos">
                {plainPhotos.map((p) => (
                  <div key={p.id} className="photo">
                    <img src={p.url} alt="" />
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removePhoto(p.id)}
                    >
                      {t('tech.visit.removePhoto')}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={photoBusy || photos.length >= 20}
              onClick={() => void addPhoto('photo')}
            >
              {photoBusy ? <Spinner inline /> : null}
              {t('tech.visit.addPhoto')}
            </button>
            {logbookPhoto ? (
              <div className="inline">
                <div className="photo" style={{ width: 96 }}>
                  <img src={logbookPhoto.url} alt="" />
                  <span className="photo-tag">{t('tech.visit.logbookPhotoDone')}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => removePhoto(logbookPhoto.id)}
                >
                  {t('tech.visit.removePhoto')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-block"
                disabled={photoBusy || photos.length >= 20}
                onClick={() => void addPhoto('logbook_page')}
              >
                {t('tech.visit.logbookPhoto')}
              </button>
            )}
          </div>
        </Section>

        <Field label={t('tech.visit.notes')}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </Field>

        <button
          type="button"
          className="btn btn-primary btn-big"
          disabled={saving || !me}
          onClick={() => void save()}
        >
          {saving ? <Spinner inline /> : null}
          {t('tech.visit.save')}
        </button>
      </div>
    </>
  )
}
