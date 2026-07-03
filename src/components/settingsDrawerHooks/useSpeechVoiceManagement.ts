import { useEffect, useState } from 'react'
import {
  getAvailableSpeechSynthesisVoices,
  getFallbackSpeechOutputVoices,
} from '../../lib'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type {
  AppSettings,
  SpeechVoiceListResponse,
  SpeechVoiceOption,
} from '../../types'

export type UseSpeechVoiceManagementOptions = {
  draft: AppSettings
  settings: AppSettings
  open: boolean
  onLoadSpeechVoices: (settings: AppSettings) => Promise<SpeechVoiceListResponse>
  onPreviewSpeech: (settings: AppSettings, text: string) => Promise<{ message: string }>
  onRunAudioSmokeTest: (settings: AppSettings) => Promise<ConnectionResult>
}

export function useSpeechVoiceManagement({
  draft,
  settings,
  open,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunAudioSmokeTest,
}: UseSpeechVoiceManagementOptions) {
  const { t } = useTranslation()
  const [speechVoiceOptions, setSpeechVoiceOptions] = useState<SpeechVoiceOption[]>([])
  const [speechVoiceStatus, setSpeechVoiceStatus] = useState<ConnectionResult | null>(null)
  const [loadingSpeechVoices, setLoadingSpeechVoices] = useState(false)
  const [speechPreviewText, setSpeechPreviewText] = useState(() =>
    t('settings.voice.test_message', { companionName: settings.companionName }),
  )
  const [previewingSpeech, setPreviewingSpeech] = useState(false)
  const [speechPreviewStatus, setSpeechPreviewStatus] = useState<ConnectionResult | null>(null)
  const [runningAudioSmoke, setRunningAudioSmoke] = useState(false)
  const [audioSmokeStatus, setAudioSmokeStatus] = useState<ConnectionResult | null>(null)
  const [localVoices, setLocalVoices] = useState<
    Array<{
      id: string
      name: string
      lang: string
      localService: boolean
      default: boolean
    }>
  >([])

  const fallbackSpeechVoiceOptions = getFallbackSpeechOutputVoices(draft.speechOutputProviderId)

  // Sync fallback voice options when the external speech output provider changes
  useEffect(() => {
    setSpeechVoiceOptions(getFallbackSpeechOutputVoices(settings.speechOutputProviderId))
  }, [settings.speechOutputProviderId])

  // Fill voice options from fallbacks when the draft provider changes
  useEffect(() => {
    setSpeechVoiceOptions((current) => {
      if (!fallbackSpeechVoiceOptions.length) {
        return current
      }

      if (current.length) {
        return current
      }

      return fallbackSpeechVoiceOptions
    })
  }, [fallbackSpeechVoiceOptions])

  // Listen for browser speechSynthesis voice changes
  useEffect(() => {
    if (!open || !('speechSynthesis' in window)) return undefined

    const updateVoices = () => {
      setLocalVoices(getAvailableSpeechSynthesisVoices())
    }

    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
    }
  }, [open])

  async function handleLoadSpeechVoices(showStatus = true) {
    setLoadingSpeechVoices(true)

    try {
      const result = await onLoadSpeechVoices(draft)
      setSpeechVoiceOptions(result.voices.length ? result.voices : fallbackSpeechVoiceOptions)

      if (showStatus) {
        setSpeechVoiceStatus({
          ok: true,
          message: result.message,
        })
      }
    } catch (error) {
      setSpeechVoiceOptions(fallbackSpeechVoiceOptions)

      if (showStatus) {
        setSpeechVoiceStatus({
          ok: false,
          message: getRedactedLogErrorMessage(error) || t('settings.voice.fetch_voices_error'),
        })
      }
    } finally {
      setLoadingSpeechVoices(false)
    }
  }

  async function handlePreviewSpeech() {
    const previewText = speechPreviewText.trim()

    if (!previewText) {
      setSpeechPreviewStatus({
        ok: false,
        message: t('settings.voice.empty_preview_text'),
      })
      return
    }

    setPreviewingSpeech(true)
    setSpeechPreviewStatus(null)

    try {
      const result = await onPreviewSpeech(draft, previewText)
      setSpeechPreviewStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setSpeechPreviewStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.voice.preview_error'),
      })
    } finally {
      setPreviewingSpeech(false)
    }
  }

  async function handleRunAudioSmokeTest() {
    setRunningAudioSmoke(true)
    setAudioSmokeStatus(null)

    try {
      const result = await onRunAudioSmokeTest(draft)
      setAudioSmokeStatus(result)
    } catch (error) {
      setAudioSmokeStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.voice.audio_smoke_error'),
      })
    } finally {
      setRunningAudioSmoke(false)
    }
  }

  function applySpeechOutputPreset(providerId: string) {
    setSpeechVoiceOptions(getFallbackSpeechOutputVoices(providerId))
    setSpeechVoiceStatus(null)
  }

  function resetSpeechVoices() {
    setSpeechVoiceStatus(null)
    setLoadingSpeechVoices(false)
    setPreviewingSpeech(false)
    setSpeechPreviewStatus(null)
    setRunningAudioSmoke(false)
    setAudioSmokeStatus(null)
  }

  function syncPreviewText(companionName: string) {
    setSpeechPreviewText(t('settings.voice.test_message', { companionName }))
  }

  return {
    speechVoiceOptions,
    speechVoiceStatus,
    loadingSpeechVoices,
    speechPreviewText,
    setSpeechPreviewText,
    speechPreviewStatus,
    previewingSpeech,
    runningAudioSmoke,
    audioSmokeStatus,
    localVoices,
    handleLoadSpeechVoices,
    handlePreviewSpeech,
    handleRunAudioSmokeTest,
    applySpeechOutputPreset,
    resetSpeechVoices,
    syncPreviewText,
  }
}
