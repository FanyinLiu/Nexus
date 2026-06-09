import { useMemo, useState } from 'react'
import { getApiProviderPreset, getOnboardingTextProviderOptionsByRegion } from '../../../../lib/apiProviders'
import type { ApiProviderPreset } from '../../../../lib/apiProviders'
import { displaySecretInputValue } from '../../../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import { getLocalizedApiProviderNote } from '../../../models/providerNotes'
import type { AppSettings } from '../../../../types'
import type { OnboardingDraftSetter } from './types'

type TextStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
  onApplyTextProviderPreset: (providerId: string) => void
}

// 国内 / 海外 / 本地 — the region field partitions every preset with no overlap,
// so these three tabs cover the whole catalog and each provider lands in exactly
// one. Switching a tab only filters the picker; it never mutates the draft.
const REGION_TABS: { region: ApiProviderPreset['region']; labelKey: Parameters<typeof pickTranslatedUiText>[1] }[] = [
  { region: 'china', labelKey: 'settings.model.provider_group.china' },
  { region: 'global', labelKey: 'settings.model.provider_group.global' },
  { region: 'custom', labelKey: 'settings.model.provider_group.local' },
]

export function TextStep({
  draft,
  setDraft,
  onApplyTextProviderPreset,
}: TextStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0

  // Region-aware default: Chinese UIs open on 国内, everyone else on 海外. The
  // currently-selected provider stays visible regardless of the active tab.
  const [region, setRegion] = useState<ApiProviderPreset['region']>(
    String(draft.uiLanguage).startsWith('zh') ? 'china' : 'global',
  )
  const providerOptions = useMemo(
    () => getOnboardingTextProviderOptionsByRegion(region, draft.apiProviderId),
    [region, draft.apiProviderId],
  )

  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <div className="onboarding-region-tabs" role="group" aria-label={ti('onboarding.text.provider_label')}>
        {REGION_TABS.map((tab) => (
          <button
            key={tab.region}
            type="button"
            className={`onboarding-region-tabs__tab${region === tab.region ? ' is-active' : ''}`}
            aria-pressed={region === tab.region}
            onClick={() => setRegion(tab.region)}
          >
            {ti(tab.labelKey)}
          </button>
        ))}
      </div>
      <label>
        <span>{ti('onboarding.text.provider_label')}</span>
        <select
          value={draft.apiProviderId}
          onChange={(event) => onApplyTextProviderPreset(event.target.value)}
        >
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="onboarding-tip">{getLocalizedApiProviderNote(currentPreset, draft.uiLanguage)}</p>

      <div className="onboarding-grid onboarding-grid--two">
        <label>
          <span>{ti('onboarding.text.api_base_label')}</span>
          <input
            value={draft.apiBaseUrl}
            onChange={(event) => setDraft((current) => ({
              ...current,
              apiBaseUrl: event.target.value,
            }))}
          />
        </label>

        <label>
          <span>{ti('onboarding.text.model_label')}</span>
          {hasModelOptions ? (
            <select
              value={draft.model}
              onChange={(event) => setDraft((current) => ({
                ...current,
                model: event.target.value,
              }))}
            >
              {currentPreset.models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
              {!currentPreset.models.includes(draft.model) && draft.model && (
                <option value={draft.model}>{draft.model} {ti('onboarding.text.model_custom_suffix')}</option>
              )}
            </select>
          ) : (
            <input
              value={draft.model}
              onChange={(event) => setDraft((current) => ({
                ...current,
                model: event.target.value,
              }))}
            />
          )}
        </label>
      </div>

      <label>
        <span>{ti('onboarding.text.api_key_label')}</span>
        <input
          type="password"
          value={displaySecretInputValue(draft.apiKey)}
          onChange={(event) => setDraft((current) => ({
            ...current,
            apiKey: event.target.value,
          }))}
          placeholder={ti('onboarding.text.api_key_placeholder')}
        />
      </label>
    </div>
  )
}
