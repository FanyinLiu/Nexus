import { useEffect, useState } from 'react'
import { humanizeIfSpeechIpcError } from '../../../../lib/humanizeError.ts'
import { getRedactedLogErrorMessage } from '../../../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage.ts'
import { missingVoiceModelIds } from '../../../setup/localModelRepair.ts'
import type { AppSettings } from '../../../../types'

type VoiceStepProps = {
  draft: AppSettings
  onPreviewSpeech?: (settings: AppSettings, text: string) => Promise<{ message: string }>
}

export function VoiceStep({ draft, onPreviewSpeech }: VoiceStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [modelsReady, setModelsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = window.desktopPet?.modelsGetInventory
    void Promise.resolve(load ? load() : null).then((inventory) => {
      if (cancelled) return
      const ready = Boolean(
        inventory && missingVoiceModelIds(inventory.models, draft.speechInputProviderId).length === 0,
      )
      setModelsReady(ready)
    }).catch(() => {
      if (!cancelled) setModelsReady(false)
    })
    return () => { cancelled = true }
  }, [draft.speechInputProviderId])

  async function preview() {
    if (!onPreviewSpeech || previewing) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      await onPreviewSpeech(
        { ...draft, speechOutputEnabled: true },
        ti('onboarding.voice.preview_sample'),
      )
    } catch (error) {
      console.error('[onboarding] voice preview failed:', getRedactedLogErrorMessage(error))
      setPreviewError(humanizeIfSpeechIpcError(error, 'tts') || ti('settings.voice.preview_error'))
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <p className="onboarding-tip">
        {ti(modelsReady ? 'onboarding.voice.ready' : 'onboarding.voice.needs_models')}
      </p>
      <div className="onboarding-test-connection">
        <button
          type="button"
          className="ghost-button"
          disabled={previewing || !onPreviewSpeech}
          onClick={() => { void preview() }}
        >
          {previewing ? ti('onboarding.voice.previewing') : ti('onboarding.voice.preview')}
        </button>
      </div>
      {previewError ? (
        <p className="onboarding-tip onboarding-tip--strong" role="alert">{previewError}</p>
      ) : null}
    </div>
  )
}
