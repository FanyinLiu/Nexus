import { memo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  clampNumber,
  formatTtsAdjustmentValue,
  parseNumberInput,
  parseVolcengineCredentialParts,
  type ConnectionResult,
  type VolcengineCredentialParts,
} from '../settingsDrawerSupport'
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
import { SPEECH_OUTPUT_PROVIDERS } from '../../lib/providerCatalog'
import { updateCurrentSpeechOutputProviderProfile } from '../../lib/speechProviderProfiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  ServiceConnectionCapability,
  SpeechVoiceOption,
  TranslationKey,
} from '../../types'
import { UrlInput } from './UrlInput'

const speechOutputSelectOptions = SPEECH_OUTPUT_PROVIDERS
  .filter((p) => !p.hidden)
  .map((p) => ({ id: p.id, label: p.label }))

type SpeechOutputSectionProps = {
  active: boolean
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
  onApplySpeechOutputPreset: (providerId: string) => void
  onLoadSpeechVoices: () => void
  onPreviewSpeech: () => void
  onRunSpeechOutputConnectionTest: () => void
  renderSpeechOutputTestResult: () => ReactNode
}

export const SpeechOutputSection = memo(function SpeechOutputSection({
  active,
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
  onApplySpeechOutputPreset,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunSpeechOutputConnectionTest,
  renderSpeechOutputTestResult,
}: SpeechOutputSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)

  const resolveVoiceLabel = (voice: SpeechVoiceOption) => {
    const base = ti(voice.label as TranslationKey)
    return voice.needsAuth
      ? `${base} ${ti('provider.tts.voice.volcengine.needs_auth_suffix')}`
      : base
  }

  const resolveVoiceDescription = (voice: SpeechVoiceOption): string | undefined => {
    const base = voice.description ? ti(voice.description as TranslationKey) : undefined
    if (!voice.needsAuth) return base
    const fallback = ti('provider.tts.voice.volcengine.needs_auth_fallback')
    return base ? `${base} ${fallback}` : fallback
  }

  const speechOutputProvider = getSpeechOutputProviderPreset(draft.speechOutputProviderId)
  const speechOutputAdjustmentSupport = getSpeechOutputAdjustmentSupport(draft.speechOutputProviderId)
  const speechOutputModelOptions = getSpeechOutputModelOptions(draft.speechOutputProviderId)
  const speechOutputStyleOptions = getSpeechOutputStyleOptions(draft.speechOutputProviderId)
  const isMiniMaxSpeechOutput = isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
  const isVolcengineSpeechOutput = isVolcengineSpeechOutputProvider(draft.speechOutputProviderId)
  const isEdgeTtsSpeechOutput = isEdgeTtsSpeechOutputProvider(draft.speechOutputProviderId)
  const hideApiCredentials = isSpeechOutputKeyless(draft.speechOutputProviderId)
  const showCustomVoiceInput = supportsCustomSpeechOutputVoiceId(draft.speechOutputProviderId)
  const speechOutputVolcengineCredentials = parseVolcengineCredentialParts(draft.speechOutputApiKey)
  const speechOutputModelLabel = isVolcengineSpeechOutput
    ? ti('settings.speech_output.cluster')
    : ti('settings.speech_output.model')
  const speechOutputVoiceLabel = isVolcengineSpeechOutput
    ? ti('settings.speech_output.voice_type')
    : ti('settings.speech_output.voice')

  function updateSpeechOutputVolcengineCredential(partial: Partial<VolcengineCredentialParts>) {
    setDraft((prev) => {
      const current = parseVolcengineCredentialParts(prev.speechOutputApiKey)
      return updateCurrentSpeechOutputProviderProfile(prev, {
        apiKey: buildVolcengineCredential({
          ...current,
          ...partial,
        }),
      })
    })
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.speech_output.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.speech_output.hint')}
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunSpeechOutputConnectionTest}
          disabled={testingTarget === 'speech-output'}
        >
          {testingTarget === 'speech-output'
            ? ti('settings.speech_output.testing')
            : ti('settings.speech_output.test')}
        </button>
      </div>

      <label>
        <span>{ti('settings.speech_output.provider')}</span>
        <select
          value={draft.speechOutputProviderId}
          onChange={(event) => onApplySpeechOutputPreset(event.target.value)}
        >
          {speechOutputSelectOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{ti(opt.label)}</option>
          ))}
        </select>
      </label>


      <p className="settings-drawer__hint">
        {ti(speechOutputProvider.notes as TranslationKey)}
        {speechOutputProvider.baseUrl
          ? ` ${ti('settings.speech_output.default_endpoint')}${speechOutputProvider.baseUrl}`
          : ''}
        {speechOutputProvider.defaultModel
          ? `${ti('settings.speech_output.default_model')}${speechOutputProvider.defaultModel}`
          : ''}
      </p>

      {!isEdgeTtsSpeechOutput ? (
        <label>
          <span>{ti('settings.speech_output.endpoint_url')}</span>
          <UrlInput
            value={draft.speechOutputApiBaseUrl}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                apiBaseUrl: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      {isVolcengineSpeechOutput ? (
        <>
          <div className="settings-grid settings-grid--two">
            <label>
              <span>{ti('settings.speech_output.volcengine_app_id')}</span>
              <input
                value={speechOutputVolcengineCredentials.appId}
                onChange={(event) =>
                  updateSpeechOutputVolcengineCredential({
                    appId: event.target.value,
                  })
                }
              />
            </label>

            <label>
              <span>{ti('settings.speech_output.volcengine_token')}</span>
              <input
                type="password"
                value={speechOutputVolcengineCredentials.accessToken}
                onChange={(event) =>
                  updateSpeechOutputVolcengineCredential({
                    accessToken: event.target.value,
                  })
                }
              />
            </label>
          </div>

          <p className="settings-drawer__hint">
            {ti('settings.speech_output.volcengine_credential_hint')}
          </p>
        </>
      ) : !hideApiCredentials ? (
        <label>
          <span>{ti('settings.speech_output.api_key')}</span>
          <input
            type="password"
            value={draft.speechOutputApiKey}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                apiKey: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      {speechOutputModelOptions.length || speechOutputProvider.defaultModel ? (
        <label>
          <span>{speechOutputModelLabel}</span>
          {speechOutputModelOptions.length ? (
            <select
              value={draft.speechOutputModel}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  model: event.target.value,
                }))
              }
            >
              {speechOutputModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {ti(option.label as TranslationKey)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={draft.speechOutputModel}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  model: event.target.value,
                }))
              }
            />
          )}
        </label>
      ) : null}

      {isVolcengineSpeechOutput ? (
        <p className="settings-drawer__hint">
          {ti('settings.speech_output.volcengine_cluster_hint')}
        </p>
      ) : null}

      {isMiniMaxSpeechOutput ? (
        <>
          <div className="settings-section__title-row">
            <div>
              <p className="settings-drawer__hint">
                {ti('settings.speech_output.minimax_hint')}
              </p>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={onLoadSpeechVoices}
              disabled={loadingSpeechVoices}
            >
              {loadingSpeechVoices
                ? ti('settings.speech_output.minimax_fetching')
                : ti('settings.speech_output.minimax_refresh')}
            </button>
          </div>

          <label>
            <span>{ti('settings.speech_output.minimax_voices_label')}</span>
            <select
              value={speechVoiceOptions.some((voice) => voice.id === draft.speechOutputVoice)
                ? draft.speechOutputVoice
                : '__keep-current__'}
              onChange={(event) => {
                if (event.target.value === '__keep-current__') return
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  voice: event.target.value,
                }))
              }}
            >
              <option value="__keep-current__">
                {draft.speechOutputVoice
                  ? `${ti('settings.speech_output.keep_current')}${draft.speechOutputVoice}`
                  : ti('settings.speech_output.select_minimax_voice')}
              </option>
              {speechVoiceOptions.map((voice) => {
                const resolvedLabel = resolveVoiceLabel(voice)
                return (
                  <option key={voice.id} value={voice.id}>
                    {resolvedLabel === voice.id ? voice.id : `${resolvedLabel} (${voice.id})`}
                  </option>
                )
              })}
            </select>
          </label>

          {speechVoiceOptions.length ? (
            <p className="settings-drawer__hint">
              {(() => {
                const current = speechVoiceOptions.find((voice) => voice.id === draft.speechOutputVoice)
                return current
                  ? resolveVoiceDescription(current) ?? ti('settings.speech_output.minimax_voices_loaded')
                  : ti('settings.speech_output.minimax_voices_loaded')
              })()}
            </p>
          ) : null}
        </>
      ) : null}

      {isEdgeTtsSpeechOutput ? (
        <>
          <label>
            <span>{speechOutputVoiceLabel}</span>
            {speechVoiceOptions.length ? (
              <select
                value={draft.speechOutputVoice}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    voice: event.target.value,
                  }))
                }
              >
                {speechVoiceOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>{resolveVoiceLabel(voice)}</option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechOutputVoice}
                placeholder="zh-CN-XiaoxiaoNeural"
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    voice: event.target.value,
                  }))
                }
              />
            )}
          </label>
          <p className="settings-drawer__hint">
            {ti('settings.speech_output.edge_tts_hint')}
          </p>
        </>
      ) : null}

      {!isMiniMaxSpeechOutput && !isEdgeTtsSpeechOutput && speechVoiceOptions.length ? (
        <>
          <label>
            <span>{isVolcengineSpeechOutput
              ? ti('settings.speech_output.volcengine_voices_label')
              : speechOutputVoiceLabel}</span>
            <select
              value={speechVoiceOptions.some((voice) => voice.id === draft.speechOutputVoice)
                ? draft.speechOutputVoice
                : '__keep-current__'}
              onChange={(event) => {
                if (event.target.value === '__keep-current__') return
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  voice: event.target.value,
                }))
              }}
            >
              <option value="__keep-current__">
                {draft.speechOutputVoice
                  ? `${ti('settings.speech_output.keep_current')}${draft.speechOutputVoice}`
                  : ti('settings.speech_output.select_voice')}
              </option>
              {speechVoiceOptions.map((voice) => {
                const resolvedLabel = resolveVoiceLabel(voice)
                return (
                  <option key={voice.id} value={voice.id}>
                    {resolvedLabel === voice.id ? voice.id : `${resolvedLabel} (${voice.id})`}
                  </option>
                )
              })}
            </select>
          </label>

          <p className="settings-drawer__hint">
            {(() => {
              const current = speechVoiceOptions.find((voice) => voice.id === draft.speechOutputVoice)
              return current
                ? resolveVoiceDescription(current) ?? ti('settings.speech_output.voice_catalog_hint')
                : ti('settings.speech_output.voice_catalog_hint')
            })()}
          </p>
        </>
      ) : null}

      {showCustomVoiceInput && !isEdgeTtsSpeechOutput ? (
        <label>
          <span>{speechOutputVoiceLabel}</span>
          <input
            value={draft.speechOutputVoice}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                voice: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      {speechVoiceStatus ? (
        <div className={speechVoiceStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {speechVoiceStatus.message}
        </div>
      ) : null}

      {speechOutputStyleOptions.length ? (
        <>
          <label>
            <span>{ti('settings.speech_output.style')}</span>
            <select
              value={speechOutputStyleOptions.some((opt) => opt.value === draft.speechOutputInstructions)
                ? draft.speechOutputInstructions
                : ''}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  instructions: event.target.value,
                }))
              }
            >
              {speechOutputStyleOptions.map((opt) => (
                <option key={opt.value || '__default__'} value={opt.value}>{ti(opt.label as TranslationKey)}</option>
              ))}
            </select>
          </label>
          <p className="settings-drawer__hint">
            {(() => {
              const currentStyle = speechOutputStyleOptions.find((opt) => opt.value === draft.speechOutputInstructions)
              return currentStyle?.description
                ? ti(currentStyle.description as TranslationKey)
                : ti('settings.speech_output.style_hint')
            })()}
          </p>
        </>
      ) : null}

      <label>
        <span>{ti('settings.speech_output.speech_lang')}</span>
        <input
          value={draft.speechSynthesisLang}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechSynthesisLang: event.target.value,
            }))
          }
        />
      </label>

      <div className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>{ti('settings.speech_output.tuning_title')}</h5>
            <p className="settings-drawer__hint">{ti(speechOutputAdjustmentSupport.note as TranslationKey)}</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                speechRate: 0.92,
                speechPitch: 1.08,
                speechVolume: 1,
              }))
            }
          >
            {ti('settings.speech_output.restore_defaults')}
          </button>
        </div>

        <div className="settings-tts-tuning">
          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.rate ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>{ti('settings.speech_output.rate')}</strong>
              <span>{formatTtsAdjustmentValue('rate', draft.speechRate)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechRate}
                disabled={!speechOutputAdjustmentSupport.rate}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechRate: clampNumber(parseNumberInput(event.target.value, prev.speechRate), 0.5, 2),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechRate}
                disabled={!speechOutputAdjustmentSupport.rate}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechRate: clampNumber(parseNumberInput(event.target.value, prev.speechRate), 0.5, 2),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.rate
                ? ti('settings.speech_output.rate_hint')
                : ti('settings.speech_output.rate_disabled_hint')}
            </p>
          </div>

          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.pitch ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>{ti('settings.speech_output.pitch')}</strong>
              <span>{formatTtsAdjustmentValue('pitch', draft.speechPitch)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechPitch}
                disabled={!speechOutputAdjustmentSupport.pitch}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechPitch: clampNumber(parseNumberInput(event.target.value, prev.speechPitch), 0.5, 2),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechPitch}
                disabled={!speechOutputAdjustmentSupport.pitch}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechPitch: clampNumber(parseNumberInput(event.target.value, prev.speechPitch), 0.5, 2),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.pitch
                ? ti('settings.speech_output.pitch_hint')
                : ti('settings.speech_output.pitch_disabled_hint')}
            </p>
          </div>

          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.volume ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>{ti('settings.speech_output.volume')}</strong>
              <span>{formatTtsAdjustmentValue('volume', draft.speechVolume)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={draft.speechVolume}
                disabled={!speechOutputAdjustmentSupport.volume}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechVolume: clampNumber(parseNumberInput(event.target.value, prev.speechVolume), 0, 1),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={draft.speechVolume}
                disabled={!speechOutputAdjustmentSupport.volume}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechVolume: clampNumber(parseNumberInput(event.target.value, prev.speechVolume), 0, 1),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.volume
                ? ti('settings.speech_output.volume_hint')
                : ti('settings.speech_output.volume_disabled_hint')}
            </p>
          </div>
        </div>
      </div>

      <label>
        <span>{ti('settings.speech_output.preview_text')}</span>
        <textarea
          rows={3}
          value={speechPreviewText}
          onChange={(event) => setSpeechPreviewText(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="ghost-button"
        onClick={onPreviewSpeech}
        disabled={previewingSpeech}
      >
        {previewingSpeech
          ? ti('settings.speech_output.previewing')
          : ti('settings.speech_output.preview')}
      </button>

      {speechPreviewStatus ? (
        <div className={speechPreviewStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {speechPreviewStatus.message}
        </div>
      ) : null}

      {renderSpeechOutputTestResult()}
    </section>
  )
})
