import {
  type SpeechModelOption,
  isLocalSherpaSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS,
  USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS,
} from '../../../../lib/audioProviders'
import {
  updateCurrentSpeechInputProviderProfile,
  updateCurrentSpeechOutputProviderProfile,
} from '../../../../lib/speechProviderProfiles'
import type { AppSettings, SpeechVoiceOption } from '../../../../types'
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
  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <div className="onboarding-grid onboarding-grid--two">
        <label className="onboarding-toggle">
          <span>启用语音输入</span>
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
          <span>启用语音输出</span>
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
          <strong>语音输入</strong>
          <label>
            <span>输入方案</span>
            <select
              value={draft.speechInputProviderId}
              onChange={(event) => onApplySpeechInputPreset(event.target.value)}
            >
              {USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <p className="onboarding-tip">{speechInputProvider.notes}</p>

          {!isLocalSherpaSpeechInputProvider(draft.speechInputProviderId) && !isSenseVoiceSpeechInputProvider(draft.speechInputProviderId) ? (
            <div className="onboarding-grid onboarding-grid--two">
              <label>
                <span>输入接口地址</span>
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
                <span>输入密钥</span>
                <input
                  type="password"
                  value={draft.speechInputApiKey}
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
              <span>输入模型</span>
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
                      {option.label}
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
              <span>识别语言</span>
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
          <strong>语音输出</strong>
          <label>
            <span>输出方案</span>
            <select
              value={draft.speechOutputProviderId}
              onChange={(event) => onApplySpeechOutputPreset(event.target.value)}
            >
              {USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <p className="onboarding-tip">{speechOutputProvider.notes}</p>

          {draft.speechOutputProviderId !== 'local-qwen3-tts' ? (
            <div className="onboarding-grid onboarding-grid--two">
              <label>
                <span>输出接口地址</span>
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
                <span>{isVolcengineSpeechOutput ? '输出密钥（APP_ID:ACCESS_TOKEN）' : '输出密钥'}</span>
                <input
                  type="password"
                  value={draft.speechOutputApiKey}
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
              <span>{isVolcengineSpeechOutput ? '业务集群' : '输出模型'}</span>
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
                      {option.label}
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
              <span>播报语言</span>
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
              火山 TTS 的“输出模型”实际填写的是业务集群。建议先用 `volcano_tts`，音色先试 `BV001_streaming`，最适合拿来验证链路是否打通。
            </p>
          ) : null}

          {draft.speechOutputProviderId !== 'local-qwen3-tts' ? (
            <label>
              <span>{isVolcengineSpeechOutput ? '音色类型' : '音色 / 音色 ID'}</span>
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
                      {voice.label}
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
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
