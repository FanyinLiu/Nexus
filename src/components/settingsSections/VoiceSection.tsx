import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  PlatformProfile,
  ServiceConnectionCapability,
  UiLanguage,
} from '../../types'
import {
  getPlatformDependencyHint,
  isVoiceContinuousAvailable,
  isVoiceSpeechInputAvailable,
  isVoiceSpeechOutputAvailable,
  isVoiceVadAvailable,
  isVoiceWakewordAvailable,
} from '../../lib/platformProfile'
import {
  getVoiceTriggerModeOptions,
  type ConnectionResult,
} from '../settingsDrawerSupport'

const CJK_CHAR_REGEX = /[\u3400-\u9fff]/
const ASCII_LETTER_REGEX = /[A-Za-z]/

function isWakeWordSupported(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  // Chinese: handled by pinyin-based keyword generation in main process.
  // English: handled by runtime BPE encoding via sherpa-onnx's bpeVocab path.
  return CJK_CHAR_REGEX.test(trimmed) || ASCII_LETTER_REGEX.test(trimmed)
}

type VoiceSectionProps = {
  active: boolean
  audioSmokeStatus: ConnectionResult | null
  draft: AppSettings
  onRunAudioSmokeTest: () => void
  previewingSpeech: boolean
  runningAudioSmoke: boolean
  setDraft: Dispatch<SetStateAction<AppSettings>>
  platformProfile: PlatformProfile
  testingTarget: ServiceConnectionCapability | null
  uiLanguage: UiLanguage
}

