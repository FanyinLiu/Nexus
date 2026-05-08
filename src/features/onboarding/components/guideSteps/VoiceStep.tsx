import {
  type SpeechModelOption,
  isSenseVoiceSpeechInputProvider,
  isSpeechOutputKeyless,
  USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS,
  USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS,
} from '../../../../lib/audioProviders'
import {
  updateCurrentSpeechInputProviderProfile,
  updateCurrentSpeechOutputProviderProfile,
} from '../../../../lib/speechProviderProfiles'
import { displaySecretInputValue } from '../../../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import type { AppSettings, SpeechVoiceOption, TranslationKey } from '../../../../types'
import { LocalVoiceModelsStatus } from './LocalVoiceModelsStatus'
import type { OnboardingDraftSetter } from './types'

type VoiceStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
  speechInputProvider: {
    notes: string
  }
  speechOutputProvider: {
    notes: string
  }
  speechInputModelOptions: SpeechModelOption[]
  speechOutputModelOptions: SpeechModelOption[]
  speechOutputVoiceOptions: SpeechVoiceOption[]
  isVolcengineSpeechOutput: boolean
  onApplySpeechInputPreset: (providerId: string) => void
  onApplySpeechOutputPreset: (providerId: string) => void
}

function buildResolvedVoiceLabel(
  voice: SpeechVoiceOption,
  ti: (key: TranslationKey) => string,
): string {
  const base = ti(voice.label as TranslationKey)
  return voice.needsAuth
    ? `${base} ${ti('provider.tts.voice.volcengine.needs_auth_suffix')}`
    : base
}

