import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  isMiniMaxSpeechOutputProvider,
} from '../../lib'
import { formatConsoleTimestamp, type ConnectionResult } from '../settingsDrawerSupport'
import {
  buildConnectionTestRepairAction,
  type ConnectionTestRepairAction,
} from '../../features/models/connectionRepair'
import {
  buildConnectionTestFingerprint,
  connectionEvidenceMeetsCapability,
  getConnectionTestResultPresentation,
  getNextConnectionResultExpiryMs,
  resolveConnectionResultMessage as resolveConnectionResultMessageShared,
  resolveConnectionResultRecommendation,
  shouldAcceptConnectionTestResult,
  withConnectionCheckedAt,
} from '../../features/models/connectionTestFreshness'
import type { AppSettings, ServiceConnectionCapability, TranslationKey } from '../../types'
import { pickTranslatedUiText } from '../../lib/uiLanguage'

function resolveConnectionResultMessage(
  result: ConnectionResult,
  uiLanguage: AppSettings['uiLanguage'],
) {
  return resolveConnectionResultMessageShared(
    result,
    uiLanguage,
    (language, key, params) => pickTranslatedUiText(
      language,
      key as TranslationKey,
      params,
    ),
  )
}

function resolveConnectionRecommendation(
  result: ConnectionResult,
  uiLanguage: AppSettings['uiLanguage'],
) {
  return resolveConnectionResultRecommendation(
    result,
    uiLanguage,
    (language, key, params) => pickTranslatedUiText(
      language,
      key as TranslationKey,
      params,
    ),
  )
}

export type UseConnectionTestsOptions = {
  draft: AppSettings
  onTestConnection: (
    capability: ServiceConnectionCapability,
    settings: AppSettings,
  ) => Promise<ConnectionResult>
  handleLoadSpeechVoices: (showStatus?: boolean) => Promise<void>
  onApplyTextConnectionRepair?: (repair: ConnectionTestRepairAction) => void
}

export type ConnectionEvidenceView = {
  tone: 'info' | 'success' | 'warning' | 'error'
  message: string
  checkedAt?: string
  recommendation?: string
  action?: { label: string; run: () => void }
}

