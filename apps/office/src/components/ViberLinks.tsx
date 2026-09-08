import type { ViberLinkDto } from '@avroleva/contracts'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from './ui'

/**
 * The three Viber deep links the office user taps for a manually sent message: forward (text
 * prefilled, phone), chat with the number, viber.click (desktop), plus a copy button.
 */
export function ViberLinks({ viber }: { viber: ViberLinkDto }) {
  const { t } = useI18n()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(viber.text)
      toast(t('notifications.copied'))
    } catch {
      toast(t('notifications.copyFailed'), 'error')
    }
  }
  return (
    <div className="viber-box">
      <pre className="viber-text">{viber.text}</pre>
      <div className="actions">
        <a className="btn btn-small btn-primary" href={viber.forwardUrl}>
          {t('notifications.viberOpen')}
        </a>
        <a className="btn btn-small" href={viber.chatUrl}>
          {t('notifications.viberChat', { number: viber.number })}
        </a>
        <button type="button" className="btn btn-small" onClick={copy}>
          {t('notifications.copyText')}
        </button>
        <a className="btn btn-small" href={viber.webUrl} target="_blank" rel="noopener">
          {t('notifications.viberWeb')}
        </a>
      </div>
      <p className="muted small viber-howto">{t('notifications.viberHowTo')}</p>
    </div>
  )
}
