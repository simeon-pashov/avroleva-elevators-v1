import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { CallbackDto, Page } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { addDays, todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  ErrorBox,
  Field,
  LoadMore,
  PageHeader,
  Spinner,
  useCursorList,
} from '../../components/ui'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { CallbackList } from '../../components/callbacks/CallbackList'
import { CallbackIntakeForm } from '../../components/callbacks/CallbackIntakeForm'

type Tab = 'open' | 'history'

/**
 * "Аварии": the open list with live timers (auto-refreshed every minute), the intake form and
 * the history with a date range. Technicians see only what is assigned to them.
 */
export function CallbacksPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'history' ? 'history' : 'open'
  const [intake, setIntake] = useState(params.get('new') === '1')
  const [from, setFrom] = useState(addDays(todaySofia(), -30))
  const [to, setTo] = useState(todaySofia())
  const [version, setVersion] = useState(0)

  const list = useCursorList<CallbackDto>(
    (cursor) =>
      get<Page<CallbackDto>>(
        `/callbacks${qs(
          tab === 'open'
            ? { open: 'true', cursor, limit: 100 }
            : { status: 'closed', from, to, cursor, limit: 50 },
        )}`,
      ),
    [tab, from, to, version],
  )

  // Open timers matter: refetch every minute so dispatches from the phone show up.
  useEffect(() => {
    if (tab !== 'open') return
    const h = setInterval(() => setVersion((v) => v + 1), 60_000)
    return () => clearInterval(h)
  }, [tab])

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'open') p.delete('tab')
    else p.set('tab', next)
    setParams(p)
  }
  const changed = () => setVersion((v) => v + 1)
  const counts = tab === 'open' ? summarize(list.items) : null

  return (
    <div>
      <PageHeader
        title={t('callbacks.title')}
        subtitle={
          counts ? (
            <span className="due-counts">
              <Badge kind="danger">
                {t('callbacks.badgeBreached', { count: counts.breached })}
              </Badge>
              <Badge kind="warn">{t('callbacks.badgeAtRisk', { count: counts.atRisk })}</Badge>
              {counts.trapped > 0 ? (
                <Badge kind="danger">
                  {t('callbacks.badgeTrapped', { count: counts.trapped })}
                </Badge>
              ) : null}
            </span>
          ) : null
        }
        actions={
          <>
            <ExportCsvButton dataset="callbacks" />
            <button type="button" className="btn btn-primary" onClick={() => setIntake((v) => !v)}>
              {t('callbacks.new')}
            </button>
          </>
        }
      />
      {intake ? (
        <div className="card narrow">
          <h2>{t('callbacks.intake')}</h2>
          <CallbackIntakeForm
            onDone={() => {
              setIntake(false)
              setTab('open')
              changed()
            }}
            onCancel={() => setIntake(false)}
          />
        </div>
      ) : null}
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'open'}
          className={`tab${tab === 'open' ? ' active' : ''}`}
          onClick={() => setTab('open')}
        >
          {t('callbacks.open')}
          {tab === 'open' ? <span className="tab-count">{list.items.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          {t('callbacks.history')}
        </button>
      </div>
      {tab === 'history' ? (
        <div className="toolbar">
          <Field label={t('callbacks.from')}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('callbacks.to')}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      ) : null}
      <div className="card">
        <ErrorBox error={list.error} />
        {list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : (
          <CallbackList
            items={list.items}
            onChanged={changed}
            emptyText={tab === 'open' ? t('callbacks.empty') : t('callbacks.emptyHistory')}
          />
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </div>
    </div>
  )
}

function summarize(items: CallbackDto[]) {
  const out = { breached: 0, atRisk: 0, trapped: 0 }
  for (const c of items) {
    if (c.slaState === 'breached') out.breached++
    if (c.slaState === 'at_risk') out.atRisk++
    if (c.classification === 'trapped_persons' && !c.releasedAt) out.trapped++
  }
  return out
}
