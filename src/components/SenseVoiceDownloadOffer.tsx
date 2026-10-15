import { useCallback, useEffect, useState } from 'react'
import { SENSEVOICE_CATALOG_ID, shouldOfferSenseVoiceDownload } from '../features/voice/senseVoiceInstall.ts'
import { humanizeError } from '../lib/humanizeError.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types'

type SenseVoiceDownloadOfferProps = {
  uiLanguage: UiLanguage
  providerId: string
}

/**
 * In-app int8 download for local STT. Renders nothing until SenseVoice is
 * the selected provider and the catalog says it is not installed. Failures
 * stay in this panel; they do not affect startup.
 */
export function SenseVoiceDownloadOffer({ uiLanguage, providerId }: SenseVoiceDownloadOfferProps) {
  const ti = useCallback(
    (
      key: Parameters<typeof pickTranslatedUiText>[1],
      params?: Parameters<typeof pickTranslatedUiText>[2],
    ) => pickTranslatedUiText(uiLanguage, key, params),
    [uiLanguage],
  )
  const [present, setPresent] = useState<boolean | null>(null)
  const [sizeLabel, setSizeLabel] = useState('~239 MB')
  const [downloading, setDownloading] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const inventory = await window.desktopPet?.modelsGetInventory?.()
      const entry = inventory?.models.find((model) => model.id === SENSEVOICE_CATALOG_ID)
      if (!entry) {
        setPresent(false)
        return
      }
      setPresent(entry.present)
      if (entry.sizeLabel) setSizeLabel(entry.sizeLabel)
    } catch (err) {
      console.warn('[sensevoice] inventory failed:', err)
      setPresent(false)
    }
  }, [])

  useEffect(() => {
    if (!shouldOfferSenseVoiceDownload(providerId, false)) return undefined
    // Inventory arrives in the promise callback. The effect itself only
    // subscribes; it does not set state before that response.
    void window.desktopPet?.modelsGetInventory?.().then((inventory) => {
      const entry = inventory?.models.find((model) => model.id === SENSEVOICE_CATALOG_ID)
      if (!entry) {
        setPresent(false)
        return
      }
      setPresent(entry.present)
      if (entry.sizeLabel) setSizeLabel(entry.sizeLabel)
    }).catch(() => {
      setPresent(false)
    })
    const unsubscribe = window.desktopPet?.subscribeModelsProgress?.((event) => {
      if (event.modelId !== SENSEVOICE_CATALOG_ID) return
      if (event.phase === 'downloading' && event.total && event.total > 0) {
        setPercent(Math.floor(((event.downloaded ?? 0) / event.total) * 100))
      } else if (event.phase === 'installed' || event.phase === 'done') {
        setPercent(null)
        setError(null)
        void refresh()
      } else if (event.phase === 'error') {
        setError(event.message ? humanizeError(new Error(event.message), 'model') : ti('settings.speech_input.sensevoice_retry'))
      }
    })
    return () => unsubscribe?.()
  }, [providerId, refresh, ti])

  if (!shouldOfferSenseVoiceDownload(providerId, present === true) || present === null) return null

  const startDownload = () => {
    setDownloading(true)
    setError(null)
    setPercent(0)
    void window.desktopPet?.modelsDownload?.(SENSEVOICE_CATALOG_ID)
      .then((inventory) => {
        const entry = inventory?.models.find((model) => model.id === SENSEVOICE_CATALOG_ID)
        if (entry) setPresent(entry.present)
      })
      .catch((err) => {
        setError(humanizeError(err, 'model'))
      })
      .finally(() => {
        setDownloading(false)
        void refresh()
      })
  }

  return (
    <div className="onboarding-subsection" role="status" aria-atomic="true">
      <p className="onboarding-tip">{ti('settings.speech_input.sensevoice_not_installed', { size: sizeLabel })}</p>
      {percent !== null && downloading ? (
        <p className="onboarding-tip">{ti('settings.speech_input.sensevoice_downloading', { percent })}</p>
      ) : null}
      {error ? (
        <p className="settings-test-result is-error" role="alert" aria-live="assertive">{error}</p>
      ) : null}
      <button className="primary-button" type="button" onClick={startDownload} disabled={downloading}>
        {downloading
          ? ti('settings.speech_input.sensevoice_downloading', { percent: percent ?? 0 })
          : error
            ? ti('settings.speech_input.sensevoice_retry')
            : ti('settings.speech_input.sensevoice_download')}
      </button>
    </div>
  )
}
