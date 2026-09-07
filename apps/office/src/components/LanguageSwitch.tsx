import { useI18n } from '../i18n/I18nProvider'

/** Language switch: persisted on the user when logged in (via onChange), otherwise locally. */
export function LanguageSwitch({
  onChange,
}: {
  onChange?: (locale: string) => Promise<void> | void
}) {
  const { locale, locales, setLocale, t } = useI18n()
  return (
    <select
      className="lang"
      aria-label={t('common.language')}
      value={locale}
      onChange={(e) => {
        const next = e.target.value
        if (onChange) void onChange(next)
        else setLocale(next)
      }}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {t(`lang.${l}`)}
        </option>
      ))}
    </select>
  )
}
