import { useCallback, useEffect, useState } from 'react'
import type { EnrollmentTokenDto, SessionDto, UserDto, UserRole } from '@avroleva/contracts'
import { UserRole as UserRoleEnum } from '@avroleva/contracts'
import { get, patch, post } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import {
  Badge,
  ConfirmButton,
  Empty,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
  toast,
} from '../components/ui'
import { EnumSelect } from '../components/EnumSelect'
import { useForm } from '../components/useForm'

interface NewUser {
  username: string
  password: string
  name: string
  role: UserRole
  email: string
  phone: string
}

export function UsersPage() {
  const { t, dateTime } = useI18n()
  const { me } = useAuth()
  const [users, setUsers] = useState<UserDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [showNew, setShowNew] = useState(false)
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [enroll, setEnroll] = useState<EnrollmentTokenDto | null>(null)
  const [sessions, setSessions] = useState<SessionDto[] | null>(null)
  const form = useForm<NewUser>({
    username: '',
    password: '',
    name: '',
    role: 'technician',
    email: '',
    phone: '',
  })

  const load = useCallback(
    () =>
      get<{ items: UserDto[] }>('/users')
        .then((r) => setUsers(r.items))
        .catch(setError),
    [],
  )
  const loadSessions = useCallback(
    () =>
      get<{ items: SessionDto[] }>('/auth/sessions')
        .then((r) => setSessions(r.items))
        .catch(setError),
    [],
  )
  useEffect(() => {
    void load()
    void loadSessions()
  }, [load, loadSessions])

  if (error) return <ErrorBox error={error} />
  if (!users) return <Spinner />

  const update = async (u: UserDto, body: Partial<{ role: UserRole; isActive: boolean }>) => {
    try {
      await patch(`/users/${u.id}`, body)
      toast(t('common.saved'))
      await load()
    } catch (e) {
      setError(e)
    }
  }

  const connectPhone = async (u: UserDto) => {
    try {
      setEnroll(await post<EnrollmentTokenDto>(`/users/${u.id}/enroll-token`))
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
            {t('users.new')}
          </button>
        }
      />
      {showNew ? (
        <form
          className="card narrow"
          onSubmit={(e) => {
            e.preventDefault()
            void form.submit(async (v) => {
              await post('/users', v)
              toast(t('common.saved'))
              setShowNew(false)
              form.setValues({
                username: '',
                password: '',
                name: '',
                role: 'technician',
                email: '',
                phone: '',
              })
              await load()
            })
          }}
        >
          <h2>{t('users.new')}</h2>
          <div className="row">
            <Field label={t('users.name')} required error={form.errors.name}>
              <input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label={t('users.role')} error={form.errors.role}>
              <EnumSelect
                value={form.values.role}
                options={UserRoleEnum.options}
                prefix="enum.userRole"
                onChange={(x) => x && form.set('role', x)}
              />
            </Field>
          </div>
          <div className="row">
            <Field
              label={t('auth.username')}
              required
              error={form.errors.username}
              hint={t('users.usernameHint')}
            >
              <input
                autoComplete="off"
                value={form.values.username}
                onChange={(e) => form.set('username', e.target.value)}
              />
            </Field>
            <Field
              label={t('auth.password')}
              required
              error={form.errors.password}
              hint={t('users.passwordHint')}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={form.values.password}
                onChange={(e) => form.set('password', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('contacts.email')} error={form.errors.email}>
              <input
                type="email"
                value={form.values.email}
                onChange={(e) => form.set('email', e.target.value)}
              />
            </Field>
            <Field label={t('contacts.phone')} error={form.errors.phone}>
              <input
                value={form.values.phone}
                onChange={(e) => form.set('phone', e.target.value)}
              />
            </Field>
          </div>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={() => setShowNew(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {enroll ? (
        <div className="card narrow">
          <h2>{t('users.connectPhoneTitle', { name: enroll.userName })}</h2>
          <p className="muted small">{t('users.connectPhoneHint')}</p>
          <div className="enroll-box">
            {/* Server-rendered QR (qrcode package), safe to inject; no inline scripts. */}
            <div className="qr" dangerouslySetInnerHTML={{ __html: enroll.qrSvg }} />
            <div>
              <div className="field-label">{t('users.enrollCode')}</div>
              <div className="enroll-code">{enroll.token}</div>
              <p className="small muted">
                {t('users.enrollExpires', { at: dateTime(enroll.expiresAt) })}
              </p>
              <p className="small">
                <a href={enroll.url} target="_blank" rel="noopener">
                  {enroll.url}
                </a>
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    const u = users.find((x) => x.id === enroll.userId)
                    if (u) void connectPhone(u)
                  }}
                >
                  {t('users.enrollNew')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => setEnroll(null)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('users.name')}</th>
              <th>{t('auth.username')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.status')}</th>
              <th>{t('users.lastLogin')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'muted'}>
                <td>
                  {u.name}
                  {u.id === me?.user.id ? (
                    <span className="muted small"> ({t('users.you')})</span>
                  ) : null}
                </td>
                <td>
                  <code>{u.username}</code>
                </td>
                <td>
                  <EnumSelect
                    value={u.role}
                    options={UserRoleEnum.options}
                    prefix="enum.userRole"
                    disabled={u.id === me?.user.id}
                    onChange={(x) => x && update(u, { role: x })}
                  />
                </td>
                <td>
                  <Badge kind={u.isActive ? 'ok' : 'muted'}>
                    {u.isActive ? t('users.active') : t('users.inactive')}
                  </Badge>
                </td>
                <td>
                  {u.lastLoginAt ? dateTime(u.lastLoginAt) : <span className="muted">—</span>}
                </td>
                <td className="actions">
                  {u.isActive ? (
                    <button
                      type="button"
                      className="btn btn-small btn-primary"
                      onClick={() => connectPhone(u)}
                    >
                      {t('users.connectPhone')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setPwFor(pwFor === u.id ? null : u.id)}
                  >
                    {t('users.setPassword')}
                  </button>
                  {u.id !== me?.user.id ? (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => update(u, { isActive: !u.isActive })}
                    >
                      {u.isActive ? t('users.deactivate') : t('users.reactivate')}
                    </button>
                  ) : null}
                  {pwFor === u.id ? (
                    <form
                      className="inline-form-row"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        try {
                          await post(`/users/${u.id}/password`, { password: pw })
                          toast(t('users.passwordSet'))
                          setPw('')
                          setPwFor(null)
                        } catch (err) {
                          setError(err)
                        }
                      }}
                    >
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder={t('users.passwordHint')}
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn btn-small btn-primary"
                        disabled={pw.length < 8}
                      >
                        {t('common.save')}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>{t('users.sessions')}</h2>
        <p className="muted small">{t('users.sessionsHint')}</p>
        {!sessions ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <Empty text={t('users.noSessions')} />
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('users.name')}</th>
                  <th>{t('users.sessionKind')}</th>
                  <th>{t('users.sessionDevice')}</th>
                  <th>{t('users.sessionSince')}</th>
                  <th>{t('users.sessionLastSeen')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.userName}
                      {s.current ? (
                        <span className="muted small"> ({t('users.sessionCurrent')})</span>
                      ) : null}
                    </td>
                    <td>
                      <Badge kind={s.kind === 'device' ? 'info' : 'muted'}>
                        {t(`enum.sessionKind.${s.kind}`)}
                      </Badge>
                    </td>
                    <td>
                      {s.deviceName ?? <span className="muted">—</span>}
                      {s.clientVersion ? (
                        <span className="muted small"> · {s.clientVersion}</span>
                      ) : null}
                    </td>
                    <td>{dateTime(s.createdAt)}</td>
                    <td>{dateTime(s.lastSeenAt)}</td>
                    <td className="actions">
                      {!s.current ? (
                        <ConfirmButton
                          className="btn btn-small btn-danger-outline"
                          label={t('users.sessionRevoke')}
                          onConfirm={async () => {
                            await post(`/auth/sessions/${s.id}/revoke`)
                            toast(t('users.sessionRevoked'))
                            await loadSessions()
                          }}
                        />
                      ) : null}
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
