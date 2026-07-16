import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  createConnectionVerificationRecord,
  getConnectionTestResultPresentation,
  getNextConnectionResultExpiryMs,
  resolveConnectionResultMessage,
  resolveConnectionResultRecommendation,
  shouldAcceptConnectionTestResult,
  type ConnectionVerificationRecord,
  withConnectionCheckedAt,
} from '../../../models/connectionTestFreshness'
import type { TranslationKey } from '../../../../types'
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
  /** Clear or replace the parent verification record (fingerprint/evidence/time). */
  onTextConnectionVerificationChange: (record: ConnectionVerificationRecord | null) => void
}

export function TextStep({
  draft,
  setDraft,
  onApplyTextProviderPreset,
  regionTab,
  onRegionTabChange,
  onTestConnection,
  onTextConnectionVerificationChange,
}: TextStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null)
  const [repairNotice, setRepairNotice] = useState<string | null>(null)
  const [freshnessTick, setFreshnessTick] = useState(0)
  const requestGenerationRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Bump generation so an in-flight request started here never updates
      // parent verified state or local UI after unmount.
      requestGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    const nextExpiry = getNextConnectionResultExpiryMs([testResult])
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(
      () => {
        if (!mountedRef.current) return
        setFreshnessTick((current) => current + 1)
      },
      Math.max(0, nextExpiry - Date.now()) + 25,
    )
    return () => window.clearTimeout(timer)
  }, [testResult, freshnessTick])

  useEffect(() => {
    const refreshOnReturn = () => {
      if (!mountedRef.current) return
      setFreshnessTick((current) => current + 1)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshOnReturn()
    }
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  function clearTextConnectionResult() {
    requestGenerationRef.current += 1
    onTextConnectionVerificationChange(null)
    setTesting(false)
    setTestResult(null)
    setRepairNotice(null)
  }

  async function handleTestConnection() {
    if (!onTestConnection || testing) return
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    setTesting(true)
    setTestResult(null)
    setRepairNotice(null)
    try {
      const result = await onTestConnection(draft)
      if (
        !mountedRef.current
        || !shouldAcceptConnectionTestResult({
          requestGeneration,
          activeGeneration: requestGenerationRef.current,
        })
      ) {
        return
      }
      const stamped = withConnectionCheckedAt(result)
      setTestResult(stamped)
      const nextPresentation = getConnectionTestResultPresentation({
        result: stamped,
        fingerprintMatches: true,
        capability: 'text',
      })
      onTextConnectionVerificationChange(
        nextPresentation.verified
          ? createConnectionVerificationRecord('text', draft, stamped)
          : null,
      )
    } catch {
      if (
        !mountedRef.current
        || !shouldAcceptConnectionTestResult({
          requestGeneration,
          activeGeneration: requestGenerationRef.current,
        })
      ) {
        return
      }
      setTestResult({ ok: false, message: ti('settings.test_connection.failed') })
      onTextConnectionVerificationChange(null)
    } finally {
      if (
        mountedRef.current
        && shouldAcceptConnectionTestResult({
          requestGeneration,
          activeGeneration: requestGenerationRef.current,
        })
      ) {
        setTesting(false)
      }
    }
  }

  function handleApplyTestRepair() {
    if (!testResult) return
    const repair = buildConnectionTestRepairAction(testResult, draft)
    if (!repair) return
    clearTextConnectionResult()
    setDraft((current) => applyConnectionTestRepairDraft(current, repair))
    setRepairNotice(`${repair.appliedMessage} ${ti('settings.test_connection.stale')}`)
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
  // Recomputed each render (including after freshnessTick TTL / focus refresh)
  // so the visible card never keeps success styling past expiry.
  const presentation = getConnectionTestResultPresentation({
    testing,
    result: testResult,
    fingerprintMatches: true,
    capability: 'text',
  })
  const testResultClassName = presentation.className ?? ''
  const translate = (
    language: AppSettings['uiLanguage'],
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => pickTranslatedUiText(language, key as TranslationKey, params)
  const testResultMessage = testResult
    ? presentation.tone === 'stale'
      ? ti(
        presentation.freshness === 'config-stale'
          ? 'settings.test_connection.stale'
          : presentation.freshness === 'time-stale'
            ? 'settings.test_connection.expired'
            : 'settings.test_connection.unverified',
      )
      : presentation.tone === 'partial' && !testResult.messageKey
        ? ti('settings.test_connection.partial')
        : resolveConnectionResultMessage(testResult, draft.uiLanguage, translate)
    : ''
  const testResultRecommendation = testResult && presentation.tone !== 'stale'
    ? resolveConnectionResultRecommendation(testResult, draft.uiLanguage, translate)
    : undefined

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
              className={testResultClassName}
              role={presentation.tone === 'error' ? 'alert' : 'status'}
              aria-live={presentation.tone === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              <p>{testResultMessage}</p>
              {testResultRecommendation ? (
                <p className="settings-test-result__recommendation">{testResultRecommendation}</p>
              ) : null}
              {testRepair && presentation.tone === 'error' ? (
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
          {repairNotice ? (
            <div className="settings-test-result" role="status" aria-live="polite" aria-atomic="true">
              <p>{repairNotice}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
