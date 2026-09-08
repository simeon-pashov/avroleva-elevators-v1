import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { DefectDto, Page } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorBox, LoadMore, PageHeader, Spinner, useCursorList } from '../../components/ui'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { DefectList } from '../../components/defects/DefectList'
import { RecordDefectForm } from '../../components/defects/RecordDefectForm'

type Tab = 'open' | 'awaiting' | 'followUp' | 'resolved'
const TABS: Tab[] = ['open', 'awaiting', 'followUp', 'resolved']

function queryFor(tab: Tab, cursor: string | null) {
  switch (tab) {
    case 'awaiting':
      return { status: 'awaiting_approval', cursor, limit: 50 }
    case 'followUp':
      return { followUpDue: 'true', cursor, limit: 50 }
    case 'resolved':
      return { status: 'resolved', cursor, limit: 50 }
    default:
      return { open: 'true', cursor, limit: 100 }
  }
}

/** "Дефекти": open / awaiting approval / follow-up due / resolved, plus the record form. */
export function DefectsPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'open'
  const [recording, setRecording] = useState(params.get('new') === '1')
  const [version, setVersion] = useState(0)
  const list = useCursorList<DefectDto>(
    (cursor) => get<Page<DefectDto>>(`/defects${qs(queryFor(tab, cursor))}`),
    [tab, version],
  )
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'open') p.delete('tab')
    else p.set('tab', next)
    setParams(p)
  }
  const labels: Record<Tab, string> = {
    open: t('defects.tabOpen'),
    awaiting: t('defects.tabAwaiting'),
    followUp: t('defects.tabFollowUp'),
    resolved: t('defects.tabResolved'),
  }

  return (
    <div>
      <PageHeader
        title={t('defects.title')}
        actions={
          <>
            <ExportCsvButton dataset="defects" />
            {hasRole('owner', 'office', 'technician') ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setRecording((v) => !v)}
              >
                {t('defects.new')}
              </button>
            ) : null}
          </>
        }
      />
      {recording ? (
        <div className="card narrow">
          <h2>{t('defects.new')}</h2>
          <RecordDefectForm
            onDone={() => {
              setRecording(false)
              setTab('open')
              setVersion((v) => v + 1)
            }}
            onCancel={() => setRecording(false)}
          />
        </div>
      ) : null}
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            className={`tab${tab === x ? ' active' : ''}`}
            onClick={() => setTab(x)}
          >
            {labels[x]}
          </button>
        ))}
      </div>
      <div className="card">
        <ErrorBox error={list.error} />
        {list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : (
          <DefectList items={list.items} onChanged={() => setVersion((v) => v + 1)} />
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </div>
    </div>
  )
}
