import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '../../lib/logger.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { AppSettings, UiLanguage } from '../../types'
import type { DesktopPetBridgeMethodResults } from '../../types/generated/desktopPetBridge.generated.ts'
import {
  OWNER_VOICE_RECORD_SECONDS,
  recordOwnerVoiceSample,
  type OwnerVoiceRecording,
} from '../voice/ownerVoiceEnrollment.ts'
import {
  SettingsV3Notice,
  SettingsV3Row,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives.tsx'

type OwnerVoiceStatus = DesktopPetBridgeMethodResults['ownerVoiceStatus']
type EnrollReason = DesktopPetBridgeMethodResults['ownerVoiceEnroll']['reason']

const MODEL_ID = 'voxlock'
const log = createLogger('settings.owner-voice')

type OwnerVoiceLockV3Props = {
  uiLanguage: UiLanguage
  enabled: boolean
  disabled: boolean
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

function enrollErrorKey(reason: EnrollReason) {
  switch (reason) {
    case 'too_short':
    case 'too_quiet':
      return 'settings.voice.owner_lock_error_too_quiet' as const
    case 'unsupported':
      return 'settings.voice.owner_lock_unsupported' as const
    default:
      return 'settings.voice.owner_lock_error_failed' as const
  }
}

/**
 * "Only hear me": record the owner's voice once, then VAD, local recognition
 * and barge-in ignore every other voice. Lives under the interruption switch
 * on the Voice page because that is where the TV problem shows up.
 */
export function OwnerVoiceLockV3({ uiLanguage, enabled, disabled, setSetting }: OwnerVoiceLockV3Props) {
  const ti = useCallback(
    (
      key: Parameters<typeof pickTranslatedUiText>[1],
      params?: Parameters<typeof pickTranslatedUiText>[2],
    ) => pickTranslatedUiText(uiLanguage, key, params),
    [uiLanguage],
  )
  const [status, setStatus] = useState<OwnerVoiceStatus | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recordingRef = useRef<OwnerVoiceRecording | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus((await window.desktopPet?.ownerVoiceStatus?.()) ?? null)
    } catch (err) {
      log.warn('ownerVoiceStatus failed:', { errorPresent: Boolean(err) })
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadStatus = window.desktopPet?.ownerVoiceStatus
    void Promise.resolve(loadStatus ? loadStatus() : null).then((next) => {
      if (!cancelled) setStatus(next ?? null)
    }).catch((err) => {
      log.warn('ownerVoiceStatus failed:', { errorPresent: Boolean(err) })
      if (!cancelled) setStatus(null)
    })
    return () => {
      cancelled = true
      recordingRef.current?.stop()
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const recording = await recordOwnerVoiceSample((seconds) => setRecordingSeconds(seconds))
      recordingRef.current = recording
      setRecordingSeconds(0)
      const samples = await recording.done
      recordingRef.current = null
      setRecordingSeconds(null)
      const result = await window.desktopPet?.ownerVoiceEnroll?.({ samples })
      if (!result?.ok) setError(ti(enrollErrorKey(result?.reason ?? null)))
    } catch (err) {
      log.warn('owner voice recording failed:', { errorPresent: Boolean(err) })
      recordingRef.current = null
      setRecordingSeconds(null)
      setError(ti('settings.voice.owner_lock_error_failed'))
    }
    await refresh()
  }, [refresh, ti])

  const clearSample = useCallback(async () => {
    setError(null)
    try {
      setStatus((await window.desktopPet?.ownerVoiceClear?.()) ?? null)
    } catch (err) {
      log.warn('ownerVoiceClear failed:', { errorPresent: Boolean(err) })
      setError(ti('settings.voice.owner_lock_error_failed'))
    }
  }, [ti])

  const downloadModel = useCallback(async () => {
    setError(null)
    setDownloading(true)
    try {
      await window.desktopPet?.modelsDownload?.(MODEL_ID)
    } catch (err) {
      log.warn('owner voice model download failed:', { errorPresent: Boolean(err) })
      setError(ti('settings.voice.owner_lock_error_failed'))
    } finally {
      setDownloading(false)
      await refresh()
    }
  }, [refresh, ti])

  const recording = recordingSeconds !== null
  const supported = status?.supported !== false
  const enrolledAt = status?.enrolledAt ? new Date(status.enrolledAt).toLocaleDateString(uiLanguage) : null
  const statusLine = !status
    ? null
    : !supported
      ? ti('settings.voice.owner_lock_unsupported')
      : !status.modelInstalled
        ? ti('settings.voice.owner_lock_model_missing')
        : status.enrolled
          ? ti('settings.voice.owner_lock_enrolled', { date: enrolledAt ?? '' })
          : ti('settings.voice.owner_lock_not_enrolled')

  return (
    <>
      <SettingsV3Row label={ti('settings.voice.owner_lock')} hint={ti('settings.voice.owner_lock_hint')}>
        <SettingsV3Switch
          label={ti('settings.voice.owner_lock')}
          checked={enabled}
          disabled={disabled || !supported}
          onChange={(value) => setSetting('ownerVoiceLockEnabled', value)}
        />
      </SettingsV3Row>
      {enabled ? (
        <div className="settings-v3-editor">
          {statusLine ? (
            <SettingsV3Notice
              tone={status?.active ? 'success' : 'info'}
              title={statusLine}
              announce
            >
              {status?.lastError ? ti('settings.voice.owner_lock_runtime_failed') : undefined}
            </SettingsV3Notice>
          ) : null}
          {recording ? (
            <SettingsV3Notice
              tone="info"
              title={ti('settings.voice.owner_lock_recording', {
                seconds: Math.max(0, Math.ceil(OWNER_VOICE_RECORD_SECONDS - (recordingSeconds ?? 0))),
              })}
              announce
            >
              {ti('settings.voice.owner_lock_prompt')}
            </SettingsV3Notice>
          ) : null}
          {error ? <SettingsV3Notice tone="error" title={error} /> : null}
          <SettingsV3Toolbar>
            {status && supported && !status.modelInstalled ? (
              <button type="button" disabled={downloading} onClick={() => void downloadModel()}>
                {ti('settings.voice.owner_lock_download')}
              </button>
            ) : null}
            {status?.modelInstalled && !recording ? (
              <button type="button" onClick={() => void startRecording()}>
                {status.enrolled ? ti('settings.voice.owner_lock_rerecord') : ti('settings.voice.owner_lock_record')}
              </button>
            ) : null}
            {recording ? (
              <button type="button" onClick={() => recordingRef.current?.stop()}>
                {ti('settings.voice.owner_lock_stop')}
              </button>
            ) : null}
            {status?.enrolled && !recording ? (
              <button type="button" onClick={() => void clearSample()}>
                {ti('settings.voice.owner_lock_delete')}
              </button>
            ) : null}
          </SettingsV3Toolbar>
        </div>
      ) : null}
    </>
  )
}
