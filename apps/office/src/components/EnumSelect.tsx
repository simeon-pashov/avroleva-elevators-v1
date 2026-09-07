import { useI18n } from '../i18n/I18nProvider'

export function EnumSelect<T extends string>({
  value,
  options,
  prefix,
  onChange,
  allowEmpty,
  emptyLabel,
  disabled,
}: {
  value: T | ''
  options: readonly T[]
  /** i18n key prefix, e.g. `enum.elevatorStatus` -> `enum.elevatorStatus.active` */
  prefix: string
  onChange: (v: T | '') => void
  allowEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T | '')}>
      {allowEmpty ? <option value="">{emptyLabel ?? t('common.all')}</option> : null}
      {options.map((o) => (
        <option key={o} value={o}>
          {t(`${prefix}.${o}`)}
        </option>
      ))}
    </select>
  )
}

export function EnumLabel({ prefix, value }: { prefix: string; value: string }) {
  const { t } = useI18n()
  return <>{t(`${prefix}.${value}`)}</>
}
