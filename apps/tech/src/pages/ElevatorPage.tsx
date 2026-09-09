import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Empty, PageHeader, Section, Spinner, StatusPill, TelLink } from '../components/ui'
import type { VisitRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { todayInSofia } from '../lib/dates'
import { orderedStops } from '../lib/plans'
import { platform } from '../platform'
import { buildingTitle, houseManager } from './TodayPage'

function VisitRowView({ visit }: { visit: VisitRow }) {
  const { t, dateTime } = useI18n()
  const summary = visit.checklist?.summary
  const photos = visit.attachments.length
  const thumbs = visit.attachments.filter((a) => a.attachment?.thumbUrl)
  return (
    <div className="row">
      <div className="row-main">
        <span className="row-title">
          {dateTime(visit.startedAt)}
          {' · '}
          {t(`enum.visitKind.${visit.kind}`)}
        </span>
        <span className="row-sub">
          {visit.technicians.map((x) => x.name).join(', ')}
          {summary
            ? ` · ${t('enum.checklistResult.ok')} ${summary.ok} / ${t('enum.checklistResult.defect')} ${summary.defect} / ${t('enum.checklistResult.na')} ${summary.na}`
            : ''}
          {photos ? ` · ${t('logbook.photos', { count: photos })}` : ''}
        </span>
        {visit.notes ? <span className="row-sub">{visit.notes}</span> : null}
        {thumbs.length ? (
          <div className="thumbs">
            {thumbs.map((a) => (
              <img
                key={a.attachmentId}
                src={platform.http.resolveUrl(a.attachment!.thumbUrl)}
                alt=""
                loading="lazy"
              />
            ))}
          </div>
        ) : null}
        {visit.local ? (
          <span>
            <StatusPill tone="warn" text={t('tech.elevator.pendingLocal')} />
          </span>
        ) : (
          <a
            className="small"
            href={platform.http.resolveUrl(`/print/logbook/${visit.id}`)}
            target="_blank"
            rel="noreferrer"
          >
            {t('logbook.title')}
          </a>
        )}
      </div>
    </div>
  )
}

export function ElevatorPage() {
  const { id = '' } = useParams()
  const { t, date } = useI18n()
  // undefined = loading, null = not on this phone
  const elevator = useLiveQuery(() => db.elevators.get(id).then((e) => e ?? null), [id])
  const building = useLiveQuery(
    () => (elevator ? db.buildings.get(elevator.buildingId) : undefined),
    [elevator?.buildingId],
  )
  const contacts = useLiveQuery(
    () => (elevator ? db.contacts.where('buildingId').equals(elevator.buildingId).toArray() : []),
    [elevator?.buildingId],
  )
  const defects = useLiveQuery(() => db.defects.where('elevatorId').equals(id).toArray(), [id])
  const visits = useLiveQuery(
    () => db.visits.where('elevatorId').equals(id).reverse().sortBy('startedAt'),
    [id],
  )
  // Step 9: is this lift a stop of today's plan, and which one?
  const today = todayInSofia()
  const planStop = useLiveQuery(async () => {
    const plans = await db.dayPlans.where('date').equals(today).toArray()
    for (const p of plans) {
      const stops = orderedStops(p)
      const i = stops.findIndex((s) => s.elevatorId === id)
      const s = stops[i]
      if (s) return { n: i + 1, status: s.status }
    }
    return null
  }, [id, today])

  if (elevator === undefined) {
    return (
      <>
        <PageHeader title={t('tech.elevator.title')} back />
        <Spinner />
      </>
    )
  }
  if (elevator === null) {
    return (
      <>
        <PageHeader title={t('tech.elevator.title')} back />
        <div className="page">
          <Empty text={t('error.notFound')} />
        </div>
      </>
    )
  }
  const contact = houseManager(contacts ?? [])
  const stopped = elevator.status !== 'active'

  return (
    <>
      <PageHeader
        title={`${t('tech.elevator.title')} ${elevator.internalNo}`}
        back
        subtitle={building ? buildingTitle(building, t('address.entranceShort')) : null}
      />
      <div className="page">
        <Link className="btn btn-primary btn-big" to={`/elevators/${elevator.id}/visit`}>
          {t('tech.elevator.recordVisit')}
        </Link>
        {planStop ? (
          <div className="inline">
            <StatusPill
              tone={planStop.status === 'done' ? 'ok' : 'warn'}
              text={t('tech.plan.inPlan', { n: planStop.n })}
            />
          </div>
        ) : null}

        <div className="card">
          <dl className="kv">
            <dt>{t('elevators.address')}</dt>
            <dd>{building ? buildingTitle(building, t('address.entranceShort')) : '—'}</dd>
            {building?.customerName ? (
              <>
                <dt>{t('buildings.customer')}</dt>
                <dd>{building.customerName}</dd>
              </>
            ) : null}
            <dt>{t('elevators.internalNo')}</dt>
            <dd>{elevator.internalNo}</dd>
            <dt>{t('elevators.regNo')}</dt>
            <dd>{elevator.regNo ?? '—'}</dd>
            <dt>{t('elevators.driveType')}</dt>
            <dd>{t(`enum.driveType.${elevator.driveType}`)}</dd>
            <dt>{t('elevators.doorType')}</dt>
            <dd>{t(`enum.doorType.${elevator.doorType}`)}</dd>
            <dt>{t('elevators.stops')}</dt>
            <dd>{elevator.stops}</dd>
            <dt>{t('elevators.status')}</dt>
            <dd>
              <StatusPill
                tone={stopped ? 'danger' : 'ok'}
                text={t(`enum.elevatorStatus.${elevator.status}`)}
              />
              {stopped && elevator.stopReason ? (
                <div className="small muted">
                  {t('tech.elevator.stopped', { reason: elevator.stopReason })}
                </div>
              ) : null}
            </dd>
            <dt>{t('tech.elevator.lastVisit')}</dt>
            <dd>
              {elevator.lastCheckAt ? date(elevator.lastCheckAt) : t('elevators.neverChecked')}
            </dd>
            <dt>{t('tech.elevator.nextCheck')}</dt>
            <dd>{elevator.nextCheckDueAt ? date(elevator.nextCheckDueAt) : '—'}</dd>
          </dl>
        </div>

        {contact ? (
          <div className="card">
            <div className="card-title">{t('tech.elevator.contact')}</div>
            <div>{contact.name}</div>
            <TelLink phone={contact.phone} />
          </div>
        ) : null}

        {building?.accessNotes || elevator.notes ? (
          <div className="card">
            <div className="card-title">{t('tech.elevator.accessNotes')}</div>
            {building?.accessNotes ? <p>{building.accessNotes}</p> : null}
            {elevator.notes ? <p className="muted">{elevator.notes}</p> : null}
          </div>
        ) : null}

        <Section title={t('tech.elevator.openDefects')}>
          {!defects?.length ? (
            <Empty text={t('tech.elevator.noDefects')} />
          ) : (
            <div className="list">
              {defects.map((d) => (
                <div key={d.id} className="row">
                  <div className="row-main">
                    <span className="row-title">
                      {d.catalogRef ? `${d.catalogRef} · ` : ''}
                      {d.description}
                    </span>
                    <span className="row-sub">
                      {date(d.recordedAt)}
                      {' · '}
                      {t(`enum.defectSeverity.${d.severity}`)}
                      {' · '}
                      {d.local
                        ? t('tech.elevator.pendingLocal')
                        : t(`enum.defectStatus.${d.status}`)}
                    </span>
                  </div>
                  {d.stopLift ? <StatusPill tone="danger" text={t('defects.stopped')} /> : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('tech.elevator.history')}>
          {!visits?.length ? (
            <Empty text={t('tech.elevator.noHistory')} />
          ) : (
            <div className="list">
              {visits.map((v) => (
                <VisitRowView key={v.id} visit={v} />
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  )
}
