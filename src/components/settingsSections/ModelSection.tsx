import { memo, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { API_PROVIDER_PRESETS, getApiProviderPreset } from '../../lib/apiProviders'
import {
  getCoreRuntime,
  removeAuthProfileFromRuntime,
  upsertAuthProfileInRuntime,
} from '../../lib/coreRuntime'
import { displaySecretInputValue, isVaultRefString } from '../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { getLocalizedApiProviderNote } from '../../features/models/providerNotes'
import {
  MODEL_PROVIDER_REGION_TABS,
  getDefaultOnboardingRegion,
  getProviderBrandsForRegion,
  pickBrandProviderForRegion,
  type ApiProviderPreset,
} from '../../features/models/providerCatalog'
import { isHttpHeaderSafeCredential } from '../../core/routing/AuthProfileStore'
import type { AppSettings, ServiceConnectionCapability } from '../../types'
import type { UiLanguage } from '../../types'
import anthropicLogo from '../../assets/provider-logos/anthropic.svg'
import deepseekLogo from '../../assets/provider-logos/deepseek.svg'
import doubaoLogo from '../../assets/provider-logos/doubao.svg'
import geminiLogo from '../../assets/provider-logos/gemini.svg'
import minimaxLogo from '../../assets/provider-logos/minimax.svg'
import mistralLogo from '../../assets/provider-logos/mistral.svg'
import moonshotLogo from '../../assets/provider-logos/moonshot.svg'
import nvidiaLogo from '../../assets/provider-logos/nvidia.svg'
import ollamaLogo from '../../assets/provider-logos/ollama.svg'
import openaiLogo from '../../assets/provider-logos/openai.svg'
import openrouterLogo from '../../assets/provider-logos/openrouter.svg'
import qianfanLogo from '../../assets/provider-logos/qianfan.svg'
import qwenLogo from '../../assets/provider-logos/qwen.svg'
import siliconflowLogo from '../../assets/provider-logos/siliconflow.svg'
import togetherLogo from '../../assets/provider-logos/together.svg'
import veniceLogo from '../../assets/provider-logos/venice.svg'
import xaiLogo from '../../assets/provider-logos/xai.svg'
import zaiLogo from '../../assets/provider-logos/zai.svg'
import { UrlInput } from './UrlInput'

type ModelProviderBrand = {
  id: string
  label: string
  fallbackGlyph?: string
  labelKey?: Parameters<typeof pickTranslatedUiText>[1]
  logoSrc?: string
  providerIds: string[]
}

const MODEL_PROVIDER_BRANDS: ModelProviderBrand[] = [
  { id: 'deepseek', label: 'DeepSeek', logoSrc: deepseekLogo, providerIds: ['deepseek'] },
  { id: 'ollama', label: 'Ollama', logoSrc: ollamaLogo, providerIds: ['ollama'] },
  { id: 'openai', label: 'OpenAI', logoSrc: openaiLogo, providerIds: ['openai'] },
  {
    id: 'custom',
    label: 'OpenAI Compatible',
    fallbackGlyph: 'AI',
    labelKey: 'settings.model.brand.openai_compatible',
    providerIds: ['custom'],
  },
  { id: 'anthropic', label: 'Anthropic', logoSrc: anthropicLogo, providerIds: ['anthropic'] },
  { id: 'gemini', label: 'Google Gemini', logoSrc: geminiLogo, providerIds: ['gemini'] },
  { id: 'xai', label: 'xAI Grok', logoSrc: xaiLogo, providerIds: ['xai'] },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    logoSrc: moonshotLogo,
    providerIds: ['moonshot', 'moonshot-global', 'kimi-coding', 'kimi-coding-global'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    logoSrc: minimaxLogo,
    providerIds: ['minimax', 'minimax-global', 'minimax-coding', 'minimax-coding-global'],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    logoSrc: qwenLogo,
    providerIds: ['dashscope', 'dashscope-global', 'modelstudio-coding'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    logoSrc: siliconflowLogo,
    providerIds: ['siliconflow', 'siliconflow-global'],
  },
  { id: 'openrouter', label: 'OpenRouter', logoSrc: openrouterLogo, providerIds: ['openrouter'] },
  { id: 'together', label: 'Together AI', logoSrc: togetherLogo, providerIds: ['together'] },
  { id: 'mistral', label: 'Mistral', logoSrc: mistralLogo, providerIds: ['mistral'] },
  { id: 'qianfan', label: 'Baidu Qianfan', logoSrc: qianfanLogo, providerIds: ['qianfan'] },
  { id: 'zai', label: 'Z.ai GLM', logoSrc: zaiLogo, providerIds: ['zai'] },
  { id: 'doubao', label: 'Doubao / ModelArk', logoSrc: doubaoLogo, providerIds: ['doubao', 'doubao-coding', 'byteplus', 'byteplus-coding'] },
  { id: 'nvidia', label: 'NVIDIA NIM', logoSrc: nvidiaLogo, providerIds: ['nvidia'] },
  { id: 'venice', label: 'Venice', logoSrc: veniceLogo, providerIds: ['venice'] },
]

function getModelProviderFallbackGlyph(label: string) {
  const glyph = label.match(/[A-Za-z0-9]/g)?.slice(0, 2).join('').toUpperCase()
  return glyph || label.trim().slice(0, 1) || 'AI'
}

function getExtraKeysTextForProvider(providerId: string) {
  const runtime = getCoreRuntime()
  return runtime.authStore
    .list(providerId)
    .map((p) => p.apiKey)
    .filter((key) => key && key.trim().length > 0)
    .join('\n')
}

type ModelSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  uiLanguage: UiLanguage
  onApplyTextProviderPreset: (providerId: string) => void
  onRunTextConnectionTest: () => void
  renderTextTestResult: () => ReactNode
}

type ExtraKeysFieldProps = {
  providerId: string
  uiLanguage: UiLanguage
}

function ExtraKeysField({ providerId, uiLanguage }: ExtraKeysFieldProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const [extraKeysText, setExtraKeysText] = useState(() => getExtraKeysTextForProvider(providerId))
  const [extraKeysError, setExtraKeysError] = useState('')

  const commitExtraKeys = () => {
    const runtime = getCoreRuntime()
    const existingProfiles = runtime.authStore.list(providerId)
    const nextKeys = extraKeysText
      .split(/\r?\n/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
    const invalidKey = nextKeys.find((key) => !isHttpHeaderSafeCredential(key))
    if (invalidKey) {
      setExtraKeysError(ti('settings.model.extra_keys_error'))
      return
    }
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
        id: `${providerId}:${Date.now()}:${index}`,
        providerId,
        apiKey: key,
        status: 'active',
        successCount: 0,
        failureCount: 0,
      })
    })
    setExtraKeysError('')
  }

  return (
    <label className="settings-control-card settings-model-advanced__field">
      <span>{ti('settings.model.extra_keys')}</span>
      <textarea
        rows={3}
        placeholder={'sk-extra-key-1\nsk-extra-key-2'}
        value={extraKeysText}
        onChange={(event) => {
          setExtraKeysText(event.target.value)
          if (extraKeysError) setExtraKeysError('')
        }}
        onBlur={commitExtraKeys}
      />
      {extraKeysError ? (
        <small className="settings-model-advanced__error" role="alert">
          {extraKeysError}
        </small>
      ) : null}
      <small>{ti('settings.model.extra_keys_hint')}</small>
    </label>
  )
}

