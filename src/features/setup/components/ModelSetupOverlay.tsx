import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../i18n/useTranslation.ts'
import { humanizeError } from '../../../lib/humanizeError.ts'

type ModelEntry = {
  id: string
  label: string
  sizeLabel: string
  purpose: string
  required: boolean
  kind: 'archive' | 'files' | 'standalone'
  present: boolean
  location: string | null
}

type Inventory = {
  models: ModelEntry[]
  ready: boolean
  missingRequired: string[]
  primaryDir: string
  searchRoots: string[]
}

type ProgressEvent = {
  modelId: string
  phase: 'start' | 'downloading' | 'done' | 'installed' | 'error'
  downloaded?: number
  total?: number
  fileName?: string
  message?: string
}

type PerModelProgress = {
  phase: ProgressEvent['phase']
  downloaded: number
  total: number
  fileName?: string
  message?: string
}

type Props = {
  /** Hide the overlay even when inventory is incomplete — used while the pet view is active. */
  suppressed?: boolean
}

const STORAGE_KEY = 'nexus.modelSetup.dismissedUntilRestart'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ModelSetupOverlay({ suppressed = false }: Props) {
  const { t } = useTranslation()
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [progress, setProgress] = useState<Record<string, PerModelProgress>>({})
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [networkProbe, setNetworkProbe] = useState<{ huggingFaceReachable: boolean } | null>(null)
  const [pythonStatus, setPythonStatus] = useState<{
    pythonAvailable: boolean
    version: string | null
    omniVoice: { ready: boolean; missingImports: string[] }
    glmAsr: { ready: boolean; missingImports: string[] }
  } | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const refreshInventoryRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const refreshInventory = useCallback(async () => {
    try {
      const inv = await window.desktopPet?.modelsGetInventory?.()
      if (inv) setInventory(inv)
    } catch (err) {
      console.warn('[ModelSetup] inventory fetch failed:', err)
    }
  }, [])
  refreshInventoryRef.current = refreshInventory

  useEffect(() => {
    refreshInventory()
    window.desktopPet?.modelsNetworkProbe?.().then(setNetworkProbe).catch(() => {})
    window.desktopPet?.pythonRuntimeStatus?.().then(setPythonStatus).catch(() => {})
  }, [refreshInventory])

  useEffect(() => {
    const unsubscribe = window.desktopPet?.subscribeModelsProgress?.((event: ProgressEvent) => {
      setProgress((prev) => {
        const current = prev[event.modelId] ?? { phase: 'start', downloaded: 0, total: 0 }
        const next: PerModelProgress = {
          phase: event.phase,
          downloaded: event.downloaded ?? current.downloaded,
          total: event.total ?? current.total,
          fileName: event.fileName ?? current.fileName,
          message: event.message ?? current.message,
        }
        return { ...prev, [event.modelId]: next }
      })

      if (event.phase === 'installed' || event.phase === 'done') {
        refreshInventoryRef.current()
      }
    })
    return () => { unsubscribe?.() }
  }, [])

  const startDownloadAll = useCallback(async () => {
    setBusy(true)
    setErrorBanner(null)
    try {
      const result = await window.desktopPet?.modelsDownloadMissing?.()
      if (result?.inventory) setInventory(result.inventory)
      const failed = result?.results.filter(r => !r.ok) ?? []
      if (failed.length) {
        setErrorBanner(t('model_setup.partial_failure', { ids: failed.map(f => f.id).join(', ') }))
      }
    } catch (err) {
      setErrorBanner(humanizeError(err, 'model'))
    } finally {
      setBusy(false)
    }
  }, [t])

  const retryModel = useCallback(async (modelId: string) => {
    setErrorBanner(null)
    try {
      await window.desktopPet?.modelsDownload?.(modelId)
      await refreshInventory()
    } catch (err) {
      setErrorBanner(humanizeError(err, 'model'))
    }
  }, [refreshInventory])

  const handleDismiss = useCallback(() => {
    try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* no session storage (sandboxed) */ }
    setDismissed(true)
  }, [])

  if (suppressed) return null
  if (dismissed) return null
  if (!inventory) return null
  if (inventory.ready) return null

  const requiredModels = inventory.models.filter(m => m.required)
  const optionalModels = inventory.models.filter(m => !m.required)

  const renderRow = (model: ModelEntry) => {
    const p = progress[model.id]
    const pct = p && p.total > 0 ? Math.min(100, Math.floor((p.downloaded / p.total) * 100)) : null
    const isActive = p && (p.phase === 'start' || p.phase === 'downloading')
    const hasError = p?.phase === 'error'

    return (
      <div key={model.id} className="model-setup__row" data-state={model.present ? 'done' : hasError ? 'error' : isActive ? 'active' : 'pending'}>
        <div className="model-setup__row-main">
          <div className="model-setup__row-title">
            <strong>{model.label}</strong>
            <span className="model-setup__size">{model.sizeLabel}</span>
            {!model.required ? <span className="model-setup__tag">{t('model_setup.optional_tag')}</span> : null}
          </div>
          <div className="model-setup__row-desc">{model.purpose}</div>
          {model.present ? (
            <div className="model-setup__row-status model-setup__row-status--ok">{t('model_setup.installed')}</div>
          ) : isActive ? (
            <div className="model-setup__row-status">
              {pct !== null ? `${pct}% · ${formatBytes(p.downloaded)} / ${formatBytes(p.total)}` : t('model_setup.downloading')}
              {p?.fileName ? <span className="model-setup__row-file"> · {p.fileName}</span> : null}
            </div>
          ) : hasError ? (
            <div className="model-setup__row-status model-setup__row-status--error">
              {p?.message ? t('model_setup.failed_with_message', { message: p.message }) : t('model_setup.failed')}
            </div>
          ) : (
            <div className="model-setup__row-status model-setup__row-status--pending">{t('model_setup.pending')}</div>
          )}
        </div>

        <div className="model-setup__row-action">
          {!model.present && !isActive ? (
            <button
              type="button"
              className="model-setup__inline-btn"
              onClick={() => retryModel(model.id)}
              disabled={busy}
            >
              {hasError ? t('model_setup.retry') : t('model_setup.download')}
            </button>
          ) : null}
        </div>

        {pct !== null && isActive ? (
          <div className="model-setup__progress">
            <div className="model-setup__progress-bar" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="model-setup-backdrop" role="dialog" aria-modal="true">
      <section className="model-setup-card">
        <header className="model-setup-card__header">
          <div>
            <p className="eyebrow">{t('model_setup.eyebrow')}</p>
            <h2>{t('model_setup.title')}</h2>
            <p className="model-setup-card__copy">
              {t('model_setup.body_prefix', { path: inventory.primaryDir })}
            </p>
          </div>
          <button className="ghost-button" type="button" onClick={handleDismiss} disabled={busy}>
            {t('model_setup.dismiss')}
          </button>
        </header>

        {networkProbe && !networkProbe.huggingFaceReachable ? (
          <div className="model-setup__hint">
            {t('model_setup.network_hf_unreachable')}
          </div>
        ) : null}

        {errorBanner ? (
          <div className="model-setup__error">{errorBanner}</div>
        ) : null}

        <div className="model-setup__list">
          <h3>{t('model_setup.required_heading')}</h3>
          {requiredModels.map(renderRow)}

          {optionalModels.length ? (
            <>
              <h3 className="model-setup__optional-title">{t('model_setup.optional_heading')}</h3>
              {optionalModels.map(renderRow)}
            </>
          ) : null}
        </div>

        {pythonStatus ? (
          <div className="model-setup__python">
            <strong>{t('model_setup.python_title')}</strong>
            <div>
              {pythonStatus.pythonAvailable
                ? t('model_setup.python_detected', { version: pythonStatus.version ?? '' })
                : t('model_setup.python_not_detected')}
            </div>
            {pythonStatus.pythonAvailable && !pythonStatus.omniVoice.ready ? (
              <div className="model-setup__python-note">
                {t('model_setup.python_missing_deps', { deps: pythonStatus.omniVoice.missingImports.join(', ') })}
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className="model-setup-card__actions">
          <button
            type="button"
            className="primary-button"
            onClick={startDownloadAll}
            disabled={busy || inventory.missingRequired.length === 0}
          >
            {busy ? t('model_setup.downloading') : t('model_setup.download_all', { count: inventory.missingRequired.length })}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={refreshInventory}
            disabled={busy}
          >
            {t('model_setup.refresh')}
          </button>
        </footer>
      </section>
    </div>
  )
}
