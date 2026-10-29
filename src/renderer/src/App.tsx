import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppState, BootError, BootProgress, Language } from '../../shared/types'
import { api } from './api'
import { createTranslator } from './i18n'
import { BootScreen } from './views/BootScreen'
import { SetupWizard } from './views/SetupWizard'
import { AlertIcon, Logo } from './components/Icons'

function readRoute(): string {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === '') return '/'
  return hash.startsWith('/') ? hash : `/${hash}`
}

export default function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [route, setRoute] = useState<string>(readRoute)
  const [language, setLanguage] = useState<Language>('zh-CN')
  const [progress, setProgress] = useState<BootProgress[]>([])
  const [bootError, setBootError] = useState<BootError | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getState()
      .then(next => {
        if (!alive) return
        setState(next)
        setLanguage(next.settings.language)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setFatal(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(readRoute())
      setProgress([])
      setBootError(null)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const offProgress = api.onProgress(entry => {
      setProgress(previous => [...previous.slice(-29), entry])
    })
    const offError = api.onError(entry => {
      setBootError(entry)
    })
    const offState = api.onServerState(server => {
      setState(previous => (previous === null ? previous : { ...previous, server }))
    })
    return () => {
      offProgress()
      offError()
      offState()
    }
  }, [])

  const t = useMemo(() => createTranslator(language), [language])

  const retryBoot = (): void => {
    setBootError(null)
    setProgress([])
    void api.start()
  }

  if (fatal !== null) {
    return (
      <div className="app-frame boot-frame">
        <div className="aurora" aria-hidden="true" />
        <div className="boot-card is-error">
          <div className="boot-badge error">
            <AlertIcon size={26} />
          </div>
          <h1>{t('error.unexpected')}</h1>
          <p className="boot-sub">{fatal}</p>
          <div className="boot-actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state === null) {
    return (
      <div className="app-frame boot-frame">
        <div className="aurora" aria-hidden="true" />
        <div className="boot-card is-plain">
          <div className="boot-brand">
            <Logo size={58} />
            <span className="boot-brand-name">{t('brand.name')}</span>
          </div>
          <div className="boot-orb">
            <span className="orb-ring" />
            <span className="orb-core">
              <span className="mini-spinner large" />
            </span>
          </div>
          <p className="boot-sub">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  const mode =
    route === '/settings'
      ? 'settings'
      : route === '/boot'
        ? 'boot'
        : state.settings.onboardingComplete
          ? 'boot'
          : 'setup'

  if (mode === 'setup' || mode === 'settings') {
    return (
      <SetupWizard
        mode={mode === 'settings' ? 'settings' : 'setup'}
        state={state}
        language={language}
        onLanguage={next => {
          setLanguage(next)
          setState(previous =>
            previous === null
              ? previous
              : { ...previous, settings: { ...previous.settings, language: next } },
          )
        }}
        progress={progress}
        bootError={bootError}
        onClose={() => void api.closeSettings()}
        onViewLog={() => void api.openLog()}
        onReset={() => {
          void api.resetApp().then(next => {
            setState(next)
            setRoute('/')
            setBootError(null)
            setProgress([])
            setLanguage(next.settings.language)
          })
        }}
      />
    )
  }

  return (
    <BootScreen
      state={state}
      language={language}
      progress={progress}
      error={bootError}
      onRetry={retryBoot}
      onEdit={() => void api.openSettings()}
      onViewLog={() => void api.openLog()}
    />
  )
}