export function useConnectionTests({
  draft,
  onTestConnection,
  handleLoadSpeechVoices,
  onApplyTextConnectionRepair,
}: UseConnectionTestsOptions) {
  const [testingTargets, setTestingTargets] = useState<
    Partial<Record<ServiceConnectionCapability, boolean>>
  >({})
  const [testResults, setTestResults] = useState<
    Partial<Record<ServiceConnectionCapability, ConnectionResult>>
  >({})
  const [freshnessTick, setFreshnessTick] = useState(0)
  const requestGenerationRef = useRef<Partial<Record<ServiceConnectionCapability, number>>>({})
  const requestEpochRef = useRef(0)
  const resultFingerprintRef = useRef<Partial<Record<ServiceConnectionCapability, string>>>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Invalidate in-flight requests so late results never call setState.
      requestEpochRef.current += 1
    }
  }, [])

  useEffect(() => {
    const nextExpiry = getNextConnectionResultExpiryMs(Object.values(testResults))
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(
      () => {
        if (!mountedRef.current) return
        setFreshnessTick((current) => current + 1)
      },
      Math.max(0, nextExpiry - Date.now()) + 25,
    )
    return () => window.clearTimeout(timer)
  }, [freshnessTick, testResults])

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

  async function runConnectionTest(capability: ServiceConnectionCapability) {
    const generation = (requestGenerationRef.current[capability] ?? 0) + 1
    const epoch = requestEpochRef.current
    const fingerprint = buildConnectionTestFingerprint(capability, draft)
    requestGenerationRef.current[capability] = generation
    setTestResults((current) => {
      const next = { ...current }
      delete next[capability]
      return next
    })
    setTestingTargets((current) => ({ ...current, [capability]: true }))
    try {
      const result = await onTestConnection(capability, draft)
      if (
        !mountedRef.current
        || !shouldAcceptConnectionTestResult({
          requestGeneration: generation,
          activeGeneration: requestGenerationRef.current[capability] ?? 0,
          requestEpoch: epoch,
          activeEpoch: requestEpochRef.current,
        })
      ) {
        return
      }
      resultFingerprintRef.current[capability] = fingerprint
      setTestResults((current) => ({
        ...current,
        [capability]: withConnectionCheckedAt(result),
      }))

      if (
        capability === 'speech-output'
        && result.ok
        && connectionEvidenceMeetsCapability('speech-output', result.evidence)
        && isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
      ) {
        await handleLoadSpeechVoices(false)
      }
    } catch {
      if (
        !mountedRef.current
        || !shouldAcceptConnectionTestResult({
          requestGeneration: generation,
          activeGeneration: requestGenerationRef.current[capability] ?? 0,
          requestEpoch: epoch,
          activeEpoch: requestEpochRef.current,
        })
      ) {
        return
      }
      resultFingerprintRef.current[capability] = fingerprint
      setTestResults((current) => ({
        ...current,
        [capability]: withConnectionCheckedAt<ConnectionResult>({
          ok: false,
          message: pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.failed'),
        }),
      }))
    } finally {
      if (
        mountedRef.current
        && shouldAcceptConnectionTestResult({
          requestGeneration: generation,
          activeGeneration: requestGenerationRef.current[capability] ?? 0,
          requestEpoch: epoch,
          activeEpoch: requestEpochRef.current,
        })
      ) {
        setTestingTargets((current) => {
          const next = { ...current }
          delete next[capability]
          return next
        })
      }
    }
  }

  function renderTestResult(capability: ServiceConnectionCapability): ReactNode {
    if (testingTargets[capability]) {
      return createElement('div', {
        className: 'settings-test-result is-loading',
        role: 'status',
        'aria-live': 'polite',
      }, pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.testing'))
    }

    const result = testResults[capability]
    if (!result) return null
    const fingerprintMatches = resultFingerprintRef.current[capability]
      === buildConnectionTestFingerprint(capability, draft)
    const presentation = getConnectionTestResultPresentation({
      result,
      fingerprintMatches,
      capability,
    })

    if (presentation.tone === 'stale') {
      const messageKey = presentation.freshness === 'config-stale'
        ? 'settings.test_connection.stale'
        : presentation.freshness === 'time-stale'
          ? 'settings.test_connection.expired'
          : 'settings.test_connection.unverified'
      return createElement('div', {
        className: presentation.className,
        role: 'status',
        'aria-live': 'polite',
      }, [
        createElement('p', { key: 'message' }, pickTranslatedUiText(draft.uiLanguage, messageKey)),
        result.checkedAt ? createElement('time', {
          key: 'checked-at',
          className: 'settings-test-result__meta',
          dateTime: result.checkedAt,
        }, pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.checked_at', {
          time: formatConsoleTimestamp(result.checkedAt, draft.uiLanguage),
        })) : null,
      ])
    }

    if (presentation.tone === 'partial') {
      // Prefer a specific structured message (e.g. synthesis fallback / identity
      // mismatch) when the main process supplied one; otherwise the generic
      // partial copy.
      const partialMessage = result.messageKey
        ? resolveConnectionResultMessage(result, draft.uiLanguage)
        : pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.partial')
      return createElement('div', {
        className: presentation.className,
        role: 'status',
        'aria-live': 'polite',
      }, [
        createElement('p', { key: 'message' }, partialMessage),
        result.checkedAt ? createElement('time', {
          key: 'checked-at',
          className: 'settings-test-result__meta',
          dateTime: result.checkedAt,
        }, pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.checked_at', {
          time: formatConsoleTimestamp(result.checkedAt, draft.uiLanguage),
        })) : null,
        (() => {
          const recommendation = resolveConnectionRecommendation(result, draft.uiLanguage)
          return recommendation ? createElement('p', {
            key: 'recommendation',
            className: 'settings-test-result__recommendation',
          }, recommendation) : null
        })(),
      ])
    }

    const repair = capability === 'text'
      ? buildConnectionTestRepairAction(result, draft)
      : null

    return createElement('div', {
      className: presentation.className ?? 'settings-test-result is-error',
      role: result.ok ? 'status' : 'alert',
      'aria-live': result.ok ? 'polite' : 'assertive',
      'aria-atomic': 'true',
    }, [
      createElement('p', { key: 'message' }, resolveConnectionResultMessage(result, draft.uiLanguage)),
      result.checkedAt ? createElement('time', {
        key: 'checked-at',
        className: 'settings-test-result__meta',
        dateTime: result.checkedAt,
      }, pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.checked_at', {
        time: formatConsoleTimestamp(result.checkedAt, draft.uiLanguage),
      })) : null,
      (() => {
        const recommendation = resolveConnectionRecommendation(result, draft.uiLanguage)
        return recommendation ? (
          createElement(
            'p',
            {
              key: 'recommendation',
              className: 'settings-test-result__recommendation',
            },
            recommendation,
          )
        ) : null
      })(),
      repair && onApplyTextConnectionRepair ? (
        createElement(
          'button',
          {
            key: 'repair',
            type: 'button',
            className: 'ghost-button settings-test-result__action',
            onClick: () => {
              onApplyTextConnectionRepair(repair)
              // Applying a recommended endpoint/model is not proof that the
              // provider is reachable. Clear the stale failure and require a
              // real connection test before showing a green ready state.
              setTestResults((current) => {
                const next = { ...current }
                delete next[capability]
                delete resultFingerprintRef.current[capability]
                return next
              })
            },
          },
          repair.label,
        )
      ) : null,
    ])
  }

  function resetConnectionTests() {
    requestEpochRef.current += 1
    requestGenerationRef.current = {}
    resultFingerprintRef.current = {}
    setTestingTargets({})
    setTestResults({})
  }

  function getTestEvidence(capability: ServiceConnectionCapability): ConnectionEvidenceView | null {
    if (testingTargets[capability]) {
      return { tone: 'info', message: pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.testing') }
    }
    const result = testResults[capability]
    if (!result) return null
    const fingerprintMatches = resultFingerprintRef.current[capability]
      === buildConnectionTestFingerprint(capability, draft)
    const presentation = getConnectionTestResultPresentation({ result, fingerprintMatches, capability })
    let message = resolveConnectionResultMessage(result, draft.uiLanguage)
    if (presentation.tone === 'stale') {
      const key = presentation.freshness === 'config-stale'
        ? 'settings.test_connection.stale'
        : presentation.freshness === 'time-stale'
          ? 'settings.test_connection.expired'
          : 'settings.test_connection.unverified'
      message = pickTranslatedUiText(draft.uiLanguage, key)
    } else if (presentation.tone === 'partial' && !result.messageKey) {
      message = pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.partial')
    }
    const repair = capability === 'text' ? buildConnectionTestRepairAction(result, draft) : null
    return {
      tone: presentation.tone === 'stale' || presentation.tone === 'partial'
        ? 'warning'
        : result.ok ? 'success' : 'error',
      message,
      checkedAt: result.checkedAt
        ? pickTranslatedUiText(draft.uiLanguage, 'settings.test_connection.checked_at', { time: formatConsoleTimestamp(result.checkedAt, draft.uiLanguage) })
        : undefined,
      recommendation: resolveConnectionRecommendation(result, draft.uiLanguage) || undefined,
      action: repair && onApplyTextConnectionRepair ? {
        label: repair.label,
        run: () => {
          onApplyTextConnectionRepair(repair)
          setTestResults((current) => { const next = { ...current }; delete next[capability]; return next })
          delete resultFingerprintRef.current[capability]
        },
      } : undefined,
    }
  }

  return {
    testingTarget: (Object.keys(testingTargets) as ServiceConnectionCapability[])
      .find((capability) => testingTargets[capability]) ?? null,
    isTesting: (capability: ServiceConnectionCapability) => Boolean(testingTargets[capability]),
    testResults,
    runConnectionTest,
    getTestEvidence,
    renderTestResult,
    resetConnectionTests,
  }
}
