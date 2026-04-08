import { createElement, useState, type ReactNode } from 'react'
import {
  isMiniMaxSpeechOutputProvider,
} from '../../lib'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type { AppSettings, ServiceConnectionCapability } from '../../types'

export type UseConnectionTestsOptions = {
  draft: AppSettings
  onTestConnection: (
    capability: ServiceConnectionCapability,
    settings: AppSettings,
  ) => Promise<ConnectionResult>
  handleLoadSpeechVoices: (showStatus?: boolean) => Promise<void>
}

export function useConnectionTests({
  draft,
  onTestConnection,
  handleLoadSpeechVoices,
}: UseConnectionTestsOptions) {
  const [testingTarget, setTestingTarget] = useState<ServiceConnectionCapability | null>(null)
  const [testResults, setTestResults] = useState<
    Partial<Record<ServiceConnectionCapability, ConnectionResult>>
  >({})

  async function runConnectionTest(capability: ServiceConnectionCapability) {
    setTestingTarget(capability)
    const result = await onTestConnection(capability, draft)
    setTestResults((current) => ({
      ...current,
      [capability]: result,
    }))
    setTestingTarget(null)

    if (
      capability === 'speech-output'
      && result.ok
      && isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
    ) {
      await handleLoadSpeechVoices(false)
    }
  }

  function renderTestResult(capability: ServiceConnectionCapability): ReactNode {
    const result = testResults[capability]
    if (!result) return null

    return createElement('div', {
      className: result.ok ? 'settings-test-result is-success' : 'settings-test-result is-error',
    }, result.message)
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
