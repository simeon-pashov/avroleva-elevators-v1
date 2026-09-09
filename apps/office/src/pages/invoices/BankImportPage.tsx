import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import type {
  BankCsvMapping,
  BankCsvPresetDto,
  BankImportCommitResultDto,
  BankImportDto,
  BankImportRowDto,
  BuildingDto,
  InvoiceDto,
  Page,
} from '@avroleva/contracts'
import { get, post, put, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  ConfirmButton,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
  toast,
} from '../../components/ui'

type RowStatus = BankImportRowDto['status']

function rowStatusBadge(s: RowStatus): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (s) {
    case 'booked':
      return 'ok'
    case 'matched':
      return 'info'
    case 'proposed':
      return 'warn'
    case 'unallocated':
      return 'danger'
    default:
      return 'muted'
  }
}

function matchKindBadge(k: BankImportRowDto['matchKind']): 'ok' | 'info' | 'muted' {
  switch (k) {
    case 'reference':
      return 'ok'
    case 'amount_name':
    case 'manual':
      return 'info'
    default:
      return 'muted'
  }
}

interface MappingForm {
  delimiter: '' | ',' | ';' | '\t'
  hasHeader: boolean
  dateColumn: string
  amountColumn: string
  creditColumn: string
  debitColumn: string
  counterpartyColumn: string
  descriptionColumn: string
  referenceColumn: string
  dateFormat: BankCsvMapping['dateFormat']
  decimalSeparator: BankCsvMapping['decimalSeparator']
  skipRows: string
}

const emptyMapping: MappingForm = {
  delimiter: '',
  hasHeader: true,
  dateColumn: '0',
  amountColumn: '',
  creditColumn: '',
  debitColumn: '',
  counterpartyColumn: '',
  descriptionColumn: '1',
  referenceColumn: '',
  dateFormat: 'DD.MM.YYYY',
  decimalSeparator: ',',
  skipRows: '0',
}

const col = (s: string): number | null => (s.trim() === '' ? null : Number(s))

function toMapping(m: MappingForm): BankCsvMapping {
  return {
    ...(m.delimiter ? { delimiter: m.delimiter } : {}),
    hasHeader: m.hasHeader,
    dateColumn: Number(m.dateColumn || 0),
    amountColumn: col(m.amountColumn),
    creditColumn: col(m.creditColumn),
    debitColumn: col(m.debitColumn),
    counterpartyColumn: col(m.counterpartyColumn),
    descriptionColumn: Number(m.descriptionColumn || 0),
    referenceColumn: col(m.referenceColumn),
    dateFormat: m.dateFormat,
    decimalSeparator: m.decimalSeparator,
    skipRows: Number(m.skipRows || 0),
  }
}

