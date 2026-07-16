import { memo, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  clampNumber,
  formatTtsAdjustmentValue,
  parseNumberInput,
  parseVolcengineCredentialParts,
  type ConnectionResult,
  type VolcengineCredentialParts,
} from '../../components/settingsDrawerSupport'
import { UrlInput } from '../../components/settingsSections/UrlInput'
import {
  getSpeechOutputAdjustmentSupport,
  getSpeechOutputModelOptions,
  getSpeechOutputProviderPreset,
  getSpeechOutputStyleOptions,
  isEdgeTtsSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isSpeechOutputKeyless,
  isVolcengineSpeechOutputProvider,
  supportsCustomSpeechOutputVoiceId,
} from '../../lib/audioProviders'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge'
import { SPEECH_OUTPUT_PROVIDERS } from '../../lib/speechProviderCatalog'
import { updateCurrentSpeechOutputProviderProfile } from '../../lib/speechProviderProfiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  ServiceConnectionCapability,
  SpeechVoiceOption,
  TranslationKey,
} from '../../types'
import {
  SettingsV3ConnectionEvidence,
  type SettingsV3ConnectionEvidenceValue,
  SettingsV3Disclosure,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'

type SpeechOutputProviderV3Props = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  speechVoiceOptions: SpeechVoiceOption[]
  speechVoiceStatus: ConnectionResult | null
  loadingSpeechVoices: boolean
  speechPreviewText: string
  setSpeechPreviewText: Dispatch<SetStateAction<string>>
  speechPreviewStatus: ConnectionResult | null
  previewingSpeech: boolean
  testingTarget: ServiceConnectionCapability | null
  onApplyProviderPreset: (providerId: string) => void
  onLoadSpeechVoices: () => void
  onPreviewSpeech: () => void
  onRunConnectionTest: () => void
  connectionEvidence: SettingsV3ConnectionEvidenceValue | null
}

type TuningSliderProps = {
  label: string
  displayValue: string
  hint: string
  disabledHint: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}

const providerOptions = SPEECH_OUTPUT_PROVIDERS
  .filter((provider) => !provider.hidden)
  .map((provider) => ({ id: provider.id, label: provider.label }))

function TuningSliderV3({
  label,
  displayValue,
  hint,
  disabledHint,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: TuningSliderProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(clampNumber(parseNumberInput(event.target.value, value), min, max))
  }
  return (
    <div className="settings-v3-tuning" data-disabled={disabled ? 'true' : undefined}>
      <div className="settings-v3-tuning__head"><strong>{label}</strong><span>{displayValue}</span></div>
      <div className="settings-v3-tuning__controls">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={handleChange}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={handleChange}
        />
      </div>
      <small>{disabled ? disabledHint : hint}</small>
    </div>
  )
}