export function VoiceStep({
  draft,
  setDraft,
  speechInputProvider,
  speechOutputProvider,
  speechInputModelOptions,
  speechOutputModelOptions,
  speechOutputVoiceOptions,
  isVolcengineSpeechOutput,
  onApplySpeechInputPreset,
  onApplySpeechOutputPreset,
}: VoiceStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <LocalVoiceModelsStatus uiLanguage={draft.uiLanguage} />

      <div className="onboarding-grid onboarding-grid--two">
        <label className="onboarding-toggle">
          <span>{ti('onboarding.voice.enable_input')}</span>
          <input
            type="checkbox"
            checked={draft.speechInputEnabled}
            onChange={(event) => setDraft((current) => ({
              ...current,
              speechInputEnabled: event.target.checked,
            }))}
          />
        </label>

        <label className="onboarding-toggle">
          <span>{ti('onboarding.voice.enable_output')}</span>
          <input
            type="checkbox"
            checked={draft.speechOutputEnabled}
            onChange={(event) => setDraft((current) => ({
              ...current,
              speechOutputEnabled: event.target.checked,
            }))}
          />
        </label>
      </div>

      {draft.speechInputEnabled ? (
        <div className="onboarding-subsection">
          <strong>{ti('onboarding.voice.input_heading')}</strong>
          <label>
            <span>{ti('onboarding.voice.input_provider')}</span>
            <select
              value={draft.speechInputProviderId}
              onChange={(event) => onApplySpeechInputPreset(event.target.value)}
            >
              {USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {ti(provider.label as TranslationKey)}
                </option>
              ))}
            </select>
          </label>

          <p className="onboarding-tip">{ti(speechInputProvider.notes as TranslationKey)}</p>

          {!isSenseVoiceSpeechInputProvider(draft.speechInputProviderId) ? (
            <div className="onboarding-grid onboarding-grid--two">
              <label>
                <span>{ti('onboarding.voice.input_api_base')}</span>
                <input
                  value={draft.speechInputApiBaseUrl}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechInputProviderProfile(
                    current,
                    {
                      apiBaseUrl: event.target.value,
                    },
                  ))}
                />
              </label>

              <label>
                <span>{ti('onboarding.voice.input_api_key')}</span>
                <input
                  type="password"
                  value={displaySecretInputValue(draft.speechInputApiKey)}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechInputProviderProfile(
                    current,
                    {
                      apiKey: event.target.value,
                    },
                  ))}
                />
              </label>
            </div>
          ) : null}

          <div className="onboarding-grid onboarding-grid--two">
            <label>
              <span>{ti('onboarding.voice.input_model')}</span>
              {speechInputModelOptions.length ? (
                <select
                  value={draft.speechInputModel}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechInputProviderProfile(
                    current,
                    {
                      model: event.target.value,
                    },
                  ))}
                >
                  {speechInputModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {ti(option.label as TranslationKey)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.speechInputModel}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechInputProviderProfile(
                    current,
                    {
                      model: event.target.value,
                    },
                  ))}
                />
              )}
            </label>

            <label>
              <span>{ti('onboarding.voice.recognition_lang')}</span>
              <input
                value={draft.speechRecognitionLang}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  speechRecognitionLang: event.target.value,
                }))}
              />
            </label>
          </div>
        </div>
      ) : null}

      {draft.speechOutputEnabled ? (
        <div className="onboarding-subsection">
          <strong>{ti('onboarding.voice.output_heading')}</strong>
          <label>
            <span>{ti('onboarding.voice.output_provider')}</span>
            <select
              value={draft.speechOutputProviderId}
              onChange={(event) => onApplySpeechOutputPreset(event.target.value)}
            >
              {USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {ti(provider.label as TranslationKey)}
                </option>
              ))}
            </select>
          </label>

          <p className="onboarding-tip">{ti(speechOutputProvider.notes as TranslationKey)}</p>

          {!isSpeechOutputKeyless(draft.speechOutputProviderId) ? (
            <div className="onboarding-grid onboarding-grid--two">
              <label>
                <span>{ti('onboarding.voice.output_api_base')}</span>
                <input
                  value={draft.speechOutputApiBaseUrl}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                    current,
                    {
                      apiBaseUrl: event.target.value,
                    },
                  ))}
                />
              </label>

              <label>
                <span>{isVolcengineSpeechOutput ? ti('onboarding.voice.output_api_key_volcano') : ti('onboarding.voice.output_api_key')}</span>
                <input
                  type="password"
                  value={displaySecretInputValue(draft.speechOutputApiKey)}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                    current,
                    {
                      apiKey: event.target.value,
                    },
                  ))}
                />
              </label>
            </div>
          ) : null}

          <div className="onboarding-grid onboarding-grid--two">
            <label>
              <span>{isVolcengineSpeechOutput ? ti('onboarding.voice.output_model_volcano') : ti('onboarding.voice.output_model')}</span>
              {speechOutputModelOptions.length ? (
                <select
                  value={draft.speechOutputModel}
                  onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                    current,
                    {
                      model: event.target.value,
                    },
                  ))}
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
                  onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                    current,
                    {
                      model: event.target.value,
                    },
                  ))}
                />
              )}
            </label>

            <label>
              <span>{ti('onboarding.voice.synthesis_lang')}</span>
              <input
                value={draft.speechSynthesisLang}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  speechSynthesisLang: event.target.value,
                }))}
              />
            </label>
          </div>

          {isVolcengineSpeechOutput ? (
            <p className="onboarding-tip">
              {ti('onboarding.voice.volcano_hint')}
            </p>
          ) : null}

          <label>
            <span>{isVolcengineSpeechOutput ? ti('onboarding.voice.voice_label_volcano') : ti('onboarding.voice.voice_label')}</span>
            {speechOutputVoiceOptions.length ? (
              <select
                value={draft.speechOutputVoice}
                onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                  current,
                  {
                    voice: event.target.value,
                  },
                ))}
              >
                {speechOutputVoiceOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {buildResolvedVoiceLabel(voice, ti)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechOutputVoice}
                onChange={(event) => setDraft((current) => updateCurrentSpeechOutputProviderProfile(
                  current,
                  {
                    voice: event.target.value,
                  },
                ))}
              />
            )}
          </label>
        </div>
      ) : null}
    </div>
  )
}
