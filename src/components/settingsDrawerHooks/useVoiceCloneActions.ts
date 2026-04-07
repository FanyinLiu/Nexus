import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  isVoiceCloneDisabled,
  switchSpeechOutputProvider,
  updateCurrentSpeechOutputProviderProfile,
} from '../../lib'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type { AppSettings } from '../../types'
import type { CloneVoicePayload } from '../SettingsDrawer'

export type UseVoiceCloneActionsOptions = {
  draft: AppSettings
  settings: AppSettings
  onCloneVoice: (payload: CloneVoicePayload) => Promise<{
    voiceId: string
    message: string
  }>
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export function useVoiceCloneActions({
  draft,
  settings,
  onCloneVoice,
  setDraft,
}: UseVoiceCloneActionsOptions) {
  const [cloneFiles, setCloneFiles] = useState<File[]>([])
  const [cloneName, setCloneName] = useState(`${settings.companionName} 音色`)
  const [cloneDescription, setCloneDescription] = useState('')
  const [removeBackgroundNoise, setRemoveBackgroundNoise] = useState(true)
  const [cloningVoice, setCloningVoice] = useState(false)
  const [cloneStatus, setCloneStatus] = useState<ConnectionResult | null>(null)

  async function handleCloneVoice() {
    if (isVoiceCloneDisabled(draft.voiceCloneProviderId)) {
      setCloneStatus({
        ok: false,
        message: '当前没有启用语音克隆服务。',
      })
      return
    }

    if (!cloneFiles.length) {
      setCloneStatus({
        ok: false,
        message: '请至少选择一段语音样本文件。',
      })
      return
    }

    setCloningVoice(true)
    setCloneStatus(null)

    try {
      const result = await onCloneVoice({
        settings: draft,
        name: cloneName.trim() || `${draft.companionName} 音色`,
        description: cloneDescription,
        files: cloneFiles,
        removeBackgroundNoise,
      })

      setDraft((prev) => updateCurrentSpeechOutputProviderProfile(
        {
          ...switchSpeechOutputProvider(
            {
              ...prev,
              clonedVoiceId: result.voiceId,
            },
            'elevenlabs-tts',
          ),
          clonedVoiceId: result.voiceId,
        },
        {
          apiBaseUrl: prev.voiceCloneApiBaseUrl || prev.speechOutputApiBaseUrl,
          apiKey: prev.voiceCloneApiKey || prev.speechOutputApiKey,
          voice: result.voiceId,
        },
      ))
      setCloneFiles([])
      setCloneStatus({
        ok: true,
        message: result.message + ' 已自动写入克隆音色 ID，并切换到 ElevenLabs 播报。',
      })
    } catch (error) {
      setCloneStatus({
        ok: false,
        message: error instanceof Error ? error.message : '语音克隆失败，请稍后再试。',
      })
    } finally {
      setCloningVoice(false)
    }
  }

  function resetVoiceClone() {
    setCloneFiles([])
    setCloneDescription('')
    setRemoveBackgroundNoise(true)
    setCloneStatus(null)
    setCloningVoice(false)
  }

  function syncCloneName(companionName: string) {
    setCloneName(`${companionName} 音色`)
  }

  return {
    cloneFiles,
    setCloneFiles,
    cloneName,
    setCloneName,
    cloneDescription,
    setCloneDescription,
    removeBackgroundNoise,
    setRemoveBackgroundNoise,
    cloningVoice,
    cloneStatus,
    handleCloneVoice,
    resetVoiceClone,
    syncCloneName,
  }
}
