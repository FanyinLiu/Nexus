import { memo, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { API_PROVIDER_PRESETS, getApiProviderPreset } from '../../lib/apiProviders'
import { getCoreRuntime, removeAuthProfileFromRuntime, upsertAuthProfileInRuntime } from '../../lib/coreRuntime'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { getLocalizedApiProviderNote } from '../models/providerNotes'
import { isHttpHeaderSafeCredential } from '../../core/routing/AuthProfileStore'
import type { AppSettings, ServiceConnectionCapability, UiLanguage } from '../../types'
import { UrlInput } from '../../components/settingsSections/UrlInput'
import {
  SettingsV3ConnectionEvidence,
  type SettingsV3ConnectionEvidenceValue,
  SettingsV3Disclosure,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'

type Props = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  uiLanguage: UiLanguage
  onApplyTextProviderPreset: (providerId: string) => void
  onRunTextConnectionTest: () => void
  connectionEvidence: SettingsV3ConnectionEvidenceValue | null
}

function ExtraKeys({ providerId, uiLanguage }: { providerId: string; uiLanguage: UiLanguage }) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const [value, setValue] = useState(() => getCoreRuntime().authStore.list(providerId).map((item) => item.apiKey).filter(Boolean).join('\n'))
  const [error, setError] = useState('')

  const commit = () => {
    const keys = value.split(/\r?\n/).map((key) => key.trim()).filter(Boolean)
    if (keys.some((key) => !isHttpHeaderSafeCredential(key))) {
      setError(ti('settings.model.extra_keys_error'))
      return
    }
    const runtime = getCoreRuntime()
    const existing = runtime.authStore.list(providerId)
    const next = new Set(keys)
    existing.forEach((profile) => { if (!next.has(profile.apiKey)) removeAuthProfileFromRuntime(profile.id) })
    const have = new Set(existing.map((profile) => profile.apiKey))
    keys.forEach((apiKey, index) => {
      if (!have.has(apiKey)) upsertAuthProfileInRuntime({
        id: `${providerId}:${Date.now()}:${index}`,
        providerId,
        apiKey,
        status: 'active',
        successCount: 0,
        failureCount: 0,
      })
    })
    setError('')
  }

  return (
    <SettingsV3Field label={ti('settings.model.extra_keys')} hint={ti('settings.model.extra_keys_hint')}>
      <textarea
        rows={3}
        value={value}
        placeholder={'sk-extra-key-1\nsk-extra-key-2'}
        onChange={(event) => { setValue(event.target.value); setError('') }}
        onBlur={commit}
        aria-invalid={Boolean(error)}
      />
      {error ? <small role="alert">{error}</small> : null}
    </SettingsV3Field>
  )
}