export const VoiceSection = memo(function VoiceSection({
  active,
  audioSmokeStatus,
  draft,
  onRunAudioSmokeTest,
  previewingSpeech,
  runningAudioSmoke,
  setDraft,
  platformProfile,
  testingTarget,
  uiLanguage,
}: VoiceSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const tiParam = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const formatPlatformHint = (reason: string | null) => {
    if (!reason) return null
    if (reason === 'unsupported') return ti('settings.platform.unsupported')
    if (reason === 'unavailable') return ti('settings.platform.unavailable')
    return tiParam('settings.platform.unavailable_dependency', { dependency: reason })
  }
  const speechInputAvailable = isVoiceSpeechInputAvailable(platformProfile)
  const speechOutputAvailable = isVoiceSpeechOutputAvailable(platformProfile)
  const continuousVoiceAvailable = isVoiceContinuousAvailable(platformProfile)
  const vadAvailable = isVoiceVadAvailable(platformProfile)
  const wakewordAvailable = isVoiceWakewordAvailable(platformProfile)
  const voicePlatformHint = formatPlatformHint(getPlatformDependencyHint(
    platformProfile,
    platformProfile.voice.speechInputSupported || platformProfile.voice.speechOutputSupported,
    platformProfile.voice.speechInputAvailable || platformProfile.voice.speechOutputAvailable,
    platformProfile.voice.dependencyHint,
  ))
  const voiceTriggerModeOptions = getVoiceTriggerModeOptions(uiLanguage)
  const selectedVoiceTriggerMode = voiceTriggerModeOptions.find((option) => option.value === draft.voiceTriggerMode)
    ?? voiceTriggerModeOptions[0]

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.voice.title')}</h4>
          <p className="settings-drawer__hint">{ti('settings.voice.note')}</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunAudioSmokeTest}
          disabled={runningAudioSmoke || previewingSpeech || testingTarget !== null || !speechOutputAvailable}
        >
          {runningAudioSmoke ? ti('settings.voice.checking') : ti('settings.voice.audio_smoke_test')}
        </button>
      </div>

      {voicePlatformHint ? (
        <p className="settings-drawer__hint">{voicePlatformHint}</p>
      ) : null}

      {audioSmokeStatus ? (
        <div className={audioSmokeStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {audioSmokeStatus.message}
        </div>
      ) : null}

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_input')}</span>
        <input
          type="checkbox"
          checked={draft.speechInputEnabled}
          disabled={!speechInputAvailable}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, speechInputEnabled: event.target.checked }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_output')}</span>
        <input
          type="checkbox"
          checked={draft.speechOutputEnabled}
          disabled={!speechOutputAvailable}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, speechOutputEnabled: event.target.checked }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_continuous')}</span>
        <input
          type="checkbox"
          checked={draft.continuousVoiceModeEnabled}
          disabled={!continuousVoiceAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              continuousVoiceModeEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_vad')}</span>
        <input
          type="checkbox"
          checked={draft.voiceActivityDetectionEnabled}
          disabled={!vadAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              voiceActivityDetectionEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {draft.voiceActivityDetectionEnabled && (
        <label>
          <span>{ti('settings.voice.vad_sensitivity')}</span>
          <select
            value={draft.vadSensitivity}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                vadSensitivity: event.target.value as AppSettings['vadSensitivity'],
              }))
            }
          >
            <option value="low">{ti('settings.voice.vad.low')}</option>
            <option value="medium">{ti('settings.voice.vad.medium')}</option>
            <option value="high">{ti('settings.voice.vad.high')}</option>
          </select>
        </label>
      )}

      <label className="settings-toggle">
        <span>{ti('settings.voice.allow_interruption')}</span>
        <input
          type="checkbox"
          checked={draft.voiceInterruptionEnabled}
          disabled={!speechInputAvailable || !speechOutputAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              voiceInterruptionEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">{ti('settings.voice.interrupt_hint')}</p>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_stt_failover')}</span>
        <input
          type="checkbox"
          checked={draft.speechInputFailoverEnabled}
          disabled={!speechInputAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechInputFailoverEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_tts_failover')}</span>
        <input
          type="checkbox"
          checked={draft.speechOutputFailoverEnabled}
          disabled={!speechOutputAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechOutputFailoverEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.voice.always_on_wakeword')}</span>
        <input
          type="checkbox"
          checked={draft.wakewordAlwaysOn}
          disabled={!wakewordAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              wakewordAlwaysOn: event.target.checked,
            }))
          }
        />
      </label>
      <p className="settings-drawer__hint">{ti('settings.voice.always_on_wakeword_hint')}</p>

      <label>
        <span>{ti('settings.voice.session_idle_timeout')}</span>
        <input
          type="number"
          min={3}
          max={120}
          step={1}
          value={Math.round(draft.wakewordSessionIdleTimeoutMs / 1000)}
          disabled={!wakewordAvailable}
          onChange={(event) => {
            const seconds = Number(event.target.value)
            if (!Number.isFinite(seconds)) return
            const clamped = Math.max(3, Math.min(120, Math.round(seconds)))
            setDraft((prev) => ({
              ...prev,
              wakewordSessionIdleTimeoutMs: clamped * 1000,
            }))
          }}
        />
      </label>
      <p className="settings-drawer__hint">{ti('settings.voice.session_idle_timeout_hint')}</p>

      <label>
        <span>{ti('settings.voice.trigger_mode')}</span>
        <select
          value={draft.voiceTriggerMode}
          disabled={!wakewordAvailable}
          onChange={(event) => {
            const nextMode = event.target.value as AppSettings['voiceTriggerMode']
            setDraft((prev) => ({
              ...prev,
              voiceTriggerMode: nextMode,
              wakeWordEnabled: nextMode === 'wake_word',
            }))
          }}
        >
          {voiceTriggerModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>{ti('settings.voice.wake_word')}</span>
        <input
          value={draft.wakeWord}
          placeholder={ti('settings.voice.wake_word_placeholder')}
          disabled={!wakewordAvailable}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              wakeWord: event.target.value,
            }))
          }
        />
      </label>

      {draft.voiceTriggerMode === 'wake_word' && !isWakeWordSupported(draft.wakeWord) ? (
        <div
          className="settings-test-result is-error"
          style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
        >
          {ti('settings.voice.wake_word_chinese_only')}
        </div>
      ) : null}

      <p className="settings-drawer__hint">
        {selectedVoiceTriggerMode.hint.trim()}
        {draft.voiceTriggerMode === 'wake_word'
          ? ti('settings.voice.wake_word_note_suffix')
          : ''}
      </p>


      <p className="settings-drawer__hint">
        {draft.voiceActivityDetectionEnabled
          ? ti('settings.voice.vad_enabled_note')
          : ti('settings.voice.vad_legacy_note')}
      </p>

    </section>
  )
})