export const SpeechOutputProviderV3 = memo(function SpeechOutputProviderV3({
  draft,
  setDraft,
  speechVoiceOptions,
  speechVoiceStatus,
  loadingSpeechVoices,
  speechPreviewText,
  setSpeechPreviewText,
  speechPreviewStatus,
  previewingSpeech,
  testingTarget,
  onApplyProviderPreset,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunConnectionTest,
  connectionEvidence,
}: SpeechOutputProviderV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(draft.uiLanguage, key)
  const provider = getSpeechOutputProviderPreset(draft.speechOutputProviderId)
  const adjustmentSupport = getSpeechOutputAdjustmentSupport(draft.speechOutputProviderId)
  const modelOptions = getSpeechOutputModelOptions(draft.speechOutputProviderId)
  const styleOptions = getSpeechOutputStyleOptions(draft.speechOutputProviderId)
  const isMiniMax = isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
  const isVolcengine = isVolcengineSpeechOutputProvider(draft.speechOutputProviderId)
  const isEdgeTts = isEdgeTtsSpeechOutputProvider(draft.speechOutputProviderId)
  const hideCredentials = isSpeechOutputKeyless(draft.speechOutputProviderId)
  const showCustomVoice = supportsCustomSpeechOutputVoiceId(draft.speechOutputProviderId)
  const secretIsVaultRef = isVaultRefString(draft.speechOutputApiKey)
  const secretValue = displaySecretInputValue(draft.speechOutputApiKey)
  const volcengineCredentials = secretIsVaultRef
    ? ({ appId: '', accessToken: '' } satisfies VolcengineCredentialParts)
    : parseVolcengineCredentialParts(draft.speechOutputApiKey)
  const modelLabel = isVolcengine ? ti('settings.speech_output.cluster') : ti('settings.speech_output.model')
  const voiceLabel = isVolcengine ? ti('settings.speech_output.voice_type') : ti('settings.speech_output.voice')

  const updateProfile = (patch: Parameters<typeof updateCurrentSpeechOutputProviderProfile>[1]) => {
    setDraft((current) => updateCurrentSpeechOutputProviderProfile(current, patch))
  }
  const updateVolcengineCredential = (patch: Partial<VolcengineCredentialParts>) => {
    setDraft((current) => {
      const parts = parseVolcengineCredentialParts(current.speechOutputApiKey)
      return updateCurrentSpeechOutputProviderProfile(current, {
        apiKey: buildVolcengineCredential({ ...parts, ...patch }),
      })
    })
  }
  const resolveVoiceLabel = (voice: SpeechVoiceOption) => {
    const label = ti(voice.label as TranslationKey)
    return voice.needsAuth ? `${label} ${ti('provider.tts.voice.volcengine.needs_auth_suffix')}` : label
  }
  const resolveVoiceDescription = (voice: SpeechVoiceOption): string | undefined => {
    const description = voice.description ? ti(voice.description as TranslationKey) : undefined
    if (!voice.needsAuth) return description
    const fallback = ti('provider.tts.voice.volcengine.needs_auth_fallback')
    return description ? `${description} ${fallback}` : fallback
  }
  const currentVoice = speechVoiceOptions.find((voice) => voice.id === draft.speechOutputVoice)
  const voiceSelectValue = currentVoice ? draft.speechOutputVoice : '__keep-current__'

  return (
    <div className="settings-v3-provider">
      <SettingsV3Toolbar>
        <button type="button" onClick={onRunConnectionTest} disabled={testingTarget === 'speech-output'}>
          {testingTarget === 'speech-output' ? ti('settings.speech_output.testing') : ti('settings.speech_output.test')}
        </button>
      </SettingsV3Toolbar>

      <div className="settings-v3-editor settings-v3-provider__fields">
        <SettingsV3Field label={ti('settings.speech_output.provider')}>
          <select value={draft.speechOutputProviderId} onChange={(event) => onApplyProviderPreset(event.target.value)}>
            {providerOptions.map((option) => (
              <option key={option.id} value={option.id}>{ti(option.label)}</option>
            ))}
          </select>
        </SettingsV3Field>

        <SettingsV3Notice title={ti(provider.notes as TranslationKey)}>
          {`${provider.baseUrl ? `${ti('settings.speech_output.default_endpoint')}${provider.baseUrl} ` : ''}${provider.defaultModel ? `${ti('settings.speech_output.default_model')}${provider.defaultModel}` : ''}`.trim() || undefined}
        </SettingsV3Notice>

        {!isEdgeTts ? (
          <SettingsV3Field label={ti('settings.speech_output.endpoint_url')}>
            <UrlInput
              uiLanguage={draft.uiLanguage}
              value={draft.speechOutputApiBaseUrl}
              onChange={(event) => updateProfile({ apiBaseUrl: event.target.value })}
            />
          </SettingsV3Field>
        ) : null}

        {isVolcengine ? (
          <div className="settings-v3-provider__grid">
            <SettingsV3Field label={ti('settings.speech_output.volcengine_app_id')}>
              <input
                value={volcengineCredentials.appId}
                placeholder={secretIsVaultRef ? '********' : undefined}
                onChange={(event) => updateVolcengineCredential({ appId: event.target.value })}
              />
            </SettingsV3Field>
            <SettingsV3Field
              label={ti('settings.speech_output.volcengine_token')}
              hint={ti('settings.speech_output.volcengine_credential_hint')}
            >
              <input
                type="password"
                autoComplete="off"
                value={volcengineCredentials.accessToken}
                placeholder={secretIsVaultRef ? '********' : undefined}
                onChange={(event) => updateVolcengineCredential({ accessToken: event.target.value })}
              />
            </SettingsV3Field>
          </div>
        ) : !hideCredentials ? (
          <SettingsV3Field label={ti('settings.speech_output.api_key')}>
            <input
              type="password"
              autoComplete="off"
              value={secretValue}
              placeholder={secretIsVaultRef ? '********' : undefined}
              onChange={(event) => updateProfile({ apiKey: event.target.value })}
            />
          </SettingsV3Field>
        ) : null}

        {modelOptions.length || provider.defaultModel ? (
          <SettingsV3Field
            label={modelLabel}
            hint={isVolcengine ? ti('settings.speech_output.volcengine_cluster_hint') : undefined}
          >
            {modelOptions.length ? (
              <select value={draft.speechOutputModel} onChange={(event) => updateProfile({ model: event.target.value })}>
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{ti(option.label as TranslationKey)}</option>
                ))}
              </select>
            ) : (
              <input value={draft.speechOutputModel} onChange={(event) => updateProfile({ model: event.target.value })} />
            )}
          </SettingsV3Field>
        ) : null}

        {isMiniMax ? (
          <div className="settings-v3-provider__catalog">
            <SettingsV3Toolbar>
              <span>{ti('settings.speech_output.minimax_hint')}</span>
              <button type="button" onClick={onLoadSpeechVoices} disabled={loadingSpeechVoices}>
                {loadingSpeechVoices ? ti('settings.speech_output.minimax_fetching') : ti('settings.speech_output.minimax_refresh')}
              </button>
            </SettingsV3Toolbar>
            <SettingsV3Field label={ti('settings.speech_output.minimax_voices_label')}>
              <select
                value={voiceSelectValue}
                onChange={(event) => event.target.value !== '__keep-current__' && updateProfile({ voice: event.target.value })}
              >
                <option value="__keep-current__">
                  {draft.speechOutputVoice
                    ? `${ti('settings.speech_output.keep_current')}${draft.speechOutputVoice}`
                    : ti('settings.speech_output.select_minimax_voice')}
                </option>
                {speechVoiceOptions.map((voice) => {
                  const label = resolveVoiceLabel(voice)
                  return <option key={voice.id} value={voice.id}>{label === voice.id ? voice.id : `${label} (${voice.id})`}</option>
                })}
              </select>
            </SettingsV3Field>
            {speechVoiceOptions.length ? (
              <small>{currentVoice ? resolveVoiceDescription(currentVoice) ?? ti('settings.speech_output.minimax_voices_loaded') : ti('settings.speech_output.minimax_voices_loaded')}</small>
            ) : null}
          </div>
        ) : null}

        {isEdgeTts ? (
          <SettingsV3Field label={voiceLabel} hint={ti('settings.speech_output.edge_tts_hint')}>
            {speechVoiceOptions.length ? (
              <select value={draft.speechOutputVoice} onChange={(event) => updateProfile({ voice: event.target.value })}>
                {speechVoiceOptions.map((voice) => <option key={voice.id} value={voice.id}>{resolveVoiceLabel(voice)}</option>)}
              </select>
            ) : (
              <input
                value={draft.speechOutputVoice}
                placeholder="zh-CN-XiaoxiaoNeural"
                onChange={(event) => updateProfile({ voice: event.target.value })}
              />
            )}
          </SettingsV3Field>
        ) : null}

        {!isMiniMax && !isEdgeTts && speechVoiceOptions.length ? (
          <SettingsV3Field
            label={isVolcengine ? ti('settings.speech_output.volcengine_voices_label') : voiceLabel}
            hint={currentVoice ? resolveVoiceDescription(currentVoice) ?? ti('settings.speech_output.voice_catalog_hint') : ti('settings.speech_output.voice_catalog_hint')}
          >
            <select
              value={voiceSelectValue}
              onChange={(event) => event.target.value !== '__keep-current__' && updateProfile({ voice: event.target.value })}
            >
              <option value="__keep-current__">
                {draft.speechOutputVoice ? `${ti('settings.speech_output.keep_current')}${draft.speechOutputVoice}` : ti('settings.speech_output.select_voice')}
              </option>
              {speechVoiceOptions.map((voice) => {
                const label = resolveVoiceLabel(voice)
                return <option key={voice.id} value={voice.id}>{label === voice.id ? voice.id : `${label} (${voice.id})`}</option>
              })}
            </select>
          </SettingsV3Field>
        ) : null}

        {showCustomVoice && !isEdgeTts ? (
          <SettingsV3Field label={voiceLabel}>
            <input value={draft.speechOutputVoice} onChange={(event) => updateProfile({ voice: event.target.value })} />
          </SettingsV3Field>
        ) : null}

        {speechVoiceStatus ? (
          <SettingsV3Notice
            tone={speechVoiceStatus.ok ? 'success' : 'error'}
            title={speechVoiceStatus.message}
            announce
          />
        ) : null}

        {styleOptions.length ? (
          <SettingsV3Field
            label={ti('settings.speech_output.style')}
            hint={(() => {
              const style = styleOptions.find((option) => option.value === draft.speechOutputInstructions)
              return style?.description ? ti(style.description as TranslationKey) : ti('settings.speech_output.style_hint')
            })()}
          >
            <select
              value={styleOptions.some((option) => option.value === draft.speechOutputInstructions) ? draft.speechOutputInstructions : ''}
              onChange={(event) => updateProfile({ instructions: event.target.value })}
            >
              {styleOptions.map((option) => (
                <option key={option.value || '__default__'} value={option.value}>{ti(option.label as TranslationKey)}</option>
              ))}
            </select>
          </SettingsV3Field>
        ) : null}

        <SettingsV3Field label={ti('settings.speech_output.speech_lang')}>
          <input
            value={draft.speechSynthesisLang}
            onChange={(event) => setDraft((current) => ({ ...current, speechSynthesisLang: event.target.value }))}
          />
        </SettingsV3Field>
      </div>

      <SettingsV3Disclosure
        title={ti('settings.speech_output.tuning_title')}
        description={ti(adjustmentSupport.note as TranslationKey)}
      >
        <SettingsV3Toolbar>
          <button
            type="button"
            onClick={() => setDraft((current) => ({ ...current, speechRate: 0.92, speechPitch: 1.08, speechVolume: 1 }))}
          >
            {ti('settings.speech_output.restore_defaults')}
          </button>
        </SettingsV3Toolbar>
        <div className="settings-v3-tuning-list">
          <TuningSliderV3
            label={ti('settings.speech_output.rate')}
            displayValue={formatTtsAdjustmentValue('rate', draft.speechRate)}
            hint={ti('settings.speech_output.rate_hint')}
            disabledHint={ti('settings.speech_output.rate_disabled_hint')}
            value={draft.speechRate}
            min={0.5}
            max={2}
            step={0.05}
            disabled={!adjustmentSupport.rate}
            onChange={(speechRate) => setDraft((current) => ({ ...current, speechRate }))}
          />
          <TuningSliderV3
            label={ti('settings.speech_output.pitch')}
            displayValue={formatTtsAdjustmentValue('pitch', draft.speechPitch)}
            hint={ti('settings.speech_output.pitch_hint')}
            disabledHint={ti('settings.speech_output.pitch_disabled_hint')}
            value={draft.speechPitch}
            min={0.5}
            max={2}
            step={0.05}
            disabled={!adjustmentSupport.pitch}
            onChange={(speechPitch) => setDraft((current) => ({ ...current, speechPitch }))}
          />
          <TuningSliderV3
            label={ti('settings.speech_output.volume')}
            displayValue={formatTtsAdjustmentValue('volume', draft.speechVolume)}
            hint={ti('settings.speech_output.volume_hint')}
            disabledHint={ti('settings.speech_output.volume_disabled_hint')}
            value={draft.speechVolume}
            min={0}
            max={1}
            step={0.05}
            disabled={!adjustmentSupport.volume}
            onChange={(speechVolume) => setDraft((current) => ({ ...current, speechVolume }))}
          />
        </div>
      </SettingsV3Disclosure>

      <div className="settings-v3-editor settings-v3-provider__preview">
        <SettingsV3Field label={ti('settings.speech_output.preview_text')}>
          <textarea rows={3} value={speechPreviewText} onChange={(event) => setSpeechPreviewText(event.target.value)} />
        </SettingsV3Field>
        <SettingsV3Toolbar>
          <button type="button" onClick={onPreviewSpeech} disabled={previewingSpeech}>
            {previewingSpeech ? ti('settings.speech_output.previewing') : ti('settings.speech_output.preview')}
          </button>
        </SettingsV3Toolbar>
        {speechPreviewStatus ? (
          <SettingsV3Notice
            tone={speechPreviewStatus.ok ? 'success' : 'error'}
            title={speechPreviewStatus.message}
            announce
          />
        ) : null}
      </div>

      <SettingsV3ConnectionEvidence evidence={connectionEvidence} />
    </div>
  )
})
