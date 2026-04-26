import { useCallback, useEffect, useState } from 'react'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import { humanizeError } from '../../../../lib/humanizeError'
import type { UiLanguage } from '../../../../types'

// Mirror the bridge-side types locally. `ModelInventory` + co. are
// declared in src/vite-env.d.ts at module scope so `declare global` can
// reference them, but they're not exported. Inlining here keeps this
// component self-contained without forcing a types refactor.
type ModelCatalogEntryLike = {
  id: string
  label: string
  sizeLabel: string
  required: boolean
  present: boolean
}
type ModelInventoryLike = {
  models: ModelCatalogEntryLike[]
  ready: boolean
  missingRequired: string[]
}

/**
 * Onboarding inline panel that surfaces the state of the local sherpa
 * voice models (wake-word cn/en, SenseVoice offline STT, Silero VAD).
 *
 * Bundled installers (Windows NSIS, Mac dmg/zip, Linux AppImage/deb) now
 * ship these models via electron-builder's extraResources, so on a fresh
 * install `inventory.ready` should be true and the strip stays as a
 * single-line confirmation. The download CTA is the fallback path for:
 *   - Upgrades from a build that pre-dates the Mac/Linux bundling
 *   - Manual sideloads / sandbox wipes
 *   - CI builds deliberately produced without models (none right now,
 *     but this keeps the UI honest if that ever changes)
 *
 * Silently hides when the Electron bridge isn't attached (dev vite
 * server, Storybook, tests) — the step works identically without this
 * block, it's purely diagnostic.
 */
type LocalVoiceModelsStatusProps = {
  uiLanguage: UiLanguage
}

export function LocalVoiceModelsStatus({ uiLanguage }: LocalVoiceModelsStatusProps) {
  const ti = useCallback(
    (
      key: Parameters<typeof pickTranslatedUiText>[1],
      params?: Parameters<typeof pickTranslatedUiText>[2],
    ) => pickTranslatedUiText(uiLanguage, key, params),
    [uiLanguage],
  )
  const [inventory, setInventory] = useState<ModelInventoryLike | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progressText, setProgressText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshInventory = useCallback(async () => {
    try {
      const next = await window.desktopPet?.modelsGetInventory?.()
      if (next) setInventory(next)
    } catch (err) {
      console.warn('[onboarding] modelsGetInventory failed:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshInventory()

    const unsubscribe = window.desktopPet?.subscribeModelsProgress?.((event) => {
      if (event.phase === 'downloading' && event.total && event.total > 0) {
        const percent = Math.floor(((event.downloaded ?? 0) / event.total) * 100)
        const file = event.fileName ?? event.modelId
        setProgressText(`${file} ${percent}%`)
      } else if (event.phase === 'installed' || event.phase === 'done') {
        setProgressText(null)
        void refreshInventory()
      } else if (event.phase === 'error') {
        setError(event.message ?? ti('onboarding.local_voice_models.download_failed'))
      }
    })
    return () => unsubscribe?.()
  }, [refreshInventory, ti])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    setError(null)
    try {
      const result = await window.desktopPet?.modelsDownloadMissing?.()
      if (result?.inventory) setInventory(result.inventory)
      const failures = result?.results.filter((r) => !r.ok) ?? []
      if (failures.length) {
        setError(ti('onboarding.local_voice_models.partial_failure', { ids: failures.map((f) => f.id).join('、') }))
      }
    } catch (err) {
      setError(humanizeError(err, 'model'))
    } finally {
      setDownloading(false)
      setProgressText(null)
      void refreshInventory()
    }
  }, [refreshInventory, ti])

  // Bridge unavailable or pre-mount: render nothing so the step layout
  // doesn't get a phantom placeholder.
  if (!loaded || !inventory) {
    return null
  }

  const requiredModels = inventory.models.filter((m) => m.required)
  const missing = requiredModels.filter((m) => !m.present)

  if (missing.length === 0) {
    return (
      <p className="onboarding-tip">
        {ti('onboarding.local_voice_models.ready', { count: requiredModels.length })}
      </p>
    )
  }

  return (
    <div className="onboarding-subsection">
      <strong>{ti('onboarding.local_voice_models.missing_heading')}</strong>
      <p className="onboarding-tip">
        {ti('onboarding.local_voice_models.missing_note', { count: missing.length })}
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.7)' }}>
        {missing.map((m) => (
          <li key={m.id}>
            {m.label}
            <span style={{ color: 'rgba(255,255,255,0.4)' }}> · {m.sizeLabel}</span>
          </li>
        ))}
      </ul>
      {progressText ? (
        <p className="onboarding-tip">{ti('onboarding.local_voice_models.downloading_prefix', { detail: progressText })}</p>
      ) : null}
      {error ? <p className="settings-test-result is-error">{error}</p> : null}
      <button
        className="primary-button"
        type="button"
        onClick={() => void handleDownload()}
        disabled={downloading}
      >
        {downloading
          ? ti('onboarding.local_voice_models.downloading_button')
          : ti('onboarding.local_voice_models.download_button', { count: missing.length })}
      </button>
    </div>
  )
}
