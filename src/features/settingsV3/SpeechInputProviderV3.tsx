import { memo, type Dispatch, type SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  parseVolcengineCredentialParts,
  type VolcengineCredentialParts,
} from '../../components/settingsDrawerSupport'
import { UrlInput } from '../../components/settingsSections/UrlInput'
import {
  getSpeechInputModelOptions,
  getSpeechInputProviderPreset,
  isSenseVoiceSpeechInputProvider,
  isSpeechInputLocal,
  isVolcengineSpeechInputProvider,
} from '../../lib/audioProviders'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge'
import { getPlatformDependencyHint, isVoiceSpeechInputAvailable } from '../../lib/platformProfile'
import { SPEECH_INPUT_PROVIDERS } from '../../lib/speechProviderCatalog'
import {
  switchSpeechInputProvider,
  updateCurrentSpeechInputProviderProfile,
} from '../../lib/speechProviderProfiles'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  PlatformProfile,
  ServiceConnectionCapability,
  TranslationKey,
} from '../../types'
import {
  SettingsV3ConnectionEvidence,
  type SettingsV3ConnectionEvidenceValue,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'

type SpeechInputProviderV3Props = {
  draft: AppSettings
  platformProfile: PlatformProfile
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  onRunConnectionTest: () => void
  connectionEvidence: SettingsV3ConnectionEvidenceValue | null
}

const providerOptions = SPEECH_INPUT_PROVIDERS
  .filter((provider) => !provider.hidden)
  .map((provider) => ({ id: provider.id, label: provider.label }))

export const SpeechInputProviderV3 = memo(function SpeechInputProviderV3({
  draft,
  platformProfile,
  setDraft,
  testingTarget,
  onRunConnectionTest,
  connectionEvidence,
}: SpeechInputProviderV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(draft.uiLanguage, key)
  const tiParam = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)
  const provider = getSpeechInputProviderPreset(draft.speechInputProviderId)
  const modelOptions = getSpeechInputModelOptions(draft.speechInputProviderId)
  const isSenseVoice = isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
  const isLocal = isSpeechInputLocal(draft.speechInputProviderId)
  const isVolcengine = isVolcengineSpeechInputProvider(draft.speechInputProviderId)
  const showEndpoint = !isLocal || Boolean(provider.baseUrl)
  const showCredentials = !isLocal
  const secretIsVaultRef = isVaultRefString(draft.speechInputApiKey)
  const secretValue = displaySecretInputValue(draft.speechInputApiKey)
  const volcengineCredentials = secretIsVaultRef
    ? ({ appId: '', accessToken: '' } satisfies VolcengineCredentialParts)
    : parseVolcengineCredentialParts(draft.speechInputApiKey)
  const available = isVoiceSpeechInputAvailable(platformProfile)
  const platformReason = getPlatformDependencyHint(
    platformProfile,
    platformProfile.voice.speechInputSupported,
    platformProfile.voice.speechInputAvailable,
    platformProfile.voice.dependencyHint,
  )
  const platformHint = platformReason === 'unsupported'
    ? ti('settings.platform.unsupported')
    : platformReason === 'unavailable'
      ? ti('settings.platform.unavailable')
      : platformReason
        ? tiParam('settings.platform.unavailable_dependency', { dependency: platformReason })
        : null

  const updateProfile = (patch: Parameters<typeof updateCurrentSpeechInputProviderProfile>[1]) => {
    setDraft((current) => updateCurrentSpeechInputProviderProfile(current, patch))
  }
  const updateVolcengineCredential = (patch: Partial<VolcengineCredentialParts>) => {
    setDraft((current) => {
      const parts = parseVolcengineCredentialParts(current.speechInputApiKey)
      return updateCurrentSpeechInputProviderProfile(current, {
        apiKey: buildVolcengineCredential({ ...parts, ...patch }),
      })
    })
  }

  return (
    <div className="settings-v3-provider">
      <SettingsV3Toolbar>
        <button
          type="button"
          onClick={onRunConnectionTest}
          disabled={testingTarget === 'speech-input' || !available}
        >
          {testingTarget === 'speech-input' ? ti('settings.speech_input.testing') : ti('settings.speech_input.test')}
        </button>
      </SettingsV3Toolbar>

      {platformHint ? <SettingsV3Notice tone="warning" title={platformHint} /> : null}

      <div className="settings-v3-editor settings-v3-provider__fields">
        <SettingsV3Field label={ti('settings.speech_input.provider')}>
          <select
            value={draft.speechInputProviderId}
            onChange={(event) => setDraft((current) => switchSpeechInputProvider(current, event.target.value))}
          >
            {providerOptions.map((option) => (
              <option key={option.id} value={option.id}>{ti(option.label)}</option>
            ))}
          </select>
        </SettingsV3Field>

        <SettingsV3Notice
          title={ti(provider.notes as TranslationKey)}
        >
          {`${provider.baseUrl ? `${ti('settings.speech_input.default_endpoint')}${provider.baseUrl} ` : ''}${provider.defaultModel ? `${ti('settings.speech_input.default_model')}${provider.defaultModel}` : ''}`.trim() || undefined}
        </SettingsV3Notice>

        {showEndpoint ? (
          <SettingsV3Field label={ti('settings.speech_input.endpoint_url')}>
            <UrlInput
              uiLanguage={draft.uiLanguage}
              value={draft.speechInputApiBaseUrl}
              onChange={(event) => updateProfile({ apiBaseUrl: event.target.value })}
            />
          </SettingsV3Field>
        ) : null}

        {showCredentials && isVolcengine ? (
          <div className="settings-v3-provider__grid">
            <SettingsV3Field label={ti('settings.speech_input.volcengine_app_id')}>
              <input
                value={volcengineCredentials.appId}
                placeholder={secretIsVaultRef ? '********' : undefined}
                onChange={(event) => updateVolcengineCredential({ appId: event.target.value })}
              />
            </SettingsV3Field>
            <SettingsV3Field
              label={ti('settings.speech_input.volcengine_token')}
              hint={ti('settings.speech_input.volcengine_credential_hint')}
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
        ) : showCredentials ? (
          <SettingsV3Field label={ti('settings.speech_input.api_key')}>
            <input
              type="password"
              autoComplete="off"
              value={secretValue}
              placeholder={secretIsVaultRef ? '********' : undefined}
              onChange={(event) => updateProfile({ apiKey: event.target.value })}
            />
          </SettingsV3Field>
        ) : null}

        <SettingsV3Field
          label={isSenseVoice ? ti('settings.speech_input.sense_voice_model') : ti('settings.speech_input.model')}
          hint={isSenseVoice ? ti('settings.speech_input.sense_voice_hint') : undefined}
        >
          {modelOptions.length ? (
            <select value={draft.speechInputModel} onChange={(event) => updateProfile({ model: event.target.value })}>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{ti(option.label as TranslationKey)}</option>
              ))}
            </select>
          ) : (
            <input value={draft.speechInputModel} onChange={(event) => updateProfile({ model: event.target.value })} />
          )}
        </SettingsV3Field>

        <SettingsV3Field label={ti('settings.speech_input.recognition_lang')}>
          <input
            value={draft.speechRecognitionLang}
            onChange={(event) => setDraft((current) => ({ ...current, speechRecognitionLang: event.target.value }))}
          />
        </SettingsV3Field>

        {draft.speechInputProviderId === 'zhipu-stt' ? (
          <SettingsV3Field
            label={ti('settings.speech_input.hotwords')}
            hint={ti('settings.speech_input.hotwords_hint')}
          >
            <input
              value={draft.speechInputHotwords}
              placeholder={ti('settings.speech_input.hotwords_placeholder')}
              onChange={(event) => setDraft((current) => ({ ...current, speechInputHotwords: event.target.value }))}
            />
          </SettingsV3Field>
        ) : null}
      </div>

      <SettingsV3ConnectionEvidence evidence={connectionEvidence} />
    </div>
  )
})
