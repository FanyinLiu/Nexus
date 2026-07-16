import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatConsoleTimestamp, type ConnectionResult } from '../../../components/settingsDrawerSupport.ts'
import {
  buildConnectionTestFingerprint,
  getConnectionTestResultPresentation,
  getNextConnectionResultExpiryMs,
  resolveConnectionResultMessage,
  resolveConnectionResultRecommendation,
  shouldAcceptConnectionTestResult,
  withConnectionCheckedAt,
} from '../../models/connectionTestFreshness'
import { useModalFocusTrap } from '../../../hooks/useModalFocusTrap'
import { useTranslation } from '../../../i18n/useTranslation.ts'
import { humanizeError } from '../../../lib/humanizeError.ts'
import { pickTranslatedUiText } from '../../../lib/uiLanguage'
import type { AppSettings } from '../../../types/app.ts'
import type { TranslationKey } from '../../../types'
import {
  MODEL_SETUP_DISMISSED_STORAGE_KEY,
  buildTextModelSetupSnapshot,
  getModelProgressPercent,
  isModelProgressActive,
  isModelProgressComplete,
  isModelProgressError,
  mergeModelProgress,
  shouldShowModelSetupOverlay,
  type Inventory,
  type ModelEntry,
  type PerModelProgress,
  type ProgressEvent,
} from '../modelSetupState.ts'

