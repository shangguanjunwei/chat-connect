import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppState, BootError, BootProgress, Language } from '../../../shared/types'
import { api } from '../api'
import { createTranslator } from '../i18n'
import { AlertIcon, FileIcon, Logo, SparkIcon } from '../components/Icons'

interface Props {
  state: AppState
  language: Language
  progress: BootProgress[]
  error: BootError | null
  onRetry: () => void
  onEdit: () => void
  onViewLog: () => void
}

export function BootScreen(props: Props): JSX.Element {
  const t = useMemo(() => createTranslator(props.language), [props.language])
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    void api.start()
  }, [])

  useEffect(() => {
    if (props.error !== null) return undefined
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [props.error])

  const lines = props.progress.slice(-5)

  if (props.error !== null) {
    return (
      <div className="app-frame boot-frame">
        <div className="aurora" aria-hidden="true" />
        <div className="boot-card is-error">
          <div className="boot-badge error">
            <AlertIcon size={26} />
          </div>
          <h1>{t('boot.errorHeading')}</h1>
          <p className="boot-sub">{props.error.message || t('boot.errorSub')}</p>

          <div className="error-block">
            <div className="error-title">{t('error.detail')}</div>
            <pre>{props.error.detail || props.error.message}</pre>
            {props.error.logFile !== '' && (
              <div className="error-log-path">
                {t('error.log')}: <code>{props.error.logFile}</code>
              </div>
            )}
          </div>

          <div className="boot-actions">
            <button type="button" className="btn ghost" onClick={props.onViewLog}>
              <FileIcon size={16} /> {t('boot.viewLog')}
            </button>
            <button type="button" className="btn secondary" onClick={props.onEdit}>
              {t('boot.edit')}
            </button>
            <button type="button" className="btn primary" onClick={props.onRetry}>
              {t('boot.retry')}
            </button>
          </div>
          <div className="boot-hint">{t('boot.hint')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-frame boot-frame">
      <div className="aurora" aria-hidden="true" />
      <div className="boot-card">
        <div className="boot-brand">
          <Logo size={58} />
          <span className="boot-brand-name">{t('brand.name')}</span>
        </div>

        <div className="boot-orb">
          <span className="orb-ring" />
          <span className="orb-ring delay" />
          <span className="orb-core">
            <SparkIcon size={22} />
          </span>
        </div>

        <h1>{t('boot.heading')}</h1>
        <p className="boot-sub">{t('boot.subheading')}</p>

        <div className="boot-progress">
          {lines.length === 0 ? (
            <div className="boot-progress-line">
              <span className="pulse-dot" />
              <span>{t('boot.preparing')}</span>
            </div>
          ) : (
            lines.map((entry, index) => (
              <div className="boot-progress-line" key={`${entry.at}-${index}`}>
                <span className={entry.level === 'error' ? 'pulse-dot error' : 'pulse-dot'} />
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>

        <div className="boot-meta">
          <span>{t('boot.elapsed', { s: seconds })}</span>
          <span className="boot-meta-sep" />
          <span>{t('boot.hint')}</span>
        </div>
      </div>
    </div>
  )
}
