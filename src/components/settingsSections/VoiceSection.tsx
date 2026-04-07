import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { clampPresenceIntervalMinutes } from '../../lib/settings'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  ServiceConnectionCapability,
  UiLanguage,
} from '../../types'
import {
  getVoiceTriggerModeOptions,
  parseNumberInput,
  type ConnectionResult,
} from '../settingsDrawerSupport'

type VoiceSectionProps = {
  active: boolean
  audioSmokeStatus: ConnectionResult | null
  draft: AppSettings
  onRunAudioSmokeTest: () => void
  previewingSpeech: boolean
  runningAudioSmoke: boolean
  setDraft: Dispatch<SetStateAction<AppSettings>>
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
  testingTarget,
  uiLanguage,
}: VoiceSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
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
          disabled={runningAudioSmoke || previewingSpeech || testingTarget !== null}
        >
          {runningAudioSmoke ? ti('settings.voice.checking') : ti('settings.voice.audio_smoke_test')}
        </button>
      </div>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_input')}</span>
        <input
          type="checkbox"
          checked={draft.speechInputEnabled}
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
          disabled
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              voiceInterruptionEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">
        {ti('settings.voice.note')}
        {' '}
        {uiLanguage === 'zh-CN'
          ? '当前版本暂未启用语音打断，避免误把播报声音识别成用户输入。'
          : uiLanguage === 'zh-TW'
            ? '目前版本暫未啟用語音打斷，避免把播報聲音誤判成使用者輸入。'
            : 'Speech interruption is temporarily unavailable to avoid false interrupts caused by TTS audio bleeding back into the microphone.'}
      </p>

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_stt_failover')}</span>
        <input
          type="checkbox"
          checked={draft.speechInputFailoverEnabled}
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
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechOutputFailoverEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label>
        <span>{ti('settings.voice.trigger_mode')}</span>
        <select
          value={draft.voiceTriggerMode}
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
          disabled={draft.voiceTriggerMode !== 'wake_word'}
          placeholder={ti('settings.voice.wake_word_placeholder')}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              wakeWord: event.target.value,
            }))
          }
        />
      </label>

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

      <label className="settings-toggle">
        <span>{ti('settings.voice.enable_presence')}</span>
        <input
          type="checkbox"
          checked={draft.proactivePresenceEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              proactivePresenceEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {audioSmokeStatus ? (
        <div className={audioSmokeStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {audioSmokeStatus.message}
        </div>
      ) : null}

      <label>
        <span>{ti('settings.voice.presence_interval')}</span>
        <input
          type="number"
          min="5"
          max="120"
          step="1"
          value={draft.proactivePresenceIntervalMinutes}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
                parseNumberInput(event.target.value, prev.proactivePresenceIntervalMinutes),
              ),
            }))
          }
        />
      </label>
    </section>
  )
})