type Props = {
  /** Hide the overlay even when inventory is incomplete — used while the pet view is active. */
  suppressed?: boolean
  onVisibilityChange?: (visible: boolean) => void
  settings?: AppSettings
  onOpenOnboardingGuide?: () => void
  onTestTextConnection?: (settings: AppSettings) => Promise<ConnectionResult>
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ModelSetupOverlay({
  suppressed = false,
  onVisibilityChange,
  settings,
  onOpenOnboardingGuide,
  onTestTextConnection,
}: Props) {
  const { t } = useTranslation()
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [progress, setProgress] = useState<Record<string, PerModelProgress>>({})
  const [busy, setBusy] = useState(false)
  const [textConnectionBusy, setTextConnectionBusy] = useState(false)
  const [textConnectionResult, setTextConnectionResult] = useState<{
    fingerprint: string
    result: ConnectionResult
  } | null>(null)
  const [connectionFreshnessTick, setConnectionFreshnessTick] = useState(0)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(MODEL_SETUP_DISMISSED_STORAGE_KEY) === '1' } catch { return false }
  })
  const [networkProbe, setNetworkProbe] = useState<{ huggingFaceReachable: boolean } | null>(null)
  const [pythonStatus, setPythonStatus] = useState<{
    pythonAvailable: boolean
    version: string | null
    omniVoice: { ready: boolean; missingImports: string[] }
    glmAsr: { ready: boolean; missingImports: string[] }
  } | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const dialogRef = useRef<HTMLElement | null>(null)
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null)
  const overlayVisibilityRef = useRef<boolean | null>(null)
  const overlayWasVisibleRef = useRef(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const mountedRef = useRef(true)
  const connectionGenerationRef = useRef(0)
  const refreshInventoryRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const textModelSetup = useMemo(
    () => settings ? buildTextModelSetupSnapshot(settings) : null,
    [settings],
  )

  const textConnectionFingerprint = settings
    ? buildConnectionTestFingerprint('text', settings)
    : ''

  const displayedTextConnection = textConnectionResult?.result ?? null
  const textConnectionFingerprintMatches = Boolean(
    textConnectionResult
    && textConnectionResult.fingerprint === textConnectionFingerprint,
  )
  const textConnectionPresentation = displayedTextConnection
    ? getConnectionTestResultPresentation({
      result: displayedTextConnection,
      fingerprintMatches: textConnectionFingerprintMatches,
      capability: 'text',
    })
    : null
  const preflightTextConnection = !displayedTextConnection && textModelSetup?.message
    ? {
        ok: false,
        message: textModelSetup.message,
        recommendation: textModelSetup.recommendation,
      }
    : null
  const activeTextConnection = displayedTextConnection ?? preflightTextConnection
  const textConnectionVerified = Boolean(textConnectionPresentation?.verified)
  const textConnectionToneClass = textConnectionPresentation
    ? textConnectionPresentation.tone === 'success'
      ? 'is-ok'
      : `is-${textConnectionPresentation.tone}`
    : activeTextConnection
      ? 'is-error'
      : ''
  const textConnectionLooksFailed = Boolean(
    activeTextConnection
    && !textConnectionVerified
    && (
      textConnectionPresentation
        ? textConnectionPresentation.tone === 'error'
        : !activeTextConnection.ok
    ),
  )
  const translateConnection = (
    language: AppSettings['uiLanguage'],
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => pickTranslatedUiText(language, key as TranslationKey, params)
  const activeTextConnectionMessage = displayedTextConnection && settings && textConnectionPresentation
    ? textConnectionPresentation.tone === 'stale'
      ? pickTranslatedUiText(
        settings.uiLanguage,
        textConnectionPresentation.freshness === 'config-stale'
          ? 'settings.test_connection.stale'
          : textConnectionPresentation.freshness === 'time-stale'
            ? 'settings.test_connection.expired'
            : 'settings.test_connection.unverified',
      )
      : textConnectionPresentation.tone === 'partial' && !displayedTextConnection.messageKey
        ? pickTranslatedUiText(settings.uiLanguage, 'settings.test_connection.partial')
        : resolveConnectionResultMessage(
          displayedTextConnection,
          settings.uiLanguage,
          translateConnection,
        )
    : activeTextConnection?.message
  const activeTextConnectionRecommendation = displayedTextConnection
    && settings
    && textConnectionPresentation
    && textConnectionPresentation.tone !== 'stale'
    ? resolveConnectionResultRecommendation(
      displayedTextConnection,
      settings.uiLanguage,
      translateConnection,
    )
    : activeTextConnection?.recommendation

  void connectionFreshnessTick

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      connectionGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    const nextExpiry = getNextConnectionResultExpiryMs([displayedTextConnection])
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(
      () => {
        if (mountedRef.current) setConnectionFreshnessTick((current) => current + 1)
      },
      Math.max(0, nextExpiry - Date.now()) + 25,
    )
    return () => window.clearTimeout(timer)
  }, [displayedTextConnection, connectionFreshnessTick])

  useEffect(() => {
    const refresh = () => {
      if (mountedRef.current) setConnectionFreshnessTick((current) => current + 1)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

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
      setProgress((prev) => mergeModelProgress(prev, event))

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

  const testTextConnection = useCallback(async () => {
    if (!settings || !onTestTextConnection) return
    const generation = connectionGenerationRef.current + 1
    connectionGenerationRef.current = generation
    const fingerprint = buildConnectionTestFingerprint('text', settings)
    setTextConnectionBusy(true)
    setTextConnectionResult(null)
    try {
      const result = withConnectionCheckedAt(await onTestTextConnection(settings))
      if (!mountedRef.current || !shouldAcceptConnectionTestResult({
        requestGeneration: generation,
        activeGeneration: connectionGenerationRef.current,
      })) return
      setTextConnectionResult({ fingerprint, result })
    } catch (err) {
      if (!mountedRef.current || !shouldAcceptConnectionTestResult({
        requestGeneration: generation,
        activeGeneration: connectionGenerationRef.current,
      })) return
      setTextConnectionResult({
        fingerprint,
        result: withConnectionCheckedAt<ConnectionResult>({
          ok: false,
          message: humanizeError(err, 'chat'),
          messageKey: 'settings.test_connection.failed',
        }),
      })
    } finally {
      if (mountedRef.current && shouldAcceptConnectionTestResult({
        requestGeneration: generation,
        activeGeneration: connectionGenerationRef.current,
      })) setTextConnectionBusy(false)
    }
  }, [onTestTextConnection, settings])

  const handleDismiss = useCallback(() => {
    try { sessionStorage.setItem(MODEL_SETUP_DISMISSED_STORAGE_KEY, '1') } catch { /* no session storage (sandboxed) */ }
    setDismissed(true)
  }, [])

  const overlayVisible = shouldShowModelSetupOverlay({ suppressed, dismissed, inventoryReady: inventory?.ready })
  useModalFocusTrap(dialogRef, overlayVisible)

  useLayoutEffect(() => {
    const focusSafeInitialTarget = () => {
      if (overlayVisibilityRef.current !== true) return
      const dialog = dialogRef.current
      if (!dialog?.isConnected) return
      const dismissButton = dismissButtonRef.current
      const target = dismissButton?.isConnected
        && !dismissButton.disabled
        && dialog.contains(dismissButton)
        ? dismissButton
        : dialog
      target.focus({ preventScroll: true })
    }

    if (overlayVisibilityRef.current !== overlayVisible) {
      overlayVisibilityRef.current = overlayVisible
      onVisibilityChange?.(overlayVisible)
    }

    if (overlayVisible && !overlayWasVisibleRef.current) {
      const activeElement = document.activeElement
      openerRef.current = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && activeElement !== document.documentElement
        && activeElement.isConnected
        ? activeElement
        : null
      overlayWasVisibleRef.current = true
      focusSafeInitialTarget()
    }

    if (overlayVisible) {
      const openingFrameId = window.requestAnimationFrame(() => {
        focusSafeInitialTarget()
      })
      return () => window.cancelAnimationFrame(openingFrameId)
    }

    if (!overlayVisible && overlayWasVisibleRef.current) {
      overlayWasVisibleRef.current = false
      const opener = openerRef.current
      openerRef.current = null
      if (suppressed) return undefined

      const closingFrameId = window.requestAnimationFrame(() => {
        const openerIsAvailable = Boolean(
          opener?.isConnected
          && !opener.closest('[inert], [aria-hidden="true"]'),
        )
        const chatSheetInput = document.querySelector<HTMLElement>('.chat-sheet-v2__input:not([disabled])')
        const composerInput = document.querySelector<HTMLElement>('.image4-composer textarea:not([disabled])')
        const fallback = [chatSheetInput, composerInput].find((candidate) => {
          if (!candidate?.isConnected || candidate.closest('[inert], [aria-hidden="true"]')) return false
          const style = window.getComputedStyle(candidate)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        const target = openerIsAvailable && opener ? opener : fallback
        if (target) target.focus({ preventScroll: true })
      })
      return () => window.cancelAnimationFrame(closingFrameId)
    }

    return undefined
  }, [onVisibilityChange, overlayVisible, suppressed])

  useEffect(() => {
    if (!overlayVisible || busy) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleDismiss()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, handleDismiss, overlayVisible])

  if (suppressed) return null
  if (dismissed) return null
  if (!inventory) return null
  if (inventory.ready) return null

  const requiredModels = inventory.models.filter(m => m.required)
  const optionalModels = inventory.models.filter(m => !m.required)
  const modelSetupDescription = t('model_setup.body_prefix', { path: inventory.primaryDir })
  const modelPathIndex = modelSetupDescription.indexOf(inventory.primaryDir)
  const modelDescriptionBeforePath = modelPathIndex >= 0
    ? modelSetupDescription.slice(0, modelPathIndex)
    : ''
  const modelDescriptionAfterPath = modelPathIndex >= 0
    ? modelSetupDescription.slice(modelPathIndex + inventory.primaryDir.length)
    : ''
  const pathTrailingPunctuation = modelDescriptionAfterPath.match(/^[。．.,，、]/)?.[0] ?? ''
  const modelDescriptionAfterStyledPath = pathTrailingPunctuation
    ? modelDescriptionAfterPath.slice(pathTrailingPunctuation.length)
    : modelDescriptionAfterPath

  const renderRow = (model: ModelEntry) => {
    const p = progress[model.id]
    const pct = getModelProgressPercent(p)
    const isActive = isModelProgressActive(p)
    const isComplete = isModelProgressComplete(p)
    const hasError = isModelProgressError(p)
    const isInstalled = model.present || isComplete

    return (
      <div key={model.id} className="model-setup__row" data-state={isInstalled ? 'done' : hasError ? 'error' : isActive ? 'active' : 'pending'}>
        <div className="model-setup__row-main">
          <div className="model-setup__row-title">
            <strong>{model.label}</strong>
            <span className="model-setup__size">{model.sizeLabel}</span>
            {!model.required ? <span className="model-setup__tag">{t('model_setup.optional_tag')}</span> : null}
          </div>
          <div className="model-setup__row-desc">{model.purpose}</div>
          {isInstalled ? (
            <div className="model-setup__row-status model-setup__row-status--ok">{t('model_setup.installed')}</div>
          ) : isActive ? (
            <div className="model-setup__row-status" role="status" aria-live="polite" aria-atomic="true">
              {pct !== null ? `${pct}% · ${formatBytes(p.downloaded)} / ${formatBytes(p.total)}` : t('model_setup.downloading')}
              {p?.fileName ? <span className="model-setup__row-file"> · {p.fileName}</span> : null}
            </div>
          ) : hasError ? (
            <div className="model-setup__row-status model-setup__row-status--error" role="alert" aria-live="assertive" aria-atomic="true">
              {p?.message ? t('model_setup.failed_with_message', { message: p.message }) : t('model_setup.failed')}
            </div>
          ) : (
            <div className="model-setup__row-status model-setup__row-status--pending">{t('model_setup.pending')}</div>
          )}
        </div>

        <div className="model-setup__row-action">
          {!isInstalled && !isActive ? (
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
          <progress
            className="model-setup__progress"
            value={pct}
            max={100}
            aria-label={`${model.label} ${t('model_setup.downloading')}`}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="model-setup-backdrop">
      <section
        ref={dialogRef}
        className="model-setup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-setup-title"
        aria-describedby="model-setup-description"
        tabIndex={-1}
      >
        <header className="model-setup-card__header">
          <div>
            <p className="eyebrow">{t('model_setup.eyebrow')}</p>
            <h2 id="model-setup-title">{t('model_setup.title')}</h2>
            <p id="model-setup-description" className="model-setup-card__copy">
              {modelPathIndex >= 0 ? (
                <>
                  {modelDescriptionBeforePath}
                  <span className="model-setup-card__path">
                    {inventory.primaryDir}{pathTrailingPunctuation}
                  </span>
                  {modelDescriptionAfterStyledPath}
                </>
              ) : modelSetupDescription}
            </p>
          </div>
          <button ref={dismissButtonRef} className="ghost-button" type="button" onClick={handleDismiss} disabled={busy}>
            {t('model_setup.dismiss')}
          </button>
        </header>

        <div className="model-setup-card__body">
          {networkProbe && !networkProbe.huggingFaceReachable ? (
            <div className="model-setup__hint">
              {t('model_setup.network_hf_unreachable')}
            </div>
          ) : null}

          {errorBanner ? (
            <div className="model-setup__error" role="alert" aria-live="assertive" aria-atomic="true">
              {errorBanner}
            </div>
          ) : null}

          {textModelSetup ? (
            <div
              className={`model-setup__text-check${textConnectionToneClass ? ` ${textConnectionToneClass}` : ''}`}
            >
              <div className="model-setup__text-check-main">
                <strong>{t('model_setup.text_check_title')}</strong>
                <p>
                  {t('model_setup.text_check_current', {
                    provider: textModelSetup.providerLabel,
                    model: textModelSetup.modelLabel,
                  })}
                </p>
                {activeTextConnection ? (
                  <div
                    className={`model-setup__text-check-status ${textConnectionToneClass || 'is-error'}`}
                    role={textConnectionLooksFailed ? 'alert' : 'status'}
                    aria-live={textConnectionLooksFailed ? 'assertive' : 'polite'}
                  >
                    {activeTextConnectionMessage}
                    {activeTextConnectionRecommendation ? (
                      <span>{activeTextConnectionRecommendation}</span>
                    ) : null}
                    {displayedTextConnection?.checkedAt && settings ? (
                      <time dateTime={displayedTextConnection.checkedAt}>
                        {pickTranslatedUiText(settings.uiLanguage, 'settings.test_connection.checked_at', {
                          time: formatConsoleTimestamp(displayedTextConnection.checkedAt, settings.uiLanguage),
                        })}
                      </time>
                    ) : null}
                  </div>
                ) : (
                  <div className="model-setup__text-check-status" role="status" aria-live="polite">
                    {t('model_setup.text_check_ready')}
                  </div>
                )}
              </div>
              <div className="model-setup__text-check-actions">
                <button
                  type="button"
                  className="model-setup__inline-btn"
                  onClick={testTextConnection}
                  disabled={textConnectionBusy || !onTestTextConnection}
                >
                  {textConnectionBusy ? t('model_setup.text_check_testing') : t('model_setup.text_check_action')}
                </button>
                {onOpenOnboardingGuide ? (
                  <button
                    type="button"
                    className="model-setup__inline-btn model-setup__inline-btn--secondary"
                    onClick={onOpenOnboardingGuide}
                    disabled={textConnectionBusy}
                  >
                    {t('model_setup.text_check_open_guide')}
                  </button>
                ) : null}
              </div>
            </div>
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
        </div>

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
