import { useMemo, useState, type JSX } from 'react'
import type {
  AppState,
  BootError,
  BootProgress,
  Language,
  TestConnectionResult,
} from '../../../shared/types'
import { api } from '../api'
import { createTranslator, type MessageKey } from '../i18n'
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  ExternalIcon,
  FileIcon,
  FolderIcon,
  KeyIcon,
  Logo,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
} from '../components/Icons'

interface Props {
  mode: 'setup' | 'settings'
  state: AppState
  language: Language
  onLanguage: (language: Language) => void
  progress: BootProgress[]
  bootError: BootError | null
  onClose: () => void
  onViewLog: () => void
  onReset: () => void
}

interface FormState {
  apiKey: string
  baseURL: string
  workspace: string
  dshHome: string
  port: string
}

type FieldName = 'apiKey' | 'baseURL' | 'workspace' | 'dshHome' | 'port'

type Errors = Partial<Record<FieldName, string>>

const PLATFORM_API_KEYS = 'https://platform.deepseek.com/api_keys'

function isAbsolute(input: string): boolean {
  return input.startsWith('/') || /^[A-Za-z]:[\\/]/.test(input) || input.startsWith('\\\\')
}

function maskKey(key: string): string {
  if (key === '') return ''
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

function validEndpoint(value: string): boolean {
  if (value.trim() === '') return true
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function SetupWizard(props: Props): JSX.Element {
  const { state, language, mode } = props
  const t = useMemo(() => createTranslator(language), [language])

  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>({
    apiKey: '',
    baseURL: state.settings.baseURL,
    workspace: state.settings.workspace,
    dshHome: state.settings.dshHome,
    port: String(state.settings.port),
  })
  const [errors, setErrors] = useState<Errors>({})
  const [showKey, setShowKey] = useState(false)
  const [showEndpoint, setShowEndpoint] = useState(state.settings.baseURL !== '')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [test, setTest] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'error'
    result?: TestConnectionResult
  }>({ status: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<BootError | null>(null)

  const steps = [
    { title: t('step.model.title'), desc: t('step.model.desc') },
    { title: t('step.workspace.title'), desc: t('step.workspace.desc') },
    { title: t('step.ready.title'), desc: t('step.ready.desc') },
  ]

  const update = (field: FieldName, value: string): void => {
    setForm(previous => ({ ...previous, [field]: value }))
    setErrors(previous => ({ ...previous, [field]: undefined }))
    if (field === 'apiKey' || field === 'baseURL') setTest({ status: 'idle' })
  }

  const validate = (which: number): Errors => {
    const next: Errors = {}
    if (which === 0) {
      const key = form.apiKey.trim()
      if (!state.settings.apiKeyConfigured && key === '') {
        next.apiKey = t('model.keyRequired')
      } else if (key !== '' && /\s/.test(key)) {
        next.apiKey = t('model.keyInvalid')
      } else if (key !== '' && key.length < 8) {
        next.apiKey = t('model.keyTooShort')
      }
      if (!validEndpoint(form.baseURL)) next.baseURL = t('model.baseUrlInvalid')
    }
    if (which === 1) {
      if (form.workspace.trim() === '') next.workspace = t('workspace.pathRequired')
      else if (!isAbsolute(form.workspace.trim())) next.workspace = t('workspace.pathRequired')
      if (form.dshHome.trim() === '' || !isAbsolute(form.dshHome.trim())) {
        next.dshHome = t('workspace.pathRequired')
      }
      const rawPort = form.port.trim()
      const port = rawPort === '' ? 0 : Number(rawPort)
      if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) {
        next.port = t('workspace.portInvalid')
      }
    }
    return next
  }

  const goNext = (): void => {
    const found = validate(step)
    if (Object.keys(found).length > 0) {
      setErrors(found)
      return
    }
    setStep(current => Math.min(current + 1, steps.length - 1))
  }

  const chooseWorkspace = async (): Promise<void> => {
    const path = await api.chooseDirectory({
      title: t('workspace.pathLabel'),
      defaultPath: form.workspace,
    })
    if (path !== null) update('workspace', path)
  }

  const chooseDataHome = async (): Promise<void> => {
    const path = await api.chooseDirectory({
      title: t('workspace.dataLabel'),
      defaultPath: form.dshHome,
    })
    if (path !== null) update('dshHome', path)
  }

  const runTest = async (): Promise<void> => {
    if (form.apiKey.trim() === '' && !state.settings.apiKeyConfigured) {
      setErrors(previous => ({ ...previous, apiKey: t('model.keyRequired') }))
      return
    }
    setTest({ status: 'testing' })
    try {
      const result = await api.testConnection({
        apiKey: form.apiKey.trim(),
        baseURL: form.baseURL.trim(),
      })
      setTest({ status: result.ok ? 'ok' : 'error', result })
    } catch (error) {
      setTest({
        status: 'error',
        result: {
          ok: false,
          code: 'network',
          status: null,
          latencyMs: 0,
          models: [],
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const submit = async (): Promise<void> => {
    const found = { ...validate(0), ...validate(1) }
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setStep(0)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const rawPort = form.port.trim()
      await api.applySettings({
        language,
        apiKey: form.apiKey.trim(),
        baseURL: form.baseURL.trim(),
        workspace: form.workspace.trim(),
        dshHome: form.dshHome.trim(),
        port: rawPort === '' ? 0 : Number(rawPort),
        onboardingComplete: true,
      })
      if (mode === 'settings') props.onClose()
    } catch (error) {
      setSubmitError({
        message: error instanceof Error ? error.message : String(error),
        detail: props.bootError?.detail ?? '',
        logFile: props.bootError?.logFile ?? '',
      })
      setSubmitting(false)
    }
  }

  const testMessage = (result: TestConnectionResult): string => {
    if (result.ok) {
      return result.models.length > 0
        ? t('model.testOkModels', { ms: result.latencyMs, count: result.models.length })
        : t('model.testOk', { ms: result.latencyMs })
    }
    const key = `test.${result.code}` as MessageKey
    return t(key)
  }

  const error = submitError
  const keySummary =
    form.apiKey.trim() !== ''
      ? maskKey(form.apiKey.trim())
      : state.settings.apiKeyConfigured
        ? state.settings.apiKeyPreview
        : t('ready.keyNotSet')

  if (submitting || error !== null) {
    return (
      <div className="app-frame">
        <div className="aurora" aria-hidden="true" />
        <div className="provision-card">
          <div className={cx('provision-orb', error !== null && 'is-error')}>
            {error === null ? <span className="orb-spinner" /> : <AlertIcon size={28} />}
          </div>
          <h1>{error === null ? t('boot.heading') : t('boot.errorHeading')}</h1>
          <p className="provision-sub">
            {error === null ? t('boot.subheading') : error.message || t('boot.errorSub')}
          </p>

          {error === null ? (
            <div className="provision-progress">
              {props.progress.slice(-6).map((entry, index) => (
                <div className="provision-line" key={`${entry.at}-${index}`}>
                  <span className="pulse-dot" />
                  <span>{entry.message}</span>
                </div>
              ))}
              {props.progress.length === 0 && (
                <div className="provision-line">
                  <span className="pulse-dot" />
                  <span>{t('boot.preparing')}</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="error-block">
                <div className="error-title">{t('error.detail')}</div>
                <pre>{error.detail || error.message}</pre>
                {error.logFile !== '' && (
                  <div className="error-log-path">
                    {t('error.log')}: <code>{error.logFile}</code>
                  </div>
                )}
              </div>
              <div className="provision-actions">
                <button className="btn ghost" type="button" onClick={props.onViewLog}>
                  <FileIcon size={16} /> {t('boot.viewLog')}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setSubmitError(null)
                    setSubmitting(false)
                  }}
                >
                  {t('boot.edit')}
                </button>
                <button className="btn primary" type="button" onClick={() => void submit()}>
                  {t('common.retry')}
                </button>
              </div>
            </>
          )}
          {error === null && <div className="provision-hint">{t('boot.hint')}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-frame">
      <div className="aurora" aria-hidden="true" />
      <div className="wizard">
        <aside className="rail">
          <div className="brand">
            <Logo size={44} />
            <div className="brand-text">
              <span className="brand-name">{t('brand.name')}</span>
              <span className="brand-tagline">{t('brand.tagline')}</span>
            </div>
          </div>

          <nav className="stepper" aria-label="Setup steps">
            {steps.map((entry, index) => {
              const stateClass =
                index === step ? 'is-active' : index < step ? 'is-done' : 'is-todo'
              return (
                <button
                  key={entry.title}
                  type="button"
                  className={cx('stepper-item', stateClass)}
                  onClick={() => {
                    if (mode === 'settings' || index < step) setStep(index)
                  }}
                  disabled={mode !== 'settings' && index > step}
                >
                  <span className="stepper-dot">
                    {index < step ? <CheckIcon size={13} /> : String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="stepper-copy">
                    <span className="stepper-title">{entry.title}</span>
                    <span className="stepper-desc">{entry.desc}</span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="rail-foot">
            <div className="rail-secure">
              <ShieldIcon size={15} />
              <span>{t('footer.security')}</span>
            </div>
            <div className="rail-version">
              {t('footer.version', { version: state.info.appVersion })} · {t('brand.version', { version: state.info.dshVersion })}
            </div>
          </div>
        </aside>

        <main className="panel">
          <header className="panel-top">
            <div className="panel-eyebrow">
              <span className="step-index">{String(step + 1).padStart(2, '0')}</span>
              <span className="step-sep">/</span>
              <span>{String(steps.length).padStart(2, '0')}</span>
              <span className="eyebrow-label">{steps[step]?.title}</span>
            </div>
            <div className="panel-tools">
              <div className="lang-switch" role="group" aria-label={t('language.label')}>
                <button
                  type="button"
                  className={cx(language === 'zh-CN' && 'is-selected')}
                  onClick={() => props.onLanguage('zh-CN')}
                >
                  中文
                </button>
                <button
                  type="button"
                  className={cx(language === 'en-US' && 'is-selected')}
                  onClick={() => props.onLanguage('en-US')}
                >
                  EN
                </button>
              </div>
              {mode === 'settings' && (
                <button className="icon-btn" type="button" onClick={props.onClose} title={t('common.close')}>
                  <CloseIcon size={18} />
                </button>
              )}
            </div>
          </header>

          <div className="panel-body">
            {step === 0 && (
              <section className="step-pane">
                <div className="step-head">
                  <span className="kicker">
                    <SparkIcon size={14} /> {t('step.model.title')}
                  </span>
                  <h1>{t('model.heading')}</h1>
                  <p>{t('model.subheading')}</p>
                </div>

                <div className="field">
                  <div className="field-head">
                    <label htmlFor="api-key">{t('model.keyLabel')}</label>
                    <button
                      type="button"
                      className="link-inline"
                      onClick={() => void api.openExternal(PLATFORM_API_KEYS)}
                    >
                      {t('model.getKey')} <ExternalIcon size={13} />
                    </button>
                  </div>
                  <div className={cx('input-shell', errors.apiKey !== undefined && 'is-invalid')}>
                    <KeyIcon size={17} className="input-icon" />
                    <input
                      id="api-key"
                      type={showKey ? 'text' : 'password'}
                      value={form.apiKey}
                      placeholder={t('model.keyPlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={event => update('apiKey', event.target.value)}
                    />
                    <button
                      type="button"
                      className="reveal-btn"
                      onClick={() => setShowKey(value => !value)}
                    >
                      {showKey ? t('common.hide') : t('common.show')}
                    </button>
                  </div>
                  {errors.apiKey !== undefined ? (
                    <div className="field-error">
                      <AlertIcon size={13} /> {errors.apiKey}
                    </div>
                  ) : (
                    <div className="field-hint">
                      {state.settings.apiKeyConfigured
                        ? t('model.keySaved', { preview: state.settings.apiKeyPreview })
                        : t('model.keyHint')}
                    </div>
                  )}
                </div>

                <div className="test-row">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => void runTest()}
                    disabled={test.status === 'testing'}
                  >
                    {test.status === 'testing' ? (
                      <>
                        <span className="mini-spinner" /> {t('model.testing')}
                      </>
                    ) : (
                      <>
                        <ServerIcon size={16} /> {t('model.test')}
                      </>
                    )}
                  </button>
                  {test.status === 'ok' && test.result !== undefined && (
                    <span className="test-pill is-ok">
                      <CheckIcon size={13} /> {testMessage(test.result)}
                    </span>
                  )}
                  {test.status === 'error' && test.result !== undefined && (
                    <span className="test-pill is-error">
                      <AlertIcon size={13} /> {testMessage(test.result)}
                    </span>
                  )}
                </div>
                <div className="field-hint subdued">{t('model.testHint')}</div>

                <button
                  type="button"
                  className="text-toggle"
                  onClick={() => setShowEndpoint(value => !value)}
                >
                  {showEndpoint ? <ChevronIcon size={15} /> : <ChevronIcon size={15} />}
                  {showEndpoint ? t('common.advancedHide') : t('common.advanced')}
                </button>

                {showEndpoint && (
                  <div className="advanced-box">
                    <div className="field">
                      <label htmlFor="base-url">
                        {t('model.baseUrlLabel')} <span className="pill-optional">{t('common.optional')}</span>
                      </label>
                      <div className={cx('input-shell', errors.baseURL !== undefined && 'is-invalid')}>
                        <ServerIcon size={17} className="input-icon" />
                        <input
                          id="base-url"
                          type="text"
                          value={form.baseURL}
                          placeholder="https://api.deepseek.com"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={event => update('baseURL', event.target.value)}
                        />
                      </div>
                      {errors.baseURL !== undefined ? (
                        <div className="field-error">
                          <AlertIcon size={13} /> {errors.baseURL}
                        </div>
                      ) : (
                        <div className="field-hint">{t('model.baseUrlHint')}</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {step === 1 && (
              <section className="step-pane">
                <div className="step-head">
                  <span className="kicker">
                    <FolderIcon size={14} /> {t('step.workspace.title')}
                  </span>
                  <h1>{t('workspace.heading')}</h1>
                  <p>{t('workspace.subheading')}</p>
                </div>

                <div className="field">
                  <label htmlFor="workspace">{t('workspace.pathLabel')}</label>
                  <div className={cx('input-shell has-action', errors.workspace !== undefined && 'is-invalid')}>
                    <FolderIcon size={17} className="input-icon" />
                    <input
                      id="workspace"
                      type="text"
                      value={form.workspace}
                      spellCheck={false}
                      onChange={event => update('workspace', event.target.value)}
                    />
                    <button type="button" className="browse-btn" onClick={() => void chooseWorkspace()}>
                      {t('common.browse')}
                    </button>
                  </div>
                  {errors.workspace !== undefined ? (
                    <div className="field-error">
                      <AlertIcon size={13} /> {errors.workspace}
                    </div>
                  ) : (
                    <div className="field-hint">{t('workspace.pathHint')}</div>
                  )}
                </div>

                <div className="workspace-preview">
                  <span className="preview-folder">{form.workspace.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'}</span>
                  <span className="preview-meta">
                    {form.workspace.split(/[\\/]/).slice(0, -1).join('/') ||
                      (state.info.platform === 'darwin' ? 'macOS' : state.info.platform)}
                  </span>
                </div>

                <button
                  type="button"
                  className="text-toggle"
                  onClick={() => setShowAdvanced(value => !value)}
                >
                  <ChevronIcon size={15} />
                  {showAdvanced ? t('workspace.advancedHide') : t('workspace.advanced')}
                </button>

                {showAdvanced && (
                  <div className="advanced-box">
                    <div className="field">
                      <label htmlFor="data-home">{t('workspace.dataLabel')}</label>
                      <div className={cx('input-shell has-action', errors.dshHome !== undefined && 'is-invalid')}>
                        <ServerIcon size={17} className="input-icon" />
                        <input
                          id="data-home"
                          type="text"
                          value={form.dshHome}
                          spellCheck={false}
                          onChange={event => update('dshHome', event.target.value)}
                        />
                        <button type="button" className="browse-btn" onClick={() => void chooseDataHome()}>
                          {t('common.browse')}
                        </button>
                      </div>
                      {errors.dshHome !== undefined ? (
                        <div className="field-error">
                          <AlertIcon size={13} /> {errors.dshHome}
                        </div>
                      ) : (
                        <div className="field-hint">{t('workspace.dataHint')}</div>
                      )}
                    </div>

                    <div className="field field-inline">
                      <div>
                        <label htmlFor="port">{t('workspace.portLabel')}</label>
                        <div className="field-hint">{t('workspace.portHint')}</div>
                      </div>
                      <div className={cx('input-shell port-shell', errors.port !== undefined && 'is-invalid')}>
                        <input
                          id="port"
                          type="number"
                          min={0}
                          max={65535}
                          value={form.port}
                          onChange={event => update('port', event.target.value)}
                        />
                      </div>
                      {errors.port !== undefined && (
                        <div className="field-error">
                          <AlertIcon size={13} /> {errors.port}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {step === 2 && (
              <section className="step-pane">
                <div className="step-head">
                  <span className="kicker">
                    <CheckIcon size={14} /> {t('step.ready.title')}
                  </span>
                  <h1>{t('ready.heading')}</h1>
                  <p>{t('ready.subheading')}</p>
                </div>

                <div className="summary">
                  <div className="summary-row">
                    <span className="summary-label">
                      <KeyIcon size={16} /> {t('ready.key')}
                    </span>
                    <span className="summary-value mono">{keySummary}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">
                      <ServerIcon size={16} /> {t('ready.endpoint')}
                    </span>
                    <span className="summary-value mono">
                      {form.baseURL.trim() === '' ? 'https://api.deepseek.com' : form.baseURL.trim()}
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">
                      <FolderIcon size={16} /> {t('ready.workspace')}
                    </span>
                    <span className="summary-value mono" title={form.workspace}>
                      {form.workspace}
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">
                      <FileIcon size={16} /> {t('ready.data')}
                    </span>
                    <span className="summary-value mono" title={form.dshHome}>
                      {form.dshHome}
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">
                      <ShieldIcon size={16} /> {t('ready.port')}
                    </span>
                    <span className="summary-value mono">
                      {form.port.trim() === '' || form.port.trim() === '0'
                        ? t('ready.portAuto')
                        : form.port}
                    </span>
                  </div>
                </div>

                {mode !== 'settings' && (
                  <div className="notice info">
                    <SparkIcon size={16} />
                    <span>{t('ready.note')}</span>
                  </div>
                )}
                {mode === 'settings' && (
                  <div className="notice warn">
                    <AlertIcon size={16} />
                    <span>{t('settings.note')}</span>
                  </div>
                )}

                {mode === 'settings' && (
                  <div className="settings-links">
                    <button type="button" className="link-inline" onClick={props.onViewLog}>
                      <FileIcon size={14} /> {t('common.log')}
                    </button>
                    <button type="button" className="link-inline" onClick={() => void api.openDataDir()}>
                      <FolderIcon size={14} /> {t('common.dataDir')}
                    </button>
                    <button type="button" className="link-inline danger" onClick={props.onReset}>
                      <RefreshIcon size={14} /> {t('settings.reset')}
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="panel-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setStep(current => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              <ArrowLeftIcon size={16} /> {t('common.back')}
            </button>

            <div className="actions-right">
              {step < steps.length - 1 ? (
                <button type="button" className="btn primary" onClick={goNext}>
                  {t('common.next')} <ArrowRightIcon size={16} />
                </button>
              ) : (
                <button type="button" className="btn primary launch" onClick={() => void submit()}>
                  {mode === 'settings' ? t('settings.apply') : t('ready.launch')}
                  <ArrowRightIcon size={16} />
                </button>
              )}
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
