import { useState } from 'react'
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
      <p className="onboarding-tip">{ti('onboarding.voice.ready')}</p>
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
