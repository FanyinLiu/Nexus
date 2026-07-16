import { memo, type Dispatch, type SetStateAction } from 'react'
import {
  getVoiceTriggerModeOptions,
  type ConnectionResult,
} from '../../components/settingsDrawerSupport'
import { getDirectSendFallbackWakeWord } from '../hearing/companionWakeWordSync'
import { isWakeWordSupported } from '../voice/providerSettings'
import {
  getPlatformDependencyHint,
  isVoiceContinuousAvailable,
  isVoiceSpeechInputAvailable,
  isVoiceSpeechOutputAvailable,
  isVoiceVadAvailable,
  isVoiceWakewordAvailable,
} from '../../lib/platformProfile'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  PlatformProfile,
  ServiceConnectionCapability,
  SpeechVoiceOption,
  UiLanguage,
  VoiceState,
} from '../../types'
import {
  SettingsV3Disclosure,
  type SettingsV3ConnectionEvidenceValue,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'
import { SpeechInputProviderV3 } from './SpeechInputProviderV3'
import { SpeechOutputProviderV3 } from './SpeechOutputProviderV3'
import './voice-section-v3.css'

export type VoiceSectionV3Props = {
  active: boolean
  audioSmokeStatus: ConnectionResult | null
  draft: AppSettings
  dirty: boolean
  continuousVoiceActive: boolean
  loadingSpeechVoices: boolean
  onApplySpeechOutputPreset: (providerId: string) => void
  onLoadSpeechVoices: () => void
  onPreviewSpeech: () => void
  onRunAudioSmokeTest: () => void
  onRunSpeechInputConnectionTest: () => void
  onRunSpeechOutputConnectionTest: () => void
  onStartVoiceConversation: () => Promise<void>
  onStopVoiceConversation: () => void
  onCancelVoiceTurn: () => void
  platformProfile: PlatformProfile
  previewingSpeech: boolean
  speechInputEvidence: SettingsV3ConnectionEvidenceValue | null
  speechOutputEvidence: SettingsV3ConnectionEvidenceValue | null
  runningAudioSmoke: boolean
  saveError: boolean
  saving: boolean
  setDraft: Dispatch<SetStateAction<AppSettings>>
  setSpeechPreviewText: Dispatch<SetStateAction<string>>
  speechPreviewStatus: ConnectionResult | null
  speechPreviewText: string
  speechVoiceOptions: SpeechVoiceOption[]
  speechVoiceStatus: ConnectionResult | null
  testingInputTarget: ServiceConnectionCapability | null
  testingOutputTarget: ServiceConnectionCapability | null
  uiLanguage: UiLanguage
  voiceActionPending: boolean
  voiceState: VoiceState
}

export const VoiceSectionV3 = memo(function VoiceSectionV3({
  active,
  audioSmokeStatus,
  draft,
  dirty,
  continuousVoiceActive,
  loadingSpeechVoices,
  onApplySpeechOutputPreset,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunAudioSmokeTest,
  onRunSpeechInputConnectionTest,
  onRunSpeechOutputConnectionTest,
  onStartVoiceConversation,
  onStopVoiceConversation,
  onCancelVoiceTurn,
  platformProfile,
  previewingSpeech,
  speechInputEvidence,
  speechOutputEvidence,
  runningAudioSmoke,
  saveError,
  saving,
  setDraft,
  setSpeechPreviewText,
  speechPreviewStatus,
  speechPreviewText,
  speechVoiceOptions,
  speechVoiceStatus,
  testingInputTarget,
  testingOutputTarget,
  uiLanguage,
  voiceActionPending,
  voiceState,
}: VoiceSectionV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const tiParam = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const setSetting = <TKey extends keyof AppSettings>(key: TKey, value: AppSettings[TKey]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const smokeMessage = audioSmokeStatus?.message?.replaceAll('{companionName}', draft.companionName)

  const inputAvailable = isVoiceSpeechInputAvailable(platformProfile)
  const outputAvailable = isVoiceSpeechOutputAvailable(platformProfile)
  const continuousAvailable = isVoiceContinuousAvailable(platformProfile)
  const vadAvailable = isVoiceVadAvailable(platformProfile)
  const wakewordAvailable = isVoiceWakewordAvailable(platformProfile)
  const continuousEnabled = draft.speechInputEnabled && draft.continuousVoiceModeEnabled
  const vadEnabled = continuousEnabled && draft.voiceActivityDetectionEnabled
  const triggerOptions = getVoiceTriggerModeOptions(uiLanguage)
  const triggerOption = triggerOptions.find((option) => option.value === draft.voiceTriggerMode) ?? triggerOptions[0]
  const platformReason = getPlatformDependencyHint(
    platformProfile,
    platformProfile.voice.speechInputSupported || platformProfile.voice.speechOutputSupported,
    platformProfile.voice.speechInputAvailable || platformProfile.voice.speechOutputAvailable,
    platformProfile.voice.dependencyHint,
  )
  const platformHint = platformReason === 'unsupported'
    ? ti('settings.platform.unsupported')
    : platformReason === 'unavailable'
      ? ti('settings.platform.unavailable')
      : platformReason
        ? tiParam('settings.platform.unavailable_dependency', { dependency: platformReason })
        : null

  const runtimeVoiceLabel = voiceState === 'idle'
    ? (continuousVoiceActive
      ? ti('panel.voice.stop_continuous')
      : (dirty ? `${ti('settings.save')} · ${ti('ui_v2.start_voice')}` : ti('ui_v2.start_voice')))
    : voiceState === 'listening'
      ? ti('panel.voice.stop_listening')
      : voiceState === 'processing'
        ? ti('panel.voice.cancel_reply')
        : ti('panel.voice.interrupt_response')
  const runtimeVoicePending = saving || voiceActionPending
  const runtimeVoiceDisabled = runtimeVoicePending || (
    voiceState === 'idle'
    && !continuousVoiceActive
    && (!draft.speechInputEnabled || !inputAvailable)
  )
  const handleRuntimeVoiceAction = () => {
    if (voiceState === 'idle') {
      if (continuousVoiceActive) {
        onStopVoiceConversation()
      } else {
        void onStartVoiceConversation()
      }
    } else if (voiceState === 'listening') {
      onStopVoiceConversation()
    } else if (voiceState === 'processing') {
      onCancelVoiceTurn()
    } else {
      onStopVoiceConversation()
    }
  }

  const updateInputEnabled = (speechInputEnabled: boolean) => {
    setDraft((current) => ({
      ...current,
      speechInputEnabled,
      ...(!speechInputEnabled
        ? { continuousVoiceModeEnabled: false, voiceActivityDetectionEnabled: false }
        : {}),
    }))
  }

  return (
    <SettingsV3Page className={active ? 'settings-v3-voice' : 'is-hidden settings-v3-voice'}>
      {platformHint ? <SettingsV3Notice tone="warning" title={platformHint} /> : null}

      <SettingsV3Section title={ti('settings.voice.loop_title')} description={ti('settings.voice.loop_hint')}>
        <SettingsV3Row
          icon="mic"
          label={ti('settings.voice.enable_input')}
          hint={inputAvailable ? ti('settings.voice.status_input_ready') : ti('settings.voice.status_input_unavailable')}
          disabled={!inputAvailable}
        >
          <SettingsV3Switch
            label={ti('settings.voice.enable_input')}
            checked={draft.speechInputEnabled}
            disabled={!inputAvailable}
            onChange={updateInputEnabled}
          />
        </SettingsV3Row>
        <SettingsV3Row
          icon="speaker"
          label={ti('settings.voice.enable_output')}
          hint={outputAvailable ? ti('settings.voice.status_output_ready') : ti('settings.voice.status_output_unavailable')}
          disabled={!outputAvailable}
        >
          <SettingsV3Switch
            label={ti('settings.voice.enable_output')}
            checked={draft.speechOutputEnabled}
            disabled={!outputAvailable}
            onChange={(value) => setSetting('speechOutputEnabled', value)}
          />
        </SettingsV3Row>
      </SettingsV3Section>

      <SettingsV3Notice
        tone={audioSmokeStatus ? (audioSmokeStatus.ok ? 'success' : 'error') : 'info'}
        title={smokeMessage ?? tiParam('settings.voice.test_message', { companionName: draft.companionName })}
        announce={Boolean(audioSmokeStatus)}
      >
        {!audioSmokeStatus ? ti('settings.voice.loop_hint') : undefined}
      </SettingsV3Notice>
      {saveError ? <SettingsV3Notice tone="error" title={ti('settings.save_failed_fallback')} /> : null}
      <SettingsV3Toolbar>
        <button
          type="button"
          aria-label={runtimeVoiceLabel}
          aria-busy={runtimeVoicePending ? 'true' : undefined}
          disabled={runtimeVoiceDisabled}
          onClick={handleRuntimeVoiceAction}
        >
          {runtimeVoiceLabel}
        </button>
        <button
          type="button"
          onClick={onRunAudioSmokeTest}
          disabled={runningAudioSmoke || previewingSpeech || testingInputTarget !== null || testingOutputTarget !== null || !outputAvailable}
        >
          {runningAudioSmoke ? ti('settings.voice.checking') : ti('settings.voice.audio_smoke_test')}
        </button>
      </SettingsV3Toolbar>
      <span className="settings-v3-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {runtimeVoiceLabel}
      </span>

      <SettingsV3Section title={ti('settings.voice.trigger_mode')} description={triggerOption.hint.trim()}>
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.voice.trigger_mode')} hint={triggerOption.hint.trim()}>
            <select
              value={draft.voiceTriggerMode}
              onChange={(event) => {
                const voiceTriggerMode = event.target.value as AppSettings['voiceTriggerMode']
                setDraft((current) => ({
                  ...current,
                  voiceTriggerMode,
                  wakeWordEnabled: voiceTriggerMode === 'wake_word',
                  ...(voiceTriggerMode === 'wake_word' && !current.wakeWord.trim()
                    ? { wakeWord: getDirectSendFallbackWakeWord(current) }
                    : {}),
                }))
              }}
            >
              {triggerOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === 'wake_word' && !wakewordAvailable}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </SettingsV3Field>
          {draft.voiceTriggerMode === 'wake_word' ? (
            <SettingsV3Field label={ti('settings.voice.wake_word')} hint={ti('settings.voice.wake_word_note_suffix')}>
              <input
                value={draft.wakeWord}
                placeholder={ti('settings.voice.wake_word_placeholder')}
                disabled={!wakewordAvailable}
                onChange={(event) => setSetting('wakeWord', event.target.value)}
              />
            </SettingsV3Field>
          ) : null}
        </div>
      </SettingsV3Section>

      {draft.voiceTriggerMode === 'wake_word' && !isWakeWordSupported(draft.wakeWord) ? (
        <SettingsV3Notice tone="error" title={ti('settings.voice.wake_word_chinese_only')} announce />
      ) : null}

      <SettingsV3Disclosure title={ti('settings.speech_input.title')} description={ti('settings.speech_input.hint')}>
        <SpeechInputProviderV3
          draft={draft}
          platformProfile={platformProfile}
          setDraft={setDraft}
          testingTarget={testingInputTarget}
          onRunConnectionTest={onRunSpeechInputConnectionTest}
          connectionEvidence={speechInputEvidence}
        />
      </SettingsV3Disclosure>

      <SettingsV3Disclosure title={ti('settings.speech_output.title')} description={ti('settings.speech_output.hint')}>
        <SpeechOutputProviderV3
          draft={draft}
          setDraft={setDraft}
          speechVoiceOptions={speechVoiceOptions}
          speechVoiceStatus={speechVoiceStatus}
          loadingSpeechVoices={loadingSpeechVoices}
          speechPreviewText={speechPreviewText}
          setSpeechPreviewText={setSpeechPreviewText}
          speechPreviewStatus={speechPreviewStatus}
          previewingSpeech={previewingSpeech}
          testingTarget={testingOutputTarget}
          onApplyProviderPreset={onApplySpeechOutputPreset}
          onLoadSpeechVoices={onLoadSpeechVoices}
          onPreviewSpeech={onPreviewSpeech}
          onRunConnectionTest={onRunSpeechOutputConnectionTest}
          connectionEvidence={speechOutputEvidence}
        />
      </SettingsV3Disclosure>

      <SettingsV3Disclosure title={ti('settings.voice.advanced_title')} description={ti('settings.voice.advanced_hint')}>
        <SettingsV3Row
          label={ti('settings.voice.enable_continuous')}
          hint={continuousEnabled ? ti('settings.voice.status_continuous_on') : ti('settings.voice.status_continuous_off')}
          disabled={!continuousAvailable || !draft.speechInputEnabled}
        >
          <SettingsV3Switch
            label={ti('settings.voice.enable_continuous')}
            checked={continuousEnabled}
            disabled={!continuousAvailable || !draft.speechInputEnabled}
            onChange={(value) => setDraft((current) => ({
              ...current,
              continuousVoiceModeEnabled: value,
              ...(!value ? { voiceActivityDetectionEnabled: false } : {}),
            }))}
          />
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.voice.enable_vad')} disabled={!vadAvailable || !continuousEnabled}>
          <SettingsV3Switch
            label={ti('settings.voice.enable_vad')}
            checked={vadEnabled}
            disabled={!vadAvailable || !continuousEnabled}
            onChange={(value) => setSetting('voiceActivityDetectionEnabled', value)}
          />
        </SettingsV3Row>
        {vadEnabled ? (
          <div className="settings-v3-editor">
            <SettingsV3Field label={ti('settings.voice.vad_sensitivity')}>
              <select
                value={draft.vadSensitivity}
                onChange={(event) => setSetting('vadSensitivity', event.target.value as AppSettings['vadSensitivity'])}
              >
                <option value="low">{ti('settings.voice.vad.low')}</option>
                <option value="medium">{ti('settings.voice.vad.medium')}</option>
                <option value="high">{ti('settings.voice.vad.high')}</option>
              </select>
            </SettingsV3Field>
          </div>
        ) : null}
        <SettingsV3Row label={ti('settings.voice.allow_interruption')} hint={ti('settings.voice.interrupt_hint')}>
          <SettingsV3Switch
            label={ti('settings.voice.allow_interruption')}
            checked={draft.voiceInterruptionEnabled}
            disabled={!inputAvailable || !outputAvailable}
            onChange={(value) => setSetting('voiceInterruptionEnabled', value)}
          />
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.voice.enable_stt_failover')}>
          <SettingsV3Switch
            label={ti('settings.voice.enable_stt_failover')}
            checked={draft.speechInputFailoverEnabled}
            disabled={!inputAvailable}
            onChange={(value) => setSetting('speechInputFailoverEnabled', value)}
          />
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.voice.enable_tts_failover')}>
          <SettingsV3Switch
            label={ti('settings.voice.enable_tts_failover')}
            checked={draft.speechOutputFailoverEnabled}
            disabled={!outputAvailable}
            onChange={(value) => setSetting('speechOutputFailoverEnabled', value)}
          />
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.voice.always_on_wakeword')} hint={ti('settings.voice.always_on_wakeword_hint')}>
          <SettingsV3Switch
            label={ti('settings.voice.always_on_wakeword')}
            checked={draft.wakewordAlwaysOn}
            disabled={!wakewordAvailable}
            onChange={(value) => setSetting('wakewordAlwaysOn', value)}
          />
        </SettingsV3Row>
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.voice.session_idle_timeout')} hint={ti('settings.voice.session_idle_timeout_hint')}>
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
                setSetting('wakewordSessionIdleTimeoutMs', Math.max(3, Math.min(120, Math.round(seconds))) * 1000)
              }}
            />
          </SettingsV3Field>
        </div>
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
