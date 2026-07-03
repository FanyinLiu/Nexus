import { useMemo, useState } from 'react'
import {
  MODEL_PROVIDER_REGION_TABS,
  getApiProviderPreset,
  getDefaultOnboardingRegion,
  getOnboardingTextProviderOptionsByRegion,
} from '../../../../lib/apiProviders'
import type { ApiProviderPreset } from '../../../../lib/apiProviders'
import { displaySecretInputValue } from '../../../../lib/keyVaultBridge'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import {
  applyConnectionTestRepairDraft,
  buildConnectionTestRepairAction,
} from '../../../models/connectionRepair'
import { getLocalizedApiProviderNote } from '../../../models/providerNotes'
import type { ConnectionResult } from '../../../../components/settingsDrawerSupport'
import type { AppSettings } from '../../../../types'
import type { OnboardingDraftSetter } from './types'

type TextStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
  onApplyTextProviderPreset: (providerId: string) => void
  /**
   * Lifted to OnboardingGuide so the choice survives leaving and re-entering
   * this step (the guide unmounts inactive steps). null = the user hasn't
   * picked a tab yet; we fall back to the uiLanguage default, which keeps
   * tracking the language chosen on the welcome step until first click.
   */
  regionTab: ApiProviderPreset['region'] | null
  onRegionTabChange: (region: ApiProviderPreset['region']) => void
  onTestConnection?: (settings: AppSettings) => Promise<ConnectionResult>
  onTextConnectionConfigChanged: () => void
}

export function TextStep({
  draft,
  setDraft,
  onApplyTextProviderPreset,
  regionTab,
  onRegionTabChange,
  onTestConnection,
  onTextConnectionConfigChanged,
}: TextStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null)

  function clearTextConnectionResult() {
    onTextConnectionConfigChanged()
    setTestResult(null)
  }

  async function handleTestConnection() {
    if (!onTestConnection || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await onTestConnection(draft)
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, message: '这次没能连上，可能是网络打了个盹，稍后再试试吧。' })
    } finally {
      setTesting(false)
    }
  }

  function handleApplyTestRepair() {
    if (!testResult) return
    const repair = buildConnectionTestRepairAction(testResult, draft)
    if (!repair) return
    clearTextConnectionResult()
    setDraft((current) => applyConnectionTestRepairDraft(current, repair))
    setTestResult({
      ok: true,
      status: 'ready',
      message: repair.appliedMessage,
    })
  }

  // The currently-selected provider stays visible regardless of the active tab.
  const region = regionTab ?? getDefaultOnboardingRegion(draft.uiLanguage)
  const providerOptions = useMemo(
    () => getOnboardingTextProviderOptionsByRegion(region, draft.apiProviderId),
    [region, draft.apiProviderId],
  )
  const testRepair = testResult
    ? buildConnectionTestRepairAction(testResult, draft)
    : null

  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <div className="onboarding-region-tabs" role="group" aria-label={ti('onboarding.text.region_filter_label')}>
        {MODEL_PROVIDER_REGION_TABS.map((tab) => (
          <button
            key={tab.region}
            type="button"
            className={`onboarding-region-tabs__tab${region === tab.region ? ' is-active' : ''}`}
            aria-pressed={region === tab.region}
            onClick={() => onRegionTabChange(tab.region)}
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
      <label>
        <span>{ti('onboarding.text.provider_label')}</span>
        <select
          value={draft.apiProviderId}
          onChange={(event) => {
            clearTextConnectionResult()
            onApplyTextProviderPreset(event.target.value)
          }}
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
            onChange={(event) => {
              clearTextConnectionResult()
              setDraft((current) => ({
                ...current,
                apiBaseUrl: event.target.value,
              }))
            }}
          />
        </label>

        <label>
          <span>{ti('onboarding.text.model_label')}</span>
          {hasModelOptions ? (
            <select
              value={draft.model}
              onChange={(event) => {
                clearTextConnectionResult()
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }}
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
              onChange={(event) => {
                clearTextConnectionResult()
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }}
            />
          )}
        </label>
      </div>

      <label>
        <span>{ti('onboarding.text.api_key_label')}</span>
        <input
          type="password"
          value={displaySecretInputValue(draft.apiKey)}
          onChange={(event) => {
            clearTextConnectionResult()
            setDraft((current) => ({
              ...current,
              apiKey: event.target.value,
            }))
          }}
          placeholder={ti('onboarding.text.api_key_placeholder')}
        />
      </label>

      {onTestConnection ? (
        <div className="onboarding-test-connection">
          <button
            type="button"
            className="ghost-button"
            disabled={testing}
            onClick={handleTestConnection}
          >
            {testing ? ti('settings.model.testing') : ti('settings.model.test_endpoint')}
          </button>
          {testResult ? (
            <div
              className={testResult.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
              role={testResult.ok ? 'status' : 'alert'}
              aria-live={testResult.ok ? 'polite' : 'assertive'}
              aria-atomic="true"
            >
              <p>{testResult.message}</p>
              {testResult.recommendation ? (
                <p className="settings-test-result__recommendation">{testResult.recommendation}</p>
              ) : null}
              {testRepair ? (
                <button
                  type="button"
                  className="ghost-button settings-test-result__action"
                  onClick={handleApplyTestRepair}
                >
                  {testRepair.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