/** Small search box over the open invoices: "№ · building · open". */
function InvoicePicker({
  onPick,
  onCancel,
}: {
  onPick: (id: string) => void
  onCancel: () => void
}) {
  const { t, money } = useI18n()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<InvoiceDto[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const h = setTimeout(() => {
      get<Page<InvoiceDto>>(`/billing/invoices${qs({ pending: true, q, limit: 10 })}`)
        .then((p) => !cancelled && setItems(p.items))
        .catch(() => !cancelled && setItems([]))
        .finally(() => !cancelled && setLoading(false))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [q])

  return (
    <div className="picker">
      <div className="inline-form-row">
        <input
          autoFocus
          value={q}
          placeholder={t('bankImport.invoiceSearch')}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn btn-small" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      {loading && items.length === 0 ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="muted small">{t('payments.emptyPending')}</p>
      ) : (
        <ul className="search-results static">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i.id)}>
                {t('payments.invoiceNo')} {i.number} · {i.buildingAddressText} ·{' '}
                {money(i.openCents)}
                <span className="muted small"> {i.paymentReference}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BuildingPicker({
  buildings,
  onPick,
  onCancel,
}: {
  buildings: BuildingDto[]
  onPick: (id: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [id, setId] = useState('')
  return (
    <div className="picker inline-form-row">
      <select value={id} onChange={(e) => setId(e.target.value)} autoFocus>
        <option value="">{t('common.choose')}</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.addressText}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-small btn-primary"
        disabled={!id}
        onClick={() => onPick(id)}
      >
        {t('bankImport.assign')}
      </button>
      <button type="button" className="btn btn-small" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

function RowActions({
  row,
  importId,
  buildings,
  onUpdated,
}: {
  row: BankImportRowDto
  importId: string
  buildings: BuildingDto[]
  onUpdated: (dto: BankImportDto) => void
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'none' | 'invoice' | 'building'>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const save = async (body: { invoiceId?: string; buildingId?: string; ignore?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      onUpdated(await put<BankImportDto>(`/billing/bank-imports/${importId}/rows/${row.id}`, body))
      setMode('none')
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  if (row.status === 'booked') return null
  return (
    <div className="row-actions">
      <ErrorBox error={error} />
      {mode === 'invoice' ? (
        <InvoicePicker
          onPick={(invoiceId) => void save({ invoiceId })}
          onCancel={() => setMode('none')}
        />
      ) : mode === 'building' ? (
        <BuildingPicker
          buildings={buildings}
          onPick={(buildingId) => void save({ buildingId })}
          onCancel={() => setMode('none')}
        />
      ) : (
        <div className="actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setMode('invoice')}
          >
            {t('bankImport.pickInvoice')}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setMode('building')}
          >
            {t('bankImport.pickBuilding')}
          </button>
          {row.status !== 'ignored' ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => void save({ ignore: true })}
            >
              {t('bankImport.ignore')}
            </button>
          ) : null}
          {row.invoiceId || row.buildingId || row.status === 'ignored' ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => void save({})}
            >
              {t('bankImport.clear')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** /billing/bank-import: paste or upload a CSV statement, review the matches, book the payments. */
export function BankImportPage() {
  const { t, date, dateTime, money } = useI18n()
  const [presets, setPresets] = useState<BankCsvPresetDto[]>([])
  const [imports, setImports] = useState<BankImportDto[] | null>(null)
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [preset, setPreset] = useState('')
  const [encoding, setEncoding] = useState<'utf-8' | 'windows-1251'>('utf-8')
  const [filename, setFilename] = useState('')
  const [text, setText] = useState('')
  const [useMapping, setUseMapping] = useState(false)
  const [mapping, setMapping] = useState<MappingForm>(emptyMapping)
  const [current, setCurrent] = useState<BankImportDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const dash = <span className="muted">—</span>

  const loadImports = useCallback(async () => {
    try {
      setImports((await get<{ items: BankImportDto[] }>('/billing/bank-imports')).items)
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => {
    void loadImports()
    get<{ items: BankCsvPresetDto[] }>('/billing/bank-imports/presets')
      .then((r) => setPresets(r.items))
      .catch(() => {
        /* "auto" still works */
      })
    get<Page<BuildingDto>>('/buildings?limit=200')
      .then((r) => setBuildings(r.items))
      .catch(() => {
        /* the building picker is optional */
      })
  }, [loadImports])

  const readFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '')
      setFilename(file.name)
    }
    reader.readAsText(file, encoding)
  }

  const preview = async () => {
    setBusy(true)
    setError(null)
    try {
      const dto = await post<BankImportDto>('/billing/bank-imports/preview', {
        filename: filename || `statement-${new Date().toISOString().slice(0, 10)}.csv`,
        text,
        ...(preset ? { preset } : {}),
        ...(useMapping ? { mapping: toMapping(mapping) } : {}),
      })
      setCurrent(dto)
      await loadImports()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const open = async (id: string) => {
    setError(null)
    try {
      setCurrent(await get<BankImportDto>(`/billing/bank-imports/${id}`))
      window.scrollTo({ top: 0 })
    } catch (e) {
      setError(e)
    }
  }

  const commit = async () => {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const r = await post<BankImportCommitResultDto>(`/billing/bank-imports/${current.id}/commit`)
      toast(
        t('bankImport.committed', {
          booked: r.booked,
          unallocated: r.unallocated,
          ignored: r.ignored,
        }),
      )
      await open(current.id)
      await loadImports()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const bookable = current
    ? current.rows.filter((r) => r.status === 'proposed' || r.status === 'matched').length
    : 0
  const setM = <K extends keyof MappingForm>(k: K, v: MappingForm[K]) =>
    setMapping((m) => ({ ...m, [k]: v }))
  const colInput = (k: keyof MappingForm, label: string) => (
    <Field label={label} key={k}>
      <input
        type="number"
        min={0}
        max={100}
        value={mapping[k] as string}
        onChange={(e) => setM(k, e.target.value as MappingForm[typeof k])}
      />
    </Field>
  )

  return (
    <div>
      <PageHeader
        back={
          <Link to="/invoices" className="back">
            {t('invoices.title')}
          </Link>
        }
        title={t('bankImport.title')}
        subtitle={t('bankImport.subtitle')}
      />
      <div className="card">
        <h2>{t('bankImport.fileTitle')}</h2>
        <div className="row import-row">
          <Field label={t('bankImport.file')}>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
          </Field>
          <Field label={t('bankImport.encoding')}>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as 'utf-8' | 'windows-1251')}
            >
              <option value="utf-8">{t('bankImport.encodingUtf8')}</option>
              <option value="windows-1251">{t('bankImport.encodingCp1251')}</option>
            </select>
          </Field>
          <Field label={t('bankImport.preset')}>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">{t('bankImport.presetAuto')}</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('bankImport.paste')} hint={t('bankImport.pasteHint')}>
          <textarea
            rows={6}
            className="csv-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <details className="mapping-details" open={useMapping}>
          <summary onClick={(e) => (e.preventDefault(), setUseMapping((v) => !v))}>
            {t('bankImport.mappingTitle')}
          </summary>
          <p className="muted small">{t('bankImport.mappingHint')}</p>
          <div className="mapping-grid">
            <Field label={t('bankImport.delimiter')}>
              <select
                value={mapping.delimiter}
                onChange={(e) => setM('delimiter', e.target.value as MappingForm['delimiter'])}
              >
                <option value="">{t('bankImport.presetAuto')}</option>
                <option value=";">;</option>
                <option value=",">,</option>
                <option value={'\t'}>{t('bankImport.tab')}</option>
              </select>
            </Field>
            <Field label={t('bankImport.dateFormat')}>
              <select
                value={mapping.dateFormat}
                onChange={(e) => setM('dateFormat', e.target.value as MappingForm['dateFormat'])}
              >
                {(['DD.MM.YYYY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'] as const).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('bankImport.decimalSeparator')}>
              <select
                value={mapping.decimalSeparator}
                onChange={(e) =>
                  setM('decimalSeparator', e.target.value as MappingForm['decimalSeparator'])
                }
              >
                <option value=",">,</option>
                <option value=".">.</option>
              </select>
            </Field>
            <Field label={t('bankImport.skipRows')}>
              <input
                type="number"
                min={0}
                max={50}
                value={mapping.skipRows}
                onChange={(e) => setM('skipRows', e.target.value)}
              />
            </Field>
            {colInput('dateColumn', t('bankImport.dateColumn'))}
            {colInput('amountColumn', t('bankImport.amountColumn'))}
            {colInput('creditColumn', t('bankImport.creditColumn'))}
            {colInput('debitColumn', t('bankImport.debitColumn'))}
            {colInput('counterpartyColumn', t('bankImport.counterpartyColumn'))}
            {colInput('descriptionColumn', t('bankImport.descriptionColumn'))}
            {colInput('referenceColumn', t('bankImport.referenceColumn'))}
            <label className="check">
              <input
                type="checkbox"
                checked={mapping.hasHeader}
                onChange={(e) => setM('hasHeader', e.target.checked)}
              />
              <span>{t('bankImport.hasHeader')}</span>
            </label>
          </div>
        </details>
        <ErrorBox error={error} />
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || text.trim() === ''}
            onClick={() => void preview()}
          >
            {t('bankImport.preview')}
          </button>
        </div>
      </div>

      {current ? (
        <div className="card">
          <div className="card-head">
            <h2>
              {current.filename}{' '}
              <Badge kind={current.status === 'committed' ? 'ok' : 'warn'}>
                {t(`bankImport.status.${current.status}`)}
              </Badge>
            </h2>
            <span className="muted small">
              {t('bankImport.counts', {
                rows: current.rowCount,
                matched: current.matchedCount,
                booked: current.bookedCount,
              })}
            </span>
          </div>
          {current.parseErrors.length > 0 ? (
            <div className="alert alert-error">
              <strong>{t('bankImport.parseErrors', { count: current.parseErrors.length })}</strong>
              <ul className="small parse-errors">
                {current.parseErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {current.rows.length === 0 ? (
            <p className="muted">{t('bankImport.noRows')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table compact import-table">
                <thead>
                  <tr>
                    <th>{t('payments.paidAt')}</th>
                    <th className="num">{t('payments.amount')}</th>
                    <th>{t('invoices.counterparty')}</th>
                    <th>{t('billing.doc.description')}</th>
                    <th>{t('invoices.reference')}</th>
                    <th>{t('bankImport.matchKind')}</th>
                    <th>{t('payments.status')}</th>
                    <th>{t('bankImport.matchedTo')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((r) => (
                    <tr
                      key={r.id}
                      className={
                        r.status === 'unallocated'
                          ? 'row-warning'
                          : r.status === 'ignored'
                            ? 'muted'
                            : ''
                      }
                    >
                      <td className="nowrap">{date(r.bookedAt)}</td>
                      <td className="num nowrap">{money(r.amountCents)}</td>
                      <td>{r.counterparty || dash}</td>
                      <td className="import-desc">{r.description || dash}</td>
                      <td>{r.reference ? <code>{r.reference}</code> : dash}</td>
                      <td>
                        {r.matchKind === 'none' ? (
                          dash
                        ) : (
                          <Badge kind={matchKindBadge(r.matchKind)}>
                            {t(`enum.bankMatchKind.${r.matchKind}`)}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <Badge kind={rowStatusBadge(r.status)}>
                          {t(`enum.bankRowStatus.${r.status}`)}
                        </Badge>
                      </td>
                      <td>
                        {r.invoiceId ? (
                          <Link to={`/invoices/${r.invoiceId}`}>
                            {t('payments.invoiceNo')} {r.invoiceNumber}
                            {r.invoiceOpenCents != null
                              ? ` · ${t('invoices.open')} ${money(r.invoiceOpenCents)}`
                              : ''}
                          </Link>
                        ) : r.buildingId ? (
                          <Link to={`/buildings/${r.buildingId}`}>
                            {r.buildingAddressText ?? t('payments.building')}
                          </Link>
                        ) : (
                          dash
                        )}
                        {r.note ? <div className="muted small">{r.note}</div> : null}
                      </td>
                      <td>
                        {current.status === 'preview' ? (
                          <RowActions
                            row={r}
                            importId={current.id}
                            buildings={buildings}
                            onUpdated={setCurrent}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {current.status === 'preview' ? (
            <div className="actions">
              <ConfirmButton
                className="btn btn-primary"
                label={t('bankImport.commit', { count: bookable })}
                confirmLabel={t('bankImport.commitConfirm')}
                disabled={busy || bookable === 0}
                onConfirm={commit}
              />
              <span className="muted small">{t('bankImport.commitHint')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2>{t('bankImport.pastTitle')}</h2>
        {imports === null ? (
          <Spinner />
        ) : imports.length === 0 ? (
          <p className="muted">{t('bankImport.noImports')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('reports.created')}</th>
                  <th>{t('bankImport.file')}</th>
                  <th>{t('payments.status')}</th>
                  <th className="num">{t('bankImport.rows')}</th>
                  <th className="num">{t('bankImport.matched')}</th>
                  <th className="num">{t('bankImport.booked')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {imports.map((im) => (
                  <tr key={im.id} className={current?.id === im.id ? 'row-picked' : ''}>
                    <td>{dateTime(im.createdAt)}</td>
                    <td>{im.filename}</td>
                    <td>
                      <Badge kind={im.status === 'committed' ? 'ok' : 'warn'}>
                        {t(`bankImport.status.${im.status}`)}
                      </Badge>
                    </td>
                    <td className="num">{im.rowCount}</td>
                    <td className="num">{im.matchedCount}</td>
                    <td className="num">{im.bookedCount}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => void open(im.id)}
                      >
                        {t('dashboard.open')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
