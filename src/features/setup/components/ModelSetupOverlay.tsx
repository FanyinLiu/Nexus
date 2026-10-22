import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useModalFocusTrap } from '../../../hooks/useModalFocusTrap.ts'
import { useTranslation } from '../../../i18n/useTranslation.ts'
import { humanizeError } from '../../../lib/humanizeError.ts'
import { localModelCopy, missingVoiceModelIds, voiceModelDownloadPayload } from '../localModelRepair.ts'
import {
  MODEL_SETUP_DISMISSED_STORAGE_KEY,
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
import {
  hasModelSetupRequest,
  subscribeModelSetupRequests,
} from '../modelSetupRequests.ts'
import { declineModelSetup } from '../../../lib/modelSetupBridge.ts'

type Props = {
  /** Hide the overlay while another modal owns the screen (settings, onboarding guide). */
  suppressed?: boolean
  onVisibilityChange?: (visible: boolean) => void
  /**
   * Listener selected in settings. The button counts and downloads the same
   * set as Voice settings. A cloud id adds no speech model.
   */
  speechInputProviderId?: string
}

function readModelSetupDismissed(): boolean {
  try { return sessionStorage.getItem(MODEL_SETUP_DISMISSED_STORAGE_KEY) === '1' } catch { return false }
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
  speechInputProviderId,
}: Props) {
  const { t } = useTranslation()
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [progress, setProgress] = useState<Record<string, PerModelProgress>>({})
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(readModelSetupDismissed)
  const [requested, setRequested] = useState(hasModelSetupRequest)
  const [coverSeen, setCoverSeen] = useState(suppressed)
  if (coverSeen !== suppressed) {
    setCoverSeen(suppressed)
    // A covering guide is not "maybe later". Re-read the dismiss flag when
    // the cover lifts so the dialog comes back unless the user dismissed it.
    if (!suppressed) {
      const stored = readModelSetupDismissed()
      if (dismissed !== stored) setDismissed(stored)
    }
  }
  const [networkProbe, setNetworkProbe] = useState<{ huggingFaceReachable: boolean } | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const dialogRef = useRef<HTMLElement | null>(null)
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null)
  const overlayVisibilityRef = useRef<boolean | null>(null)
  const overlayWasVisibleRef = useRef(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const refreshInventoryRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const fetchInventory = useCallback(async (): Promise<Inventory | null> => {
    try {
      return (await window.desktopPet?.modelsGetInventory?.()) ?? null
    } catch (err) {
      console.warn('[ModelSetup] inventory fetch failed:', err)
      return null
    }
  }, [])
  const refreshInventory = useCallback(async () => {
    const inv = await fetchInventory()
    if (inv) setInventory(inv)
  }, [fetchInventory])
  useEffect(() => {
    refreshInventoryRef.current = refreshInventory
  }, [refreshInventory])

  useEffect(() => {
    // Initial load: setState happens inside the promise callback (the pattern
    // react-hooks/set-state-in-effect sanctions), not via a direct call to
    // the async refresher from the effect body.
    void fetchInventory().then((inv) => {
      if (inv) setInventory(inv)
    })
    window.desktopPet?.modelsNetworkProbe?.().then(setNetworkProbe).catch(() => {})
  }, [fetchInventory])

  useEffect(() => subscribeModelSetupRequests(() => setRequested(true)), [])

  // sessionStorage only lasts for this page. The refusal itself is on disk
  // in the main process; peeking it (without spending the reminder) keeps
  // the dialog closed after a restart even if a request is replayed.
  useEffect(() => {
    let cancelled = false
    const claim = window.desktopPet?.claimModelSetupReminder
    if (!claim) return undefined
    void claim({ peek: true }).then((state) => {
      if (!cancelled && state?.declined === true) setDismissed(true)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

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
      const result = await window.desktopPet?.modelsDownloadMissing?.(
        voiceModelDownloadPayload(speechInputProviderId ?? ''),
      )
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
  }, [speechInputProviderId, t])

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
    // A wake-word save may still be counting down in the main process.
    // The refusal retracts it, closes the box, and keeps the installer from
    // being offered again in this session.
    declineModelSetup()
    try { sessionStorage.setItem(MODEL_SETUP_DISMISSED_STORAGE_KEY, '1') } catch { /* no session storage (sandboxed) */ }
    setDismissed(true)
  }, [])

  const voiceStillNeeded = inventory
    ? missingVoiceModelIds(inventory.models, speechInputProviderId ?? '').length > 0
    : undefined
  const overlayVisible = shouldShowModelSetupOverlay({
    dismissed,
    // Required models alone are not "done": the selected listener is part of
    // this install, and the dialog has to stay up while that file is fetched.
    inventoryReady: voiceStillNeeded === undefined ? undefined : !voiceStillNeeded,
    requested,
    suppressed,
  })
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
  if (!requested) return null
  if (!inventory) return null
  if (!voiceStillNeeded) return null

  const missingIds = missingVoiceModelIds(inventory.models, speechInputProviderId ?? '')
  const requiredModels = inventory.models.filter(m => m.required)
  const optionalModels = inventory.models.filter(m => !m.required)
  const optionalStatus = (required: boolean) => (
    required ? '' : ` · ${t('model_setup.optional_tag')}`
  )

  const renderRow = (model: ModelEntry) => {
    const p = progress[model.id]
    const pct = getModelProgressPercent(p)
    const isComplete = isModelProgressComplete(p)
    const isActive = !isComplete && (
      isModelProgressActive(p) || (inventory.downloading ?? []).includes(model.id)
    )
    const hasError = isModelProgressError(p)
    const isInstalled = model.present || isComplete
    const copy = localModelCopy(model, t)
    const label = copy.label

    return (
      <div key={model.id} className="model-setup__row" data-state={isInstalled ? 'done' : hasError ? 'error' : isActive ? 'active' : 'pending'}>
        <div className="model-setup__row-main">
          <div className="model-setup__row-title">
            <strong>{label}</strong>
            <span className="model-setup__size">{model.sizeLabel}</span>
          </div>
          <div className="model-setup__row-desc">{copy.purpose}</div>
          {isInstalled ? (
            <div className="model-setup__row-status model-setup__row-status--ok">{t('model_setup.installed')}</div>
          ) : isActive ? (
            <div className="model-setup__row-status" role="status" aria-live="polite" aria-atomic="true">
              {pct !== null ? `${pct}% · ${formatBytes(p.downloaded)} / ${formatBytes(p.total)}` : t('model_setup.downloading')}
              {p?.fileName ? <span className="model-setup__row-file"> · {p.fileName}</span> : null}
              {optionalStatus(model.required)}
            </div>
          ) : hasError ? (
            <div className="model-setup__row-status model-setup__row-status--error" role="alert" aria-live="assertive" aria-atomic="true">
              {p?.message ? t('model_setup.failed_with_message', { message: p.message }) : t('model_setup.failed')}
              {optionalStatus(model.required)}
            </div>
          ) : (
            <div className="model-setup__row-status model-setup__row-status--pending">
              {t('model_setup.pending')}
              {optionalStatus(model.required)}
            </div>
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
            aria-label={`${label} ${t('model_setup.downloading')}`}
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
            <h2 id="model-setup-title">{t('model_setup.title')}</h2>
            <p className="model-setup-card__copy">
              {t('model_setup.voice_invite')}
            </p>
            <p id="model-setup-description" className="model-setup-card__copy">
              {t('model_setup.body_prefix')}
            </p>
            <p className="model-setup-card__copy">
              {t('model_setup.dismiss_hint')}
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
        </div>

        <footer className="model-setup-card__actions">
          <button
            type="button"
            className="primary-button"
            onClick={startDownloadAll}
            disabled={busy || missingIds.length === 0}
          >
            {busy ? t('model_setup.downloading') : t('model_setup.download_all', { count: missingIds.length })}
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
