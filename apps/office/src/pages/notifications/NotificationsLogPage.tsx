import { useState } from 'react'
import { Link } from 'react-router'
import type {
  NotificationChannel,
  NotificationDto,
  NotificationStatus,
  Page,
} from '@avroleva/contracts'
import {
  NotificationChannel as NotificationChannelEnum,
  NotificationStatus as NotificationStatusEnum,
} from '@avroleva/contracts'
import { get, post, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  Empty,
  ErrorBox,
  LoadMore,
  PageHeader,
  Spinner,
  toast,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { ViberLinks } from '../../components/ViberLinks'

export function notificationStatusBadge(
  s: NotificationStatus,
): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (s) {
    case 'sent':
      return 'ok'
    case 'failed':
      return 'danger'
    case 'skipped':
      return 'warn'
    default:
      return 'info'
  }
}

export function channelBadge(c: NotificationChannel): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (c) {
    case 'email':
      return 'info'
    case 'viber_link':
      return 'ok'
    case 'sms':
      return 'warn'
    default:
      return 'muted'
  }
}

const excerpt = (body: string, max = 160) => {
  const line = body.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Office link of a related record (BASE_PATH-relative deep link, else by related type). */
function relatedLink(n: NotificationDto): string | null {
  if (n.link) return n.link
  if (!n.relatedType || !n.relatedId) return null
  switch (n.relatedType) {
    case 'elevator':
      return `/elevators/${n.relatedId}`
    case 'building':
      return `/buildings/${n.relatedId}`
    case 'contract':
      return `/contracts/${n.relatedId}`
    case 'customer':
      return `/customers/${n.relatedId}`
    case 'callback':
      return '/callbacks'
    case 'defect':
      return '/defects'
    default:
      return null
  }
}

/** "Уведомления": the delivery log with channel/status filters and the manual Viber send block. */
export function NotificationsLogPage() {
  const { t, dateTime } = useI18n()
  const [channel, setChannel] = useState<NotificationChannel | ''>('')
  const [status, setStatus] = useState<NotificationStatus | ''>('')
  const [openViber, setOpenViber] = useState<string | null>(null)

  const list = useCursorList<NotificationDto>(
    (cursor) =>
      get<Page<NotificationDto>>(`/notifications${qs({ channel, status, cursor, limit: 50 })}`),
    [channel, status],
  )

  const markSent = async (n: NotificationDto) => {
    try {
      const updated = await post<NotificationDto>(`/notifications/${n.id}/mark-sent`)
      list.setItems((items) => items.map((x) => (x.id === n.id ? updated : x)))
      setOpenViber(null)
      toast(t('notifications.markedSent'))
    } catch (e) {
      toast(e instanceof Error ? e.message : t('error.internal'), 'error')
    }
  }

  return (
    <div>
      <PageHeader title={t('notifications.logTitle')} subtitle={t('notifications.logSubtitle')} />
      <div className="toolbar">
        <EnumSelect
          value={channel}
          options={NotificationChannelEnum.options}
          prefix="enum.notificationChannel"
          onChange={setChannel}
          allowEmpty
          emptyLabel={t('notifications.allChannels')}
        />
        <EnumSelect
          value={status}
          options={NotificationStatusEnum.options}
          prefix="enum.notificationStatus"
          onChange={setStatus}
          allowEmpty
          emptyLabel={t('notifications.allStatuses')}
        />
      </div>
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table notif-table">
            <thead>
              <tr>
                <th>{t('notifications.time')}</th>
                <th>{t('notifications.channel')}</th>
                <th>{t('notifications.recipient')}</th>
                <th>{t('notifications.message')}</th>
                <th>{t('notifications.status')}</th>
                <th>{t('notifications.related')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((n) => {
                const link = relatedLink(n)
                const viberPending = n.channel === 'viber_link' && n.status === 'queued' && n.viber
                return (
                  <tr key={n.id} className={n.status === 'failed' ? 'row-error' : ''}>
                    <td className="nowrap">
                      {dateTime(n.createdAt)}
                      {n.sentAt && Date.parse(n.sentAt) - Date.parse(n.createdAt) >= 60_000 ? (
                        <div className="muted small">{dateTime(n.sentAt)}</div>
                      ) : null}
                    </td>
                    <td>
                      <Badge kind={channelBadge(n.channel)}>
                        {t(`enum.notificationChannel.${n.channel}`)}
                      </Badge>
                      {n.eventType ? (
                        <div className="muted small">{t(`notifications.event.${n.eventType}`)}</div>
                      ) : null}
                    </td>
                    <td>{n.to}</td>
                    <td className="notif-message">
                      {n.subject ? <div className="notif-subject">{n.subject}</div> : null}
                      <div className={n.subject ? 'muted small' : ''}>{excerpt(n.body)}</div>
                      {viberPending ? (
                        <div className="notif-viber">
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            onClick={() => setOpenViber(openViber === n.id ? null : n.id)}
                          >
                            {t('notifications.sendViber')}
                          </button>
                          {openViber === n.id ? (
                            <>
                              <ViberLinks viber={n.viber!} />
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => markSent(n)}
                              >
                                {t('notifications.markSent')}
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge kind={notificationStatusBadge(n.status)}>
                        {t(`enum.notificationStatus.${n.status}`)}
                      </Badge>
                      {n.error ? <div className="small text-danger">{n.error}</div> : null}
                    </td>
                    <td>
                      {link ? (
                        <Link to={link}>
                          {n.relatedType ? n.relatedType : t('notifications.openRelated')}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}
