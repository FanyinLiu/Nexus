import { createElement, useState, type ReactNode } from 'react'
import {
  isMiniMaxSpeechOutputProvider,
} from '../../lib'
import type { ConnectionResult } from '../settingsDrawerSupport'
import {
  buildConnectionTestRepairAction,
  type ConnectionTestRepairAction,
} from '../../features/models/connectionRepair'
import type { AppSettings, ServiceConnectionCapability } from '../../types'

export type UseConnectionTestsOptions = {
  draft: AppSettings
  onTestConnection: (
    capability: ServiceConnectionCapability,
    settings: AppSettings,
  ) => Promise<ConnectionResult>
  handleLoadSpeechVoices: (showStatus?: boolean) => Promise<void>
  onApplyTextConnectionRepair?: (repair: ConnectionTestRepairAction) => void
}

export function useConnectionTests({
  draft,
  onTestConnection,
  handleLoadSpeechVoices,
  onApplyTextConnectionRepair,
}: UseConnectionTestsOptions) {
  const [testingTarget, setTestingTarget] = useState<ServiceConnectionCapability | null>(null)
  const [testResults, setTestResults] = useState<
    Partial<Record<ServiceConnectionCapability, ConnectionResult>>
  >({})

  async function runConnectionTest(capability: ServiceConnectionCapability) {
    setTestResults((current) => {
      const next = { ...current }
      delete next[capability]
      return next
    })
    setTestingTarget(capability)
    try {
      const result = await onTestConnection(capability, draft)
      setTestResults((current) => ({
        ...current,
        [capability]: result,
      }))

      if (
        capability === 'speech-output'
        && result.ok
        && isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
      ) {
        await handleLoadSpeechVoices(false)
      }
    } catch {
      setTestResults((current) => ({
        ...current,
        [capability]: { ok: false, message: '这次没能连上，可能是网络打了个盹，稍后再试试吧。' },
      }))
    } finally {
      setTestingTarget(null)
    }
  }

  function renderTestResult(capability: ServiceConnectionCapability): ReactNode {
    if (testingTarget === capability) {
      return createElement('div', {
        className: 'settings-test-result is-loading',
        role: 'status',
        'aria-live': 'polite',
      }, '正在连接，请稍等…')
    }

    const result = testResults[capability]
    if (!result) return null
    const repair = capability === 'text'
      ? buildConnectionTestRepairAction(result, draft)
      : null

    return createElement('div', {
      className: result.ok ? 'settings-test-result is-success' : 'settings-test-result is-error',
      role: result.ok ? 'status' : 'alert',
      'aria-live': result.ok ? 'polite' : 'assertive',
      'aria-atomic': 'true',
    }, [
      createElement('p', { key: 'message' }, result.message),
      result.recommendation ? (
        createElement(
          'p',
          {
            key: 'recommendation',
            className: 'settings-test-result__recommendation',
          },
          result.recommendation,
        )
      ) : null,
      repair && onApplyTextConnectionRepair ? (
        createElement(
          'button',
          {
            key: 'repair',
            type: 'button',
            className: 'ghost-button settings-test-result__action',
            onClick: () => {
              onApplyTextConnectionRepair(repair)
              setTestResults((current) => ({
                ...current,
                [capability]: {
                  ok: true,
                  status: 'ready',
                  message: repair.appliedMessage,
                },
              }))
            },
          },
          repair.label,
        )
      ) : null,
    ])
  }

  function resetConnectionTests() {
    setTestingTarget(null)
    setTestResults({})
  }

  return {
    testingTarget,
    testResults,
    runConnectionTest,
    renderTestResult,
    resetConnectionTests,
  }
}