export const ModelSection = memo(function ModelSection({
  active,
  draft,
  setDraft,
  testingTarget,
  uiLanguage,
  onApplyTextProviderPreset,
  onRunTextConnectionTest,
  renderTextTestResult,
}: ModelSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)

  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0
  const modelApiKeyInputValue = displaySecretInputValue(draft.apiKey)
  const apiKeyError = currentPreset.requiresApiKey
    && draft.apiKey
    && !isVaultRefString(draft.apiKey)
    && !isHttpHeaderSafeCredential(draft.apiKey)
    ? ti('settings.model.extra_keys_error')
    : ''
  const [detailsOpen, setDetailsOpen] = useState(false)
  // 国内 / 海外 / 本地 segmented filter over the brand grid. Defaults to the
  // current provider's region so opening settings always lands on the tab
  // that contains your selection; falls back to the UI-language heuristic.
  const [regionOverride, setRegionOverride] = useState<{
    providerId: string
    region: ApiProviderPreset['region']
  } | null>(null)

  const providerById = useMemo(() => {
    return new Map(API_PROVIDER_PRESETS.map((provider) => [provider.id, provider]))
  }, [])

  const providerBrands = useMemo(() => {
    const knownProviderIds = new Set(MODEL_PROVIDER_BRANDS.flatMap((brand) => brand.providerIds))
    const knownBrands = MODEL_PROVIDER_BRANDS
      .map((brand) => ({
        ...brand,
        providerIds: brand.providerIds.filter((providerId) => providerById.has(providerId)),
      }))
      .filter((brand) => brand.providerIds.length > 0)
    const extraBrands: ModelProviderBrand[] = API_PROVIDER_PRESETS
      .filter((provider) => !knownProviderIds.has(provider.id))
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        providerIds: [provider.id],
      }))

    return [...knownBrands, ...extraBrands]
  }, [providerById])

  const activeRegion = regionOverride?.providerId === draft.apiProviderId
    ? regionOverride.region
    : currentPreset.region
    ?? getDefaultOnboardingRegion(uiLanguage)
  const regionBrands = getProviderBrandsForRegion(providerBrands, activeRegion, draft.apiProviderId)

  const currentBrand = providerBrands.find((brand) => brand.providerIds.includes(draft.apiProviderId))
    ?? providerBrands[0]
  const currentBrandLabel = currentBrand.labelKey ? ti(currentBrand.labelKey) : currentBrand.label
  const currentBrandProviders = currentBrand.providerIds
    .map((providerId) => providerById.get(providerId))
    .filter((provider): provider is typeof API_PROVIDER_PRESETS[number] => Boolean(provider))
  const backToProviderListLabel = ti('settings.model.back_to_provider_list')
  const textConnectionTestLabel = testingTarget === 'text'
    ? ti('settings.model.testing')
    : ti('settings.model.test_endpoint')

  return (
    <section className={`settings-section settings-model-section ${active ? 'is-active' : 'is-hidden'}`}>
      {!detailsOpen ? (
        <>
          <div className="settings-section__title-row settings-model-source-head">
            <div>
              <h4>{ti('settings.model.provider_list_title')}</h4>
              <p className="settings-drawer__hint">
                {ti('settings.model.provider_list_hint')}
              </p>
            </div>
          </div>

          <div className="onboarding-region-tabs" role="group" aria-label={ti('onboarding.text.region_filter_label')}>
            {MODEL_PROVIDER_REGION_TABS.map((tab) => (
              <button
                key={tab.region}
                type="button"
                className={`onboarding-region-tabs__tab${activeRegion === tab.region ? ' is-active' : ''}`}
                aria-pressed={activeRegion === tab.region}
                onClick={() => setRegionOverride({ providerId: draft.apiProviderId, region: tab.region })}
                onKeyDown={(e) => {
                  const btns = Array.from(e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button'))
                  const i = btns.indexOf(e.currentTarget)
                  let next = -1
                  if (e.key === 'ArrowRight') next = (i + 1) % btns.length
                  else if (e.key === 'ArrowLeft') next = (i - 1 + btns.length) % btns.length
                  else if (e.key === 'Home') next = 0
                  else if (e.key === 'End') next = btns.length - 1
                  if (next >= 0) { e.preventDefault(); btns[next].focus() }
                }}
              >
                {ti(tab.labelKey)}
              </button>
            ))}
          </div>

          <div className="settings-model-source-grid">
            {regionBrands.map((brand) => {
              const selected = brand.providerIds.includes(draft.apiProviderId)
              const brandLabel = brand.labelKey ? ti(brand.labelKey) : brand.label
              return (
                <button
                  key={brand.id}
                  type="button"
                  className={`settings-model-source-card${selected ? ' is-selected' : ''}`}
                  data-brand={brand.id}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={brandLabel}
                  title={brandLabel}
                  onClick={() => {
                    onApplyTextProviderPreset(
                      pickBrandProviderForRegion(brand.providerIds, activeRegion, draft.apiProviderId),
                    )
                    setDetailsOpen(true)
                  }}
                >
                  {brand.logoSrc ? (
                    <img
                      className="settings-model-source-card__logo"
                      src={brand.logoSrc}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                    />
                  ) : (
                    <span className="settings-model-source-card__logoFallback" aria-hidden="true">
                      {brand.fallbackGlyph ?? getModelProviderFallbackGlyph(brandLabel)}
                    </span>
                  )}
                  <span className="settings-model-source-card__name">{brandLabel}</span>
                  <svg
                    className="settings-model-source-card__chevron"
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 16 16"
                  >
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.6"
                    />
                  </svg>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="settings-model-detail-card" data-brand={currentBrand.id}>
            <div className="settings-model-detail-brand">
              {currentBrand.logoSrc ? (
                <img
                  className="settings-model-detail-card__logo"
                  src={currentBrand.logoSrc}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                />
              ) : (
                <span className="settings-model-detail-card__logoFallback" aria-hidden="true">
                  {currentBrand.fallbackGlyph ?? getModelProviderFallbackGlyph(currentBrandLabel)}
                </span>
              )}

              <div className="settings-model-detail-head">
                <div className="settings-model-detail-title">
                  <h4>{currentBrandLabel}</h4>
                  {draft.model ? (
                    <span>{draft.model}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="settings-model-detail-nav">
              <button
                type="button"
                className="ghost-button"
                aria-label={backToProviderListLabel}
                title={backToProviderListLabel}
                onClick={() => setDetailsOpen(false)}
              >
                {backToProviderListLabel}
              </button>
                <button
                  type="button"
                  className="ghost-button settings-model-test-button"
                  aria-label={textConnectionTestLabel}
                  title={textConnectionTestLabel}
                  onClick={onRunTextConnectionTest}
                  disabled={testingTarget === 'text' || Boolean(apiKeyError)}
                >
                  {textConnectionTestLabel}
                </button>
            </div>

            <div className="settings-model-detail-fields">
              {currentBrandProviders.length > 1 ? (
                <label>
                  <span>{ti('settings.model.provider')}</span>
                  <select
                    value={draft.apiProviderId}
                    onChange={(event) => onApplyTextProviderPreset(event.target.value)}
                  >
                    {currentBrandProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                <span>{ti('settings.model.endpoint_url')}</span>
                <UrlInput
                  uiLanguage={draft.uiLanguage}
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
                  value={modelApiKeyInputValue}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, apiKey: event.target.value }))
                  }
                  onBlur={(event) => {
                    const nextValue = event.target.value.trim()
                    if (nextValue !== event.target.value) {
                      setDraft((prev) => ({ ...prev, apiKey: nextValue }))
                    }
                  }}
                />
                {apiKeyError ? (
                  <small className="settings-model-advanced__error" role="alert">
                    {apiKeyError}
                  </small>
                ) : null}
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
            </div>

            <div className="settings-model-detail-actions">
              {renderTextTestResult()}
            </div>

            <details className="settings-model-advanced">
              <summary>{ti('settings.model.advanced_settings')}</summary>
              <div className="settings-model-advanced__body">
                <p className="settings-drawer__hint settings-model-advanced__provider-note">
                  {getLocalizedApiProviderNote(currentPreset, uiLanguage)}
                </p>

                <div className="settings-control-card settings-model-advanced__control">
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
                  <p>{ti('settings.model.failover_hint')}</p>
                </div>

                <ExtraKeysField
                  key={draft.apiProviderId}
                  providerId={draft.apiProviderId}
                  uiLanguage={uiLanguage}
                />

                <div className="settings-control-card settings-model-advanced__control">
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
                  <p>{ti('settings.model.smart_routing_hint')}</p>
                </div>

                <div className="settings-model-advanced__field-grid">
                  <label className="settings-control-card settings-model-advanced__field">
                    <span>{ti('settings.model.tier_cheap')}</span>
                    <input
                      value={draft.modelCheap}
                      placeholder={currentPreset.defaultModel ?? ''}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, modelCheap: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-control-card settings-model-advanced__field">
                    <span>{ti('settings.model.tier_standard')}</span>
                    <input
                      value={draft.modelStandard}
                      placeholder={draft.model}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, modelStandard: event.target.value }))
                      }
                    />
                  </label>
                  <label className="settings-control-card settings-model-advanced__field">
                    <span>{ti('settings.model.tier_heavy')}</span>
                    <input
                      value={draft.modelHeavy}
                      placeholder={currentPreset.defaultModel ?? ''}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, modelHeavy: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="settings-model-advanced__field-grid">
                  <label className="settings-control-card settings-model-advanced__field">
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
                  <label className="settings-control-card settings-model-advanced__field">
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
                  <label className="settings-control-card settings-model-advanced__field">
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
                </div>

                <div className="settings-control-card settings-model-advanced__control">
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
                </div>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  )
})
