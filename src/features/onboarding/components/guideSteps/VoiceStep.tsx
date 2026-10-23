import { useEffect, useState } from 'react'
import {
  buildVoiceModelReadiness,
  type VoiceModelInventory,
} from '../../voiceModelReadiness.ts'
import { humanizeIfSpeechIpcError } from '../../../../lib/humanizeError.ts'
import { getRedactedLogErrorMessage } from '../../../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage.ts'
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
  const [inventory, setInventory] = useState<VoiceModelInventory | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadInventory = window.desktopPet?.modelsGetInventory
    if (!loadInventory) return undefined

    void Promise.resolve(loadInventory()).then((next) => {
      if (cancelled) return
      setInventory(next ?? null)
    }).catch((error) => {
      console.warn('[onboarding] voice model inventory failed:', getRedactedLogErrorMessage(error))
      if (cancelled) return
      setInventory(null)
    })

    return () => { cancelled = true }
  }, [])

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

  const readiness = buildVoiceModelReadiness({
    inventory,
    speechInputProviderId: draft.speechInputProviderId,
    speechOutputProviderId: draft.speechOutputProviderId,
  })
  const tipKey = readiness.status === 'models_missing'
    ? 'onboarding.voice.needs_models'
    : readiness.messageKey

  return (
    <div className="onboarding-grid onboarding-grid--stack">
      {tipKey ? (
        <p className="onboarding-tip">{ti(tipKey)}</p>
      ) : null}
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
