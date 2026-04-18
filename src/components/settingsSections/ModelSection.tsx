import { memo, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { API_PROVIDER_PRESETS, getApiProviderPreset } from '../../lib/apiProviders'
import {
  getCoreRuntime,
  removeAuthProfileFromRuntime,
  upsertAuthProfileInRuntime,
} from '../../lib/coreRuntime'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, ServiceConnectionCapability } from '../../types'
import type { UiLanguage } from '../../types'
import { UrlInput } from './UrlInput'

type ModelSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  textProvider: {
    notes: string
    baseUrl?: string
    defaultModel?: string
  }
  uiLanguage: UiLanguage
  onApplyTextProviderPreset: (providerId: string) => void
  onRunTextConnectionTest: () => void
  renderTextTestResult: () => ReactNode
}

export const ModelSection = memo(function ModelSection({
  active,
  draft,
  setDraft,
  testingTarget,
  textProvider,
  uiLanguage,
  onApplyTextProviderPreset,
  onRunTextConnectionTest,
  renderTextTestResult,
}: ModelSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)

  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0

  const [extraKeysText, setExtraKeysText] = useState('')
  const [extraKeysProviderId, setExtraKeysProviderId] = useState<string | null>(null)
  // Reset the textarea whenever the selected provider changes. Done during
  // render via the prev-prop pattern to avoid set-state-in-effect churn.
  if (draft.apiProviderId !== extraKeysProviderId) {
    const runtime = getCoreRuntime()
    const existing = runtime.authStore
      .list(draft.apiProviderId)
      .map((p) => p.apiKey)
      .filter((k) => k && k.trim().length > 0)
    setExtraKeysProviderId(draft.apiProviderId)
    setExtraKeysText(existing.join('\n'))
  }

  const commitExtraKeys = () => {
    const runtime = getCoreRuntime()
    const existingProfiles = runtime.authStore.list(draft.apiProviderId)
    const nextKeys = extraKeysText
      .split(/\r?\n/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
    const nextSet = new Set(nextKeys)
    for (const profile of existingProfiles) {
      if (!nextSet.has(profile.apiKey)) {
        removeAuthProfileFromRuntime(profile.id)
      }
    }
    const have = new Set(existingProfiles.map((p) => p.apiKey))
    nextKeys.forEach((key, index) => {
      if (have.has(key)) return
      upsertAuthProfileInRuntime({
        id: `${draft.apiProviderId}:${Date.now()}:${index}`,
        providerId: draft.apiProviderId,
        apiKey: key,
        status: 'active',
        successCount: 0,
        failureCount: 0,
      })
    })
  }

  const textProviderOptions = useMemo(
    () => API_PROVIDER_PRESETS.filter((provider) => provider.defaultModel),
    [],
  )

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.model.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.model.hint')}
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunTextConnectionTest}
          disabled={testingTarget === 'text'}
        >
          {testingTarget === 'text'
            ? ti('settings.model.testing')
            : ti('settings.model.test_endpoint')}
        </button>
      </div>

      <label>
        <span>{ti('settings.model.provider')}</span>
        <select
          value={draft.apiProviderId}
          onChange={(event) => onApplyTextProviderPreset(event.target.value)}
        >
          {textProviderOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {textProvider.notes}
        {textProvider.baseUrl
          ? ` ${ti('settings.model.default_endpoint')}${textProvider.baseUrl}`
          : ''}
        {textProvider.defaultModel
          ? `${ti('settings.model.recommended_model')}${textProvider.defaultModel}`
          : ''}
      </p>

      <label>
        <span>{ti('settings.model.endpoint_url')}</span>
        <UrlInput
          value={draft.apiBaseUrl}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, apiBaseUrl: event.target.value }))
          }
        />
      </label>

      <label>
        <span>{ti('settings.model.api_key')}</span>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, apiKey: event.target.value }))
          }
        />
      </label>

      <label>
        <span>{ti('settings.model.model')}</span>
        {hasModelOptions ? (
          <select
            value={draft.model}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, model: event.target.value }))
            }
          >
            {currentPreset.models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
            {!currentPreset.models.includes(draft.model) && draft.model && (
              <option value={draft.model}>
                {draft.model} {ti('settings.model.custom')}
              </option>
            )}
          </select>
        ) : (
          <input
            value={draft.model}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, model: event.target.value }))
            }
          />
        )}
      </label>

      <label className="settings-toggle">
        <span>{ti('settings.model.failover_toggle')}</span>
        <input
          type="checkbox"
          checked={draft.chatFailoverEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              chatFailoverEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">
        {ti('settings.model.failover_hint')}
      </p>

      <label>
        <span>{ti('settings.model.extra_keys')}</span>
        <textarea
          rows={3}
          placeholder={'sk-extra-key-1\nsk-extra-key-2'}
          value={extraKeysText}
          onChange={(event) => setExtraKeysText(event.target.value)}
          onBlur={commitExtraKeys}
        />
      </label>
      <p className="settings-drawer__hint">
        {ti('settings.model.extra_keys_hint')}
      </p>

      <label className="settings-toggle">
        <span>{ti('settings.model.smart_routing_toggle')}</span>
        <input
          type="checkbox"
          checked={draft.smartModelRoutingEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              smartModelRoutingEnabled: event.target.checked,
            }))
          }
        />
      </label>
      <p className="settings-drawer__hint">
        {ti('settings.model.smart_routing_hint')}
      </p>

      <label>
        <span>{ti('settings.model.tier_cheap')}</span>
        <input
          value={draft.modelCheap}
          placeholder={currentPreset.defaultModel ?? ''}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, modelCheap: event.target.value }))
          }
        />
      </label>
      <label>
        <span>{ti('settings.model.tier_standard')}</span>
        <input
          value={draft.modelStandard}
          placeholder={draft.model}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, modelStandard: event.target.value }))
          }
        />
      </label>
      <label>
        <span>{ti('settings.model.tier_heavy')}</span>
        <input
          value={draft.modelHeavy}
          placeholder={currentPreset.defaultModel ?? ''}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, modelHeavy: event.target.value }))
          }
        />
      </label>

      <label>
        <span>{ti('settings.model.summary_model')}</span>
        <input
          value={draft.summaryModel}
          placeholder={draft.modelCheap || draft.model}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, summaryModel: event.target.value }))
          }
        />
      </label>
      <p className="settings-drawer__hint">
        {ti('settings.model.summary_model_hint')}
      </p>

      <label>
        <span>{ti('settings.model.budget_daily')}</span>
        <input
          type="number"
          step="0.1"
          min="0"
          value={draft.budgetDailyCapUsd || ''}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              budgetDailyCapUsd: Number(event.target.value) || 0,
            }))
          }
        />
      </label>
      <label>
        <span>{ti('settings.model.budget_monthly')}</span>
        <input
          type="number"
          step="1"
          min="0"
          value={draft.budgetMonthlyCapUsd || ''}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              budgetMonthlyCapUsd: Number(event.target.value) || 0,
            }))
          }
        />
      </label>
      <label>
        <span>{ti('settings.model.budget_downgrade_ratio')}</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={draft.budgetDowngradeRatio}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              budgetDowngradeRatio: Number(event.target.value) || 0,
            }))
          }
        />
      </label>
      <label className="settings-toggle">
        <span>{ti('settings.model.budget_hard_stop')}</span>
        <input
          type="checkbox"
          checked={draft.budgetHardStopEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              budgetHardStopEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {renderTextTestResult()}
    </section>
  )
})