export const ModelSectionV3 = memo(function ModelSectionV3({
  active,
  draft,
  setDraft,
  testingTarget,
  uiLanguage,
  onApplyTextProviderPreset,
  onRunTextConnectionTest,
  connectionEvidence,
}: Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const preset = getApiProviderPreset(draft.apiProviderId)
  const keyValue = displaySecretInputValue(draft.apiKey)
  const keyStored = isVaultRefString(draft.apiKey)
  const keyError = preset.requiresApiKey && draft.apiKey && !keyStored && !isHttpHeaderSafeCredential(draft.apiKey)
    ? ti('settings.model.extra_keys_error')
    : ''
  const providerGroups = useMemo(() => {
    const result = new Map<string, typeof API_PROVIDER_PRESETS>()
    API_PROVIDER_PRESETS.forEach((provider) => {
      const group = provider.region ?? 'global'
      result.set(group, [...(result.get(group) ?? []), provider])
    })
    return [...result.entries()]
  }, [])

  if (!active) return null

  const secretState = keyStored
    ? ti('settings.integrations.status.configured')
    : draft.apiKey
      ? ti('settings.integrations.status.configured')
      : ti('settings.integrations.status.setup')

  return (
    <SettingsV3Page>
      <SettingsV3Notice tone={keyError ? 'error' : 'info'} title={`${preset.label} · ${draft.model || ti('settings.model.custom')}`}>
        {keyError || `${secretState} · ${ti('settings.model.test_endpoint')}`}
      </SettingsV3Notice>

      <SettingsV3Section title={ti('settings.model.provider_list_title')} description={ti('settings.model.provider_list_hint')}>
        <SettingsV3Row label={ti('settings.model.provider')} hint={preset.label}>
          <select
            className="settings-v3-action"
            value={draft.apiProviderId}
            aria-label={ti('settings.model.provider')}
            onChange={(event) => onApplyTextProviderPreset(event.target.value)}
          >
            {providerGroups.map(([region, providers]) => (
              <optgroup key={region} label={region}>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </optgroup>
            ))}
          </select>
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.model.model')} hint={draft.model || ti('settings.model.custom')}>
          {preset.models.length ? (
            <select
              className="settings-v3-action"
              value={draft.model}
              aria-label={ti('settings.model.model')}
              onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
            >
              {preset.models.map((model) => <option key={model} value={model}>{model}</option>)}
              {draft.model && !preset.models.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
            </select>
          ) : null}
        </SettingsV3Row>
      </SettingsV3Section>

      <SettingsV3Section title={ti('settings.model.endpoint_url')} description={getLocalizedApiProviderNote(preset, uiLanguage)}>
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.model.endpoint_url')}>
            <UrlInput uiLanguage={draft.uiLanguage} value={draft.apiBaseUrl} onChange={(event) => setDraft((prev) => ({ ...prev, apiBaseUrl: event.target.value }))} />
          </SettingsV3Field>
          <SettingsV3Field label={ti('settings.model.api_key')} hint={secretState}>
            <input
              type="password"
              value={keyValue}
              placeholder={keyStored ? secretState : undefined}
              aria-invalid={Boolean(keyError)}
              onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
              onBlur={(event) => {
                const apiKey = event.target.value.trim()
                if (apiKey !== event.target.value) setDraft((prev) => ({ ...prev, apiKey }))
              }}
            />
            {keyError ? <small role="alert">{keyError}</small> : null}
          </SettingsV3Field>
          {preset.models.length === 0 ? (
            <SettingsV3Field label={ti('settings.model.model')}>
              <input value={draft.model} onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))} />
            </SettingsV3Field>
          ) : null}
          <SettingsV3Toolbar>
            <button type="button" disabled={testingTarget === 'text' || Boolean(keyError)} onClick={onRunTextConnectionTest}>
              {testingTarget === 'text' ? ti('settings.model.testing') : ti('settings.model.test_endpoint')}
            </button>
          </SettingsV3Toolbar>
          <SettingsV3ConnectionEvidence evidence={connectionEvidence} />
        </div>
      </SettingsV3Section>

      <SettingsV3Disclosure title={ti('settings.model.advanced_settings')} description={ti('settings.model.failover_hint')}>
        <SettingsV3Row label={ti('settings.model.failover_toggle')} hint={ti('settings.model.failover_hint')}>
          <SettingsV3Switch label={ti('settings.model.failover_toggle')} checked={draft.chatFailoverEnabled} onChange={(chatFailoverEnabled) => setDraft((prev) => ({ ...prev, chatFailoverEnabled }))} />
        </SettingsV3Row>
        <ExtraKeys key={draft.apiProviderId} providerId={draft.apiProviderId} uiLanguage={uiLanguage} />
        <SettingsV3Row label={ti('settings.model.smart_routing_toggle')} hint={ti('settings.model.smart_routing_hint')}>
          <SettingsV3Switch label={ti('settings.model.smart_routing_toggle')} checked={draft.smartModelRoutingEnabled} onChange={(smartModelRoutingEnabled) => setDraft((prev) => ({ ...prev, smartModelRoutingEnabled }))} />
        </SettingsV3Row>
        <SettingsV3Field label={ti('settings.model.tier_cheap')}><input value={draft.modelCheap} placeholder={preset.defaultModel ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, modelCheap: event.target.value }))} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.model.tier_standard')}><input value={draft.modelStandard} placeholder={draft.model} onChange={(event) => setDraft((prev) => ({ ...prev, modelStandard: event.target.value }))} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.model.tier_heavy')}><input value={draft.modelHeavy} placeholder={preset.defaultModel ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, modelHeavy: event.target.value }))} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.model.budget_daily')}><input type="number" min="0" step="0.1" value={draft.budgetDailyCapUsd || ''} onChange={(event) => setDraft((prev) => ({ ...prev, budgetDailyCapUsd: Number(event.target.value) || 0 }))} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.model.budget_monthly')}><input type="number" min="0" step="1" value={draft.budgetMonthlyCapUsd || ''} onChange={(event) => setDraft((prev) => ({ ...prev, budgetMonthlyCapUsd: Number(event.target.value) || 0 }))} /></SettingsV3Field>
        <SettingsV3Field label={ti('settings.model.budget_downgrade_ratio')}><input type="number" min="0" max="1" step="0.05" value={draft.budgetDowngradeRatio} onChange={(event) => setDraft((prev) => ({ ...prev, budgetDowngradeRatio: Number(event.target.value) || 0 }))} /></SettingsV3Field>
        <SettingsV3Row label={ti('settings.model.budget_hard_stop')}>
          <SettingsV3Switch label={ti('settings.model.budget_hard_stop')} checked={draft.budgetHardStopEnabled} onChange={(budgetHardStopEnabled) => setDraft((prev) => ({ ...prev, budgetHardStopEnabled }))} />
        </SettingsV3Row>
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
