import { memo, type Dispatch, type SetStateAction } from 'react'
import {
  getWebSearchProviderPreset,
  resolveWebSearchApiBaseUrl,
  WEB_SEARCH_PROVIDER_PRESETS,
} from '../../lib/webSearchProviders'
import { displaySecretInputValue } from '../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings } from '../../types'
import { SettingsV3Disclosure, SettingsV3Field, SettingsV3Notice, SettingsV3Page, SettingsV3Row, SettingsV3Section, SettingsV3Switch } from './SettingsV3Primitives'

type ToolsSectionV3Props = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export const ToolsSectionV3 = memo(function ToolsSectionV3({ active, draft, setDraft }: ToolsSectionV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(draft.uiLanguage, key)
  const provider = getWebSearchProviderPreset(draft.toolWebSearchProviderId)
  const storedKey = draft.toolWebSearchApiKey.startsWith('vault://')

  const applyProvider = (providerId: string) => {
    const nextProvider = getWebSearchProviderPreset(providerId)
    setDraft((current) => ({
      ...current,
      toolWebSearchProviderId: nextProvider.id,
      toolWebSearchApiBaseUrl: resolveWebSearchApiBaseUrl(nextProvider.id, current.toolWebSearchApiBaseUrl),
      toolWebSearchApiKey: nextProvider.id === current.toolWebSearchProviderId ? current.toolWebSearchApiKey : '',
    }))
  }

  return (
    <SettingsV3Page className={active ? '' : 'is-hidden'}>
      <SettingsV3Section title={ti('settings.section.tools')} hideHeader>
        <SettingsV3Row icon="external-link" label={ti('settings.tools.web_search')} hint={ti('settings.tools.web_search_hint')}>
          <SettingsV3Switch
            label={ti('settings.tools.web_search')}
            checked={draft.toolWebSearchEnabled}
            onChange={(toolWebSearchEnabled) => setDraft((current) => ({ ...current, toolWebSearchEnabled }))}
          />
        </SettingsV3Row>
        <SettingsV3Row icon="sparkles" label={ti('settings.tools.weather')} hint={ti('settings.tools.weather_hint')}>
          <SettingsV3Switch
            label={ti('settings.tools.weather')}
            checked={draft.toolWeatherEnabled}
            onChange={(toolWeatherEnabled) => setDraft((current) => ({ ...current, toolWeatherEnabled }))}
          />
        </SettingsV3Row>
        <SettingsV3Row icon="external-link" label={ti('settings.tools.open_external')} hint={ti('settings.tools.open_external_hint')}>
          <SettingsV3Switch
            label={ti('settings.tools.open_external')}
            checked={draft.toolOpenExternalEnabled}
            onChange={(toolOpenExternalEnabled) => setDraft((current) => ({ ...current, toolOpenExternalEnabled }))}
          />
        </SettingsV3Row>
        <SettingsV3Row
          icon="tuning"
          label={ti('settings.tools.confirm_before_open')}
          hint={draft.toolOpenExternalEnabled ? ti('settings.tools.confirm_before_open_hint') : ti('settings.tools.open_external_hint')}
          disabled={!draft.toolOpenExternalEnabled}
        >
          <SettingsV3Switch
            label={ti('settings.tools.confirm_before_open')}
            checked={draft.toolOpenExternalRequiresConfirmation}
            disabled={!draft.toolOpenExternalEnabled}
            onChange={(toolOpenExternalRequiresConfirmation) => setDraft((current) => ({ ...current, toolOpenExternalRequiresConfirmation }))}
          />
        </SettingsV3Row>
      </SettingsV3Section>

      {!draft.toolOpenExternalRequiresConfirmation && draft.toolOpenExternalEnabled ? (
        <SettingsV3Notice tone="warning" title={ti('settings.tools.confirm_before_open')}>
          {ti('settings.tools.confirm_before_open_hint')}
        </SettingsV3Notice>
      ) : null}

      {draft.toolWeatherEnabled ? (
        <SettingsV3Section title={ti('settings.tools.weather')} description={ti('settings.tools.weather_location_hint')}>
          <div className="settings-v3-editor">
            <SettingsV3Field label={ti('settings.tools.weather_location')} hint={ti('settings.tools.weather_location_hint')}>
              <input
                value={draft.toolWeatherDefaultLocation}
                placeholder={ti('settings.tools.weather_location_placeholder')}
                onChange={(event) => setDraft((current) => ({ ...current, toolWeatherDefaultLocation: event.target.value }))}
              />
            </SettingsV3Field>
          </div>
          <SettingsV3Notice title={ti('settings.tools.weather_privacy_title')}>
            {ti('settings.tools.weather_privacy_note')}
          </SettingsV3Notice>
        </SettingsV3Section>
      ) : null}

      <SettingsV3Disclosure title={ti('settings.tools.backend_title')} description={ti('settings.tools.backend_hint')}>
        <SettingsV3Field label={ti('settings.tools.search_provider')} hint={ti(provider.descriptionKey)}>
          <select value={draft.toolWebSearchProviderId} disabled={!draft.toolWebSearchEnabled} onChange={(event) => applyProvider(event.target.value)}>
            {WEB_SEARCH_PROVIDER_PRESETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.tools.api_base_url')} hint={provider.baseUrl ? `${ti('settings.tools.default_url')}${provider.baseUrl}` : ti('settings.tools.not_required')}>
          <input
            type="url"
            value={draft.toolWebSearchApiBaseUrl}
            placeholder={provider.baseUrl || ti('settings.tools.not_required')}
            disabled={!draft.toolWebSearchEnabled || !provider.supportsBaseUrlOverride}
            onChange={(event) => setDraft((current) => ({ ...current, toolWebSearchApiBaseUrl: event.target.value }))}
          />
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.tools.api_key')} hint={storedKey ? ti('settings.tools.backend_hint') : ti('settings.tools.not_required')}>
          <input
            type="password"
            value={displaySecretInputValue(draft.toolWebSearchApiKey)}
            placeholder={storedKey ? '••••••••' : provider.apiKeyPlaceholder || ti('settings.tools.not_required')}
            disabled={!draft.toolWebSearchEnabled || !provider.requiresApiKey}
            onChange={(event) => setDraft((current) => ({ ...current, toolWebSearchApiKey: event.target.value }))}
          />
        </SettingsV3Field>
        <SettingsV3Row label={ti('settings.tools.fallback_bing')} hint={ti('settings.tools.backend_hint')} disabled={!draft.toolWebSearchEnabled}>
          <SettingsV3Switch
            label={ti('settings.tools.fallback_bing')}
            checked={draft.toolWebSearchFallbackToBing}
            disabled={!draft.toolWebSearchEnabled}
            onChange={(toolWebSearchFallbackToBing) => setDraft((current) => ({ ...current, toolWebSearchFallbackToBing }))}
          />
        </SettingsV3Row>
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
