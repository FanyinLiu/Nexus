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
import { isWakeWordSupported } from '../../features/voice/providerSettings.ts'
import { getDirectSendFallbackWakeWord } from '../../features/hearing/companionWakeWordSync.ts'
import { SettingsStatusMessage, SettingsToggle } from '../settingsFields'

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
    <section className={`settings-section settings-voice-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-mini-group settings-voice-loop-card">
        <div className="settings-mini-group__head settings-voice-loop-head">
          <div>
            <h5>{ti('settings.voice.loop_title')}</h5>
            <span>{ti('settings.voice.loop_hint')}</span>
          </div>
          <button
            type="button"
            className="ghost-button settings-voice-smoke-button"
            onClick={onRunAudioSmokeTest}
            disabled={runningAudioSmoke || previewingSpeech || testingTarget !== null || !speechOutputAvailable}
          >
            {runningAudioSmoke ? ti('settings.voice.checking') : ti('settings.voice.audio_smoke_test')}
          </button>
        </div>

        {voicePlatformHint ? (
          <p className="settings-mini-group__note settings-voice-note">{voicePlatformHint}</p>
        ) : null}

        {audioSmokeStatus ? (
          <SettingsStatusMessage ok={audioSmokeStatus.ok}>
            {audioSmokeStatus.message}
          </SettingsStatusMessage>
        ) : null}

        <div className="settings-control-grid settings-voice-control-grid">
          <div className="settings-control-card settings-voice-control">
            <SettingsToggle
              label={ti('settings.voice.enable_input')}
              checked={draft.speechInputEnabled}
              disabled={!speechInputAvailable}
              onChange={(checked) => setDraft((prev) => ({ ...prev, speechInputEnabled: checked }))}
            />
            <p>{speechInputAvailable ? ti('settings.voice.status_input_ready') : ti('settings.voice.status_input_unavailable')}</p>
          </div>

          <div className="settings-control-card settings-voice-control">
            <SettingsToggle
              label={ti('settings.voice.enable_output')}
              checked={draft.speechOutputEnabled}
              disabled={!speechOutputAvailable}
              onChange={(checked) => setDraft((prev) => ({ ...prev, speechOutputEnabled: checked }))}
            />
            <p>{speechOutputAvailable ? ti('settings.voice.status_output_ready') : ti('settings.voice.status_output_unavailable')}</p>
          </div>

          <div className="settings-control-card settings-voice-control">
            <SettingsToggle
              label={ti('settings.voice.enable_continuous')}
              checked={draft.continuousVoiceModeEnabled}
              disabled={!continuousVoiceAvailable}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, continuousVoiceModeEnabled: checked }))}
            />
            <p>{draft.continuousVoiceModeEnabled ? ti('settings.voice.status_continuous_on') : ti('settings.voice.status_continuous_off')}</p>
          </div>

          <div className="settings-control-card settings-voice-control">
            <SettingsToggle
              label={ti('settings.voice.enable_vad')}
              checked={draft.voiceActivityDetectionEnabled}
              disabled={!vadAvailable}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, voiceActivityDetectionEnabled: checked }))}
            />
            <p>{draft.voiceActivityDetectionEnabled ? ti('settings.voice.status_on') : ti('settings.voice.status_off')}</p>
          </div>
        </div>

        {draft.voiceActivityDetectionEnabled && (
          <label className="settings-control-card settings-voice-field">
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
      </div>

      <details className="settings-mini-group settings-voice-advanced-card">
        <summary className="settings-mini-group__head">
          <div>
            <h5>{ti('settings.voice.advanced_title')}</h5>
            <span>{ti('settings.voice.advanced_hint')}</span>
          </div>
        </summary>

        <div className="settings-voice-advanced-body">
          <div className="settings-control-card settings-voice-advanced-control">
            <SettingsToggle
              label={ti('settings.voice.allow_interruption')}
              checked={draft.voiceInterruptionEnabled}
              disabled={!speechInputAvailable || !speechOutputAvailable}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, voiceInterruptionEnabled: checked }))}
            />
            <p>{ti('settings.voice.interrupt_hint')}</p>
          </div>

          <div className="settings-control-card settings-voice-advanced-control">
            <SettingsToggle
              label={ti('settings.voice.enable_stt_failover')}
              checked={draft.speechInputFailoverEnabled}
              disabled={!speechInputAvailable}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, speechInputFailoverEnabled: checked }))}
            />
          </div>

          <div className="settings-control-card settings-voice-advanced-control">
            <SettingsToggle
              label={ti('settings.voice.enable_tts_failover')}
              checked={draft.speechOutputFailoverEnabled}
              disabled={!speechOutputAvailable}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, speechOutputFailoverEnabled: checked }))}
            />
          </div>

          <div className="settings-control-card settings-voice-advanced-control">
            <SettingsToggle
              label={ti('settings.voice.always_on_wakeword')}
              checked={draft.wakewordAlwaysOn}
              disabled={!wakewordAvailable}
              onChange={(checked) => setDraft((prev) => ({ ...prev, wakewordAlwaysOn: checked }))}
            />
            <p>{ti('settings.voice.always_on_wakeword_hint')}</p>
          </div>

          <label className="settings-control-card settings-voice-field">
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
            <small>{ti('settings.voice.session_idle_timeout_hint')}</small>
          </label>

          <label className="settings-control-card settings-voice-field">
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
                  ...(nextMode === 'wake_word' && !prev.wakeWord.trim()
                    ? { wakeWord: getDirectSendFallbackWakeWord(prev) }
                    : {}),
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

          <label className="settings-control-card settings-voice-field">
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
              className="settings-test-result settings-test-result--compact is-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {ti('settings.voice.wake_word_chinese_only')}
            </div>
          ) : null}

          <p className="settings-mini-group__note settings-voice-note">
            {selectedVoiceTriggerMode.hint.trim()}
            {draft.voiceTriggerMode === 'wake_word'
              ? ti('settings.voice.wake_word_note_suffix')
              : ''}
          </p>
        </div>
      </details>

    </section>
  )
})
