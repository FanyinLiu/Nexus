import { memo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  parseVolcengineCredentialParts,
  type VolcengineCredentialParts,
} from '../settingsDrawerSupport'
import {
  getSpeechInputModelOptions,
  getSpeechInputProviderPreset,
  isSenseVoiceSpeechInputProvider,
  isSpeechInputLocal,
  isVolcengineSpeechInputProvider,
} from '../../lib/audioProviders'
import { SPEECH_INPUT_PROVIDERS } from '../../lib/providerCatalog'
import {
  switchSpeechInputProvider,
  updateCurrentSpeechInputProviderProfile,
} from '../../lib/speechProviderProfiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, ServiceConnectionCapability, TranslationKey } from '../../types'
import { UrlInput } from './UrlInput'

const speechInputSelectOptions = SPEECH_INPUT_PROVIDERS
  .filter((p) => !p.hidden)
  .map((p) => ({ id: p.id, label: p.label }))

type SpeechInputSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  onRunSpeechInputConnectionTest: () => void
  renderSpeechInputTestResult: () => ReactNode
}

export const SpeechInputSection = memo(function SpeechInputSection({
  active,
  draft,
  setDraft,
  testingTarget,
  onRunSpeechInputConnectionTest,
  renderSpeechInputTestResult,
}: SpeechInputSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const speechInputProvider = getSpeechInputProviderPreset(draft.speechInputProviderId)
  const speechInputModelOptions = getSpeechInputModelOptions(draft.speechInputProviderId)
  const isSenseVoiceSpeechInput = isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
  const isLocalSpeechInput = isSpeechInputLocal(draft.speechInputProviderId)
  const isVolcengineSpeechInput = isVolcengineSpeechInputProvider(draft.speechInputProviderId)
  const showSpeechInputBaseUrl = !isLocalSpeechInput || !!speechInputProvider.baseUrl
  const showSpeechInputCredentials = !isLocalSpeechInput
  const speechInputVolcengineCredentials = parseVolcengineCredentialParts(draft.speechInputApiKey)
  const speechInputModelLabel = isSenseVoiceSpeechInput
    ? ti('settings.speech_input.sense_voice_model')
    : ti('settings.speech_input.model')
  const speechInputModelHint = isSenseVoiceSpeechInput
    ? ti('settings.speech_input.sense_voice_hint')
    : ''

  function applySpeechInputPreset(providerId: string) {
    setDraft((prev) => switchSpeechInputProvider(prev, providerId))
  }

  function updateSpeechInputVolcengineCredential(partial: Partial<VolcengineCredentialParts>) {
    setDraft((prev) => {
      const current = parseVolcengineCredentialParts(prev.speechInputApiKey)
      return updateCurrentSpeechInputProviderProfile(prev, {
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
          <h4>{ti('settings.speech_input.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.speech_input.hint')}
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunSpeechInputConnectionTest}
          disabled={testingTarget === 'speech-input'}
        >
          {testingTarget === 'speech-input'
            ? ti('settings.speech_input.testing')
            : ti('settings.speech_input.test')}
        </button>
      </div>

      <label>
        <span>{ti('settings.speech_input.provider')}</span>
        <select
          value={draft.speechInputProviderId}
          onChange={(event) => applySpeechInputPreset(event.target.value)}
        >
          {speechInputSelectOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{ti(opt.label)}</option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {ti(speechInputProvider.notes as TranslationKey)}
        {speechInputProvider.baseUrl
          ? ` ${ti('settings.speech_input.default_endpoint')}${speechInputProvider.baseUrl}`
          : ''}
        {speechInputProvider.defaultModel
          ? `${ti('settings.speech_input.default_model')}${speechInputProvider.defaultModel}`
          : ''}
      </p>

      {showSpeechInputBaseUrl ? (
        <label>
          <span>{ti('settings.speech_input.endpoint_url')}</span>
          <UrlInput
            value={draft.speechInputApiBaseUrl}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                apiBaseUrl: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      {showSpeechInputCredentials && isVolcengineSpeechInput ? (
        <>
          <div className="settings-grid settings-grid--two">
            <label>
              <span>{ti('settings.speech_input.volcengine_app_id')}</span>
              <input
                value={speechInputVolcengineCredentials.appId}
                onChange={(event) =>
                  updateSpeechInputVolcengineCredential({
                    appId: event.target.value,
                  })
                }
              />
            </label>

            <label>
              <span>{ti('settings.speech_input.volcengine_token')}</span>
              <input
                type="password"
                value={speechInputVolcengineCredentials.accessToken}
                onChange={(event) =>
                  updateSpeechInputVolcengineCredential({
                    accessToken: event.target.value,
                  })
                }
              />
            </label>
          </div>

          <p className="settings-drawer__hint">
            {ti('settings.speech_input.volcengine_credential_hint')}
          </p>
        </>
      ) : showSpeechInputCredentials ? (
        <label>
          <span>{ti('settings.speech_input.api_key')}</span>
          <input
            type="password"
            value={draft.speechInputApiKey}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                apiKey: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      <label>
        <span>{speechInputModelLabel}</span>
        {speechInputModelOptions.length ? (
          <select
            value={draft.speechInputModel}
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                model: event.target.value,
              }))
            }
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
            onChange={(event) =>
              setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                model: event.target.value,
              }))
            }
          />
        )}
      </label>

      {speechInputModelHint ? (
        <p className="settings-drawer__hint">{speechInputModelHint}</p>
      ) : null}

      <label>
        <span>{ti('settings.speech_input.recognition_lang')}</span>
        <input
          value={draft.speechRecognitionLang}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechRecognitionLang: event.target.value,
            }))
          }
        />
      </label>

      {draft.speechInputProviderId === 'zhipu-stt' ? (
        <label>
          <span>{ti('settings.speech_input.hotwords')}</span>
          <input
            value={draft.speechInputHotwords}
            placeholder={ti('settings.speech_input.hotwords_placeholder')}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                speechInputHotwords: event.target.value,
              }))
            }
          />
          <p className="settings-drawer__hint">
            {ti('settings.speech_input.hotwords_hint')}
          </p>
        </label>
      ) : null}

      {renderSpeechInputTestResult()}
    </section>
  )
})
