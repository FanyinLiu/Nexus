import { memo, type Dispatch, type SetStateAction } from 'react'
import {
  getWebSearchProviderPreset,
  resolveWebSearchApiBaseUrl,
  WEB_SEARCH_PROVIDER_PRESETS,
} from '../../lib/webSearchProviders'
import { displaySecretInputValue } from '../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { ToggleField } from '../settingsFields'
import type { AppSettings } from '../../types'
import { UrlInput } from './UrlInput'

type ToolsSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export const ToolsSection = memo(function ToolsSection({
  active,
  draft,
  setDraft,
}: ToolsSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const webSearchProvider = getWebSearchProviderPreset(draft.toolWebSearchProviderId)
  const webSearchApiKeyInputValue = displaySecretInputValue(draft.toolWebSearchApiKey)

  function applyWebSearchProviderPreset(providerId: string) {
    const preset = getWebSearchProviderPreset(providerId)

    setDraft((prev) => ({
      ...prev,
      toolWebSearchProviderId: preset.id,
      toolWebSearchApiBaseUrl: resolveWebSearchApiBaseUrl(preset.id, prev.toolWebSearchApiBaseUrl),
      toolWebSearchApiKey: preset.id === prev.toolWebSearchProviderId
        ? prev.toolWebSearchApiKey
        : '',
    }))
  }

  return (
    <section className={`settings-section settings-tools-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-control-grid">
        <div className="settings-control-card">
          <ToggleField
            label={ti('settings.tools.web_search')}
            field="toolWebSearchEnabled"
            draft={draft}
            setDraft={setDraft}
          />
          <p>{ti('settings.tools.web_search_hint')}</p>
        </div>

        <div className="settings-control-card">
          <ToggleField
            label={ti('settings.tools.weather')}
            field="toolWeatherEnabled"
            draft={draft}
            setDraft={setDraft}
          />
          <p>{ti('settings.tools.weather_hint')}</p>
        </div>

        <div className="settings-control-card">
          <ToggleField
            label={ti('settings.tools.open_external')}
            field="toolOpenExternalEnabled"
            draft={draft}
            setDraft={setDraft}
          />
          <p>{ti('settings.tools.open_external_hint')}</p>
        </div>

        <div className="settings-control-card">
          <ToggleField
            label={ti('settings.tools.confirm_before_open')}
            field="toolOpenExternalRequiresConfirmation"
            disabled={!draft.toolOpenExternalEnabled}
            draft={draft}
            setDraft={setDraft}
          />
          <p>{ti('settings.tools.confirm_before_open_hint')}</p>
        </div>
      </div>

      <div className="settings-mini-group">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.tools.backend_title')}</h5>
          <span>{ti('settings.tools.backend_hint')}</span>
        </div>

        <label className="settings-control-card settings-tools-field">
          <span>{ti('settings.tools.search_provider')}</span>
          <select
            value={draft.toolWebSearchProviderId}
            onChange={(event) => applyWebSearchProviderPreset(event.target.value)}
            disabled={!draft.toolWebSearchEnabled}
          >
            {WEB_SEARCH_PROVIDER_PRESETS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-mini-group__note settings-tools-note">
          {ti(webSearchProvider.descriptionKey)}
          {webSearchProvider.baseUrl
            ? ` ${ti('settings.tools.default_url')}${webSearchProvider.baseUrl}`
            : ''}
        </p>

        <label className="settings-control-card settings-tools-field">
          <span>{ti('settings.tools.api_base_url')}</span>
          <UrlInput
            uiLanguage={draft.uiLanguage}
            value={draft.toolWebSearchApiBaseUrl}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                toolWebSearchApiBaseUrl: event.target.value,
              }))
            }
            placeholder={webSearchProvider.baseUrl || ti('settings.tools.not_required')}
            disabled={!draft.toolWebSearchEnabled || !webSearchProvider.supportsBaseUrlOverride}
          />
        </label>

        <label className="settings-control-card settings-tools-field">
          <span>{ti('settings.tools.api_key')}</span>
          <input
            type="password"
            value={webSearchApiKeyInputValue}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                toolWebSearchApiKey: event.target.value,
              }))
            }
            placeholder={webSearchProvider.apiKeyPlaceholder || ti('settings.tools.not_required')}
            disabled={!draft.toolWebSearchEnabled || !webSearchProvider.requiresApiKey}
          />
        </label>

        <div className="settings-control-card settings-tools-control">
          <label className="settings-toggle">
            <span>{ti('settings.tools.fallback_bing')}</span>
            <input
              type="checkbox"
              checked={draft.toolWebSearchFallbackToBing}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  toolWebSearchFallbackToBing: event.target.checked,
                }))
              }
              disabled={!draft.toolWebSearchEnabled}
            />
          </label>
        </div>
      </div>

      <div className="settings-mini-group">
        <label className="settings-control-card settings-tools-field">
          <span>{ti('settings.tools.weather_location')}</span>
          <input
            value={draft.toolWeatherDefaultLocation}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                toolWeatherDefaultLocation: event.target.value,
              }))
            }
            placeholder={ti('settings.tools.weather_location_placeholder')}
            disabled={!draft.toolWeatherEnabled}
          />
        </label>
        <p className="settings-mini-group__note settings-tools-note">
          {ti('settings.tools.weather_location_hint')}
        </p>
      </div>
    </section>
  )
})
