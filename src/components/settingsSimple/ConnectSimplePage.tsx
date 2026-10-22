/**
 * Connection page: service, model, key, and one lookup switch.
 * The address shows only for a service the person fills in. Try-it
 * shows when a key is present or the service runs on this computer.
 */

import type { Dispatch, SetStateAction } from 'react'
import { API_PROVIDER_PRESETS, getApiProviderPreset } from '../../features/models/providerCatalog.ts'
import { endpointEditorPlacement, lookupPatch, sharedLookup } from '../../features/settingsSimplify/index.ts'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge.ts'
import { UrlInput } from '../../features/settingsV3/UrlInput.tsx'
import { SettingsV3Field, SettingsV3Notice, SettingsV3Switch } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import type { AppSettings } from '../../types/index.ts'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleRow } from './settingsSimpleShared.tsx'

type ConnectSimplePageProps = {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testing: boolean
  saveError: boolean
  onApplyTextProviderPreset: (providerId: string) => void
  onRunTextConnectionTest: () => void
}

export function ConnectSimplePage({
  draft,
  setDraft,
  testing,
  saveError,
  onApplyTextProviderPreset,
  onRunTextConnectionTest,
}: ConnectSimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)
  const preset = getApiProviderPreset(draft.apiProviderId)
  const lookup = sharedLookup(draft.toolWebSearchEnabled, draft.toolWeatherEnabled)
  const keyStored = isVaultRefString(draft.apiKey)
  const showAddress = endpointEditorPlacement(draft.apiProviderId) === 'simple'
  const showTest = !preset.requiresApiKey || Boolean(draft.apiKey.trim())

  return (
    <>
      {saveError ? <SettingsV3Notice tone="error" title={ti('settings.save_failed_fallback')} /> : null}
      <section className="settings-v3-section__body">
        <SettingsV3Field label={ti('settings.simple.connect_service')}>
          <select
            className="settings-v3-action"
            aria-label={ti('settings.simple.connect_service')}
            value={draft.apiProviderId}
            onChange={(event) => onApplyTextProviderPreset(event.target.value)}
          >
            {API_PROVIDER_PRESETS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.simple.connect_model')}>
          {preset.models.length ? (
            <select
              className="settings-v3-action"
              aria-label={ti('settings.simple.connect_model')}
              value={draft.model}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            >
              {preset.models.map((model) => <option key={model} value={model}>{model}</option>)}
              {draft.model && !preset.models.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
            </select>
          ) : (
            <input
              aria-label={ti('settings.simple.connect_model')}
              value={draft.model}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            />
          )}
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.simple.connect_key')}>
          <input
            type="password"
            aria-label={ti('settings.simple.connect_key')}
            value={displaySecretInputValue(draft.apiKey)}
            placeholder={keyStored || !preset.requiresApiKey ? ti('settings.simple.connect_key_local') : undefined}
            onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
          />
        </SettingsV3Field>
        {showAddress ? (
          <SettingsV3Field label={ti('settings.simple.connect_address')}>
            <UrlInput
              uiLanguage={draft.uiLanguage}
              value={draft.apiBaseUrl}
              onChange={(event) => setDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))}
            />
          </SettingsV3Field>
        ) : null}
        {showTest ? (
          <div className="settings-v3-row">
            <button
              type="button"
              className="settings-v3-action"
              disabled={testing}
              onClick={onRunTextConnectionTest}
            >
              {testing ? ti('settings.simple.connect_testing') : ti('settings.simple.connect_test')}
            </button>
          </div>
        ) : null}
      </section>

      <section className="settings-v3-section__body">
        {lookup === null ? (
          <p>{ti('settings.simple.connect_lookup_split')}</p>
        ) : (
          <SimpleRow icon="tools" tone="warning" title={ti('settings.simple.connect_lookup')} hint={ti('settings.simple.connect_lookup_hint')}>
            <SettingsV3Switch
              checked={lookup}
              label={ti('settings.simple.connect_lookup')}
              onChange={(enabled) => setDraft((current) => ({ ...current, ...lookupPatch(enabled) }))}
            />
          </SimpleRow>
        )}
        {lookup ? (
          <SettingsV3Field label={ti('settings.simple.connect_city')}>
            <input
              value={draft.toolWeatherDefaultLocation}
              placeholder={ti('settings.simple.connect_city_hint')}
              onChange={(event) => setDraft((current) => ({
                ...current,
                toolWeatherDefaultLocation: event.target.value,
              }))}
            />
          </SettingsV3Field>
        ) : null}
      </section>
    </>
  )
}
