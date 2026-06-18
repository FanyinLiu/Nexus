import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildM1FirstRunAuditInput,
  buildM1FirstRunConversationGuide,
  buildM1FirstRunEvidenceReport,
  buildM1FirstRunEvidenceHandoff,
  buildM1FirstRunConversationEvidence,
  buildM1FirstRunModelSetupEvidence,
  buildM1TextConnectionEvidence,
  DEFAULT_M1_FIRST_RUN_BUDGET,
  resolveM1TextConnectionResult,
  resolveM1FirstRunActionMessageKeys,
  resolveM1FirstRunSettingsNavigationTargets,
} from '../src/features/onboarding/firstRunAuditInput.ts'
import type { BuildCompanionHealthInput } from '../src/features/onboarding/companionHealth.ts'
import type { ChatMessage, ServiceConnectionResponse } from '../src/types'

const baseSettings: BuildCompanionHealthInput['settings'] = {
  apiBaseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  apiProviderId: 'ollama',
  autonomyNotificationMessagePreviewEnabled: false,
  autonomyNotificationsEnabled: true,
  companionName: 'Nexus',
  contextAwarenessEnabled: true,
  continuousVoiceModeEnabled: false,
  discordAnnounceMessagePreview: false,
  macosMessageWatcherEnabled: true,
  model: 'qwen3:8b',
  petModelId: 'mao',
  speechInputApiBaseUrl: '',
  speechInputEnabled: true,
  speechInputProviderId: 'local-sensevoice',
  speechOutputApiBaseUrl: '',
  speechOutputEnabled: true,
  speechOutputProviderId: 'edge-tts',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  systemPrompt: 'You are a desktop companion.',
  telegramAnnounceMessagePreview: false,
  userName: 'Klein',
  voiceTriggerMode: 'manual_confirm',
}

const companionHealth: BuildCompanionHealthInput = {
  platformProfile: {
    voice: {
      continuousVoiceSupported: true,
      dependencyHint: null,
      speechInputAvailable: true,
      speechInputSupported: true,
      speechOutputAvailable: true,
      speechOutputSupported: true,
      vadSupported: true,
      wakewordSupported: true,
    },
  },
  petModel: undefined,
  settings: baseSettings,
  voicePipeline: {
    detail: 'Waiting.',
    step: 'idle',
    updatedAt: '2026-06-18T08:00:00.000Z',
  },
  voiceState: 'idle',
  watcherStatus: {
    lastError: null,
    platformSupported: true,
    status: 'running',
  },
  webhookInfo: {
    authHeader: 'Bearer local-token',
    url: 'http://127.0.0.1:47830/webhook',
  },
}

test('M1 model setup evidence treats ready connection tests as checked and available', () => {
  const evidence = buildM1FirstRunModelSetupEvidence(baseSettings, {
    checkedAt: '2026-06-18T08:00:05.000Z',
    message: 'connected',
    ok: true,
    status: 'ready',
  })

  assert.deepEqual(evidence, {
    providerId: 'ollama',
    connectionChecked: true,
    providerReachable: true,
    modelAvailable: true,
  })
})

test('M1 model setup evidence distinguishes model-missing from unreachable', () => {
  const modelMissing = buildM1FirstRunModelSetupEvidence(baseSettings, {
    checkedAt: '2026-06-18T08:00:05.000Z',
    message: 'missing',
    ok: false,
    status: 'model_missing',
  })
  const unreachable = buildM1FirstRunModelSetupEvidence(baseSettings, {
    checkedAt: '2026-06-18T08:00:05.000Z',
    message: 'offline',
    ok: false,
    status: 'unreachable',
  })

  assert.equal(modelMissing.connectionChecked, true)
  assert.equal(modelMissing.providerReachable, true)
  assert.equal(modelMissing.modelAvailable, false)
  assert.equal(unreachable.connectionChecked, true)
  assert.equal(unreachable.providerReachable, false)
  assert.equal(unreachable.modelAvailable, null)
})

test('M1 model setup evidence does not count local preflight failures as connection checks', () => {
  const noKeyPreflight: ServiceConnectionResponse = {
    message: 'missing key',
    ok: false,
    status: 'needs_key',
  }
  const badUrlPreflight: ServiceConnectionResponse = {
    message: 'bad url',
    ok: false,
    status: 'misconfigured',
  }

  assert.deepEqual(buildM1FirstRunModelSetupEvidence({
    ...baseSettings,
    apiProviderId: 'openai',
  }, noKeyPreflight), {
    providerId: 'openai',
    connectionChecked: false,
    providerReachable: null,
    modelAvailable: null,
  })
  assert.equal(buildM1FirstRunModelSetupEvidence(baseSettings, badUrlPreflight).connectionChecked, false)
})

test('M1 first conversation evidence uses roles and timestamps without message text', () => {
  const messagesWithPrivateText: ChatMessage[] = [
    {
      content: 'private setup prompt',
      createdAt: '2026-06-18T08:00:00.000Z',
      id: 'user-1',
      role: 'user',
    },
    {
      content: 'private assistant answer',
      createdAt: '2026-06-18T08:00:02.500Z',
      id: 'assistant-1',
      role: 'assistant',
    },
  ]
  const evidence = buildM1FirstRunConversationEvidence(messagesWithPrivateText)
  const json = JSON.stringify(evidence)

  assert.deepEqual(evidence, {
    attempted: true,
    latencyMs: 2500,
    succeeded: true,
  })
  assert.equal(json.includes('private setup prompt'), false)
  assert.equal(json.includes('private assistant answer'), false)
})

test('M1 first conversation evidence marks assistant error turns as failed', () => {
  assert.deepEqual(buildM1FirstRunConversationEvidence([
    {
      createdAt: '2026-06-18T08:00:00.000Z',
      role: 'user',
      tone: 'neutral',
    },
    {
      createdAt: '2026-06-18T08:00:01.000Z',
      role: 'assistant',
      tone: 'error',
    },
  ]), {
    attempted: true,
    latencyMs: 1000,
    succeeded: false,
  })
})

test('M1 first conversation guide asks for one real starter without copying private text', () => {
  const guide = buildM1FirstRunConversationGuide([])
  const json = JSON.stringify(guide)

  assert.deepEqual(guide, {
    visible: true,
    status: 'waiting_user',
    tone: 'warning',
    messageKey: 'panel.first_run.waiting_user',
    actionLabelKey: 'panel.first_run.action',
    promptKey: 'panel.first_run.prompt',
  })
  assert.equal(json.includes('private setup prompt'), false)
})

test('M1 first conversation guide waits for the first assistant reply after user sends', () => {
  assert.deepEqual(buildM1FirstRunConversationGuide([
    {
      createdAt: '2026-06-18T08:00:00.000Z',
      role: 'user',
      tone: 'neutral',
    },
  ]), {
    visible: true,
    status: 'waiting_assistant',
    tone: 'warning',
    messageKey: 'panel.first_run.waiting_assistant',
    actionLabelKey: null,
    promptKey: null,
  })
})

test('M1 first conversation guide offers retry when the first reply fails', () => {
  assert.deepEqual(buildM1FirstRunConversationGuide([
    {
      createdAt: '2026-06-18T08:00:00.000Z',
      role: 'user',
      tone: 'neutral',
    },
    {
      createdAt: '2026-06-18T08:00:01.000Z',
      role: 'assistant',
      tone: 'error',
    },
  ]), {
    visible: true,
    status: 'failed',
    tone: 'error',
    messageKey: 'panel.first_run.failed',
    actionLabelKey: 'panel.first_run.retry_action',
    promptKey: 'panel.first_run.prompt',
  })
})

test('M1 first conversation guide marks slow first replies without asking for content', () => {
  assert.deepEqual(buildM1FirstRunConversationGuide([
    {
      createdAt: '2026-06-18T08:00:00.000Z',
      role: 'user',
      tone: 'neutral',
    },
    {
      createdAt: '2026-06-18T08:01:01.000Z',
      role: 'assistant',
      tone: 'neutral',
    },
  ], { firstConversationBudgetMinutes: 1 }), {
    visible: true,
    status: 'slow',
    tone: 'warning',
    messageKey: 'panel.first_run.slow',
    actionLabelKey: null,
    promptKey: null,
  })
})

test('M1 first conversation guide hides after an on-budget successful first reply', () => {
  assert.deepEqual(buildM1FirstRunConversationGuide([
    {
      createdAt: '2026-06-18T08:00:00.000Z',
      role: 'user',
      tone: 'neutral',
    },
    {
      createdAt: '2026-06-18T08:00:05.000Z',
      role: 'assistant',
      tone: 'neutral',
    },
  ], { firstConversationBudgetMinutes: 1 }), {
    visible: false,
    status: 'ready',
    tone: 'ready',
    messageKey: 'panel.first_run.ready',
    actionLabelKey: null,
    promptKey: null,
  })
})

test('M1 audit input combines companion health, connection and chat evidence', () => {
  const messagesWithPrivateText: ChatMessage[] = [
    {
      content: 'private user text',
      createdAt: '2026-06-18T08:00:10.000Z',
      id: 'user-1',
      role: 'user',
    },
    {
      content: 'private assistant text',
      createdAt: '2026-06-18T08:00:12.000Z',
      id: 'assistant-1',
      role: 'assistant',
    },
  ]
  const input = buildM1FirstRunAuditInput({
    companionHealth,
    textConnectionResult: {
      checkedAt: '2026-06-18T08:00:05.000Z',
      message: 'connected',
      ok: true,
      status: 'ready',
    },
    chatMessages: messagesWithPrivateText,
  })
  const publicEvidence = {
    modelSetup: input.modelSetup,
    firstConversation: input.firstConversation,
    budget: input.budget,
  }
  const json = JSON.stringify(publicEvidence)

  assert.deepEqual(input.budget, DEFAULT_M1_FIRST_RUN_BUDGET)
  assert.equal(input.modelSetup.connectionChecked, true)
  assert.equal(input.modelSetup.providerReachable, true)
  assert.equal(input.modelSetup.modelAvailable, true)
  assert.equal(input.firstConversation.succeeded, true)
  assert.equal(json.includes('private user text'), false)
  assert.equal(json.includes('private assistant text'), false)
})

test('M1 first-run evidence report is private-safe and actionable from runtime input', () => {
  const messagesWithPrivateText: ChatMessage[] = [
    {
      content: 'private user prompt',
      createdAt: '2026-06-18T08:00:10.000Z',
      id: 'user-1',
      role: 'user',
    },
    {
      content: 'private assistant failure',
      createdAt: '2026-06-18T08:00:12.000Z',
      id: 'assistant-1',
      role: 'assistant',
      tone: 'error',
    },
  ]
  const input = buildM1FirstRunAuditInput({
    companionHealth: {
      ...companionHealth,
      settings: {
        ...baseSettings,
        apiBaseUrl: 'http://localhost:11434/v1',
        model: 'private-local-model',
      },
    },
    textConnectionResult: {
      checkedAt: '2026-06-18T08:00:05.000Z',
      message: 'Ollama connected but requested model is missing.',
      ok: false,
      status: 'model_missing',
    },
    chatMessages: messagesWithPrivateText,
  })
  const report = buildM1FirstRunEvidenceReport(
    input,
    '2026-06-18T08:00:00Z',
    'runtime-console-summary',
  )
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'nexus-v1-m1-first-run-audit')
  assert.equal(report.ok, false)
  assert.equal(report.evidenceSource, 'runtime-console-summary')
  assert.equal(report.modelSetup.connectionChecked, true)
  assert.equal(report.modelSetup.providerReachable, true)
  assert.equal(report.modelSetup.modelAvailable, false)
  assert.ok(report.modelSetup.repairActionIds.includes('pull-ollama-model'))
  assert.ok(report.nextActions.includes('retry-first-conversation-after-model-repair'))
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.equal(json.includes('http://localhost:11434/v1'), false)
  assert.equal(json.includes('private-local-model'), false)
  assert.equal(json.includes('private user prompt'), false)
  assert.equal(json.includes('private assistant failure'), false)
})

test('M1 evidence handoff exposes status and operator commands without private setup values', () => {
  const messagesWithPrivateText: ChatMessage[] = [
    {
      content: 'private user prompt',
      createdAt: '2026-06-18T08:00:10.000Z',
      id: 'user-1',
      role: 'user',
    },
    {
      content: 'private assistant answer',
      createdAt: '2026-06-18T08:00:12.000Z',
      id: 'assistant-1',
      role: 'assistant',
    },
  ]
  const report = buildM1FirstRunEvidenceReport(buildM1FirstRunAuditInput({
    companionHealth: {
      ...companionHealth,
      settings: {
        ...baseSettings,
        apiBaseUrl: 'http://localhost:11434/v1/private',
        apiKey: 'private-api-key',
        model: 'private-local-model',
      },
    },
    textConnectionResult: {
      checkedAt: '2026-06-18T08:00:05.000Z',
      message: 'connected',
      ok: true,
      status: 'ready',
    },
    chatMessages: messagesWithPrivateText,
  }), '2026-06-18T08:00:00Z')
  const handoff = buildM1FirstRunEvidenceHandoff(report)
  const json = JSON.stringify(handoff)

  assert.equal(handoff.reportFile, 'artifacts/v1/m1-first-run-audit.json')
  assert.equal(handoff.statusOutputFile, 'artifacts/v1/m1-first-run-status.json')
  assert.deepEqual(handoff.requiredPlatformIds, ['macos', 'windows', 'linux'])
  assert.equal(handoff.commands[0].id, 'm1-first-run-status')
  assert.equal(handoff.commands[0].safeToRunWithoutEditing, true)
  assert.equal(handoff.commands.filter((command) => command.platform).length, 3)
  assert.ok(handoff.commands.every((command) => command.command.includes('m1:first-run:')))
  assert.ok(handoff.commands.some((command) => command.command.includes('REPLACE_WITH_OBSERVED_AT')))
  assert.ok(handoff.commands.some((command) => command.command.includes('--no-transcript-copied')))
  assert.equal(json.includes('http://localhost:11434/v1/private'), false)
  assert.equal(json.includes('private-api-key'), false)
  assert.equal(json.includes('private-local-model'), false)
  assert.equal(json.includes('private user prompt'), false)
  assert.equal(json.includes('private assistant answer'), false)
})

test('M1 evidence handoff uses a provider placeholder for unsafe custom provider ids', () => {
  const report = buildM1FirstRunEvidenceReport(buildM1FirstRunAuditInput({
    companionHealth: {
      ...companionHealth,
      settings: {
        ...baseSettings,
        apiProviderId: 'custom provider with spaces',
      },
    },
    textConnectionResult: {
      checkedAt: '2026-06-18T08:00:05.000Z',
      message: 'connected',
      ok: true,
      status: 'ready',
    },
    chatMessages: [],
  }), '2026-06-18T08:00:00Z')
  const handoff = buildM1FirstRunEvidenceHandoff(report)
  const operatorCommand = handoff.commands.find((command) => command.platform === 'macos')

  assert.ok(operatorCommand)
  assert.ok(operatorCommand.command.includes('"REPLACE_WITH_PROVIDER_ID"'))
  assert.ok(operatorCommand.placeholderFields.includes('providerId'))
  assert.equal(JSON.stringify(handoff).includes('custom provider with spaces'), false)
})

test('M1 first-run next actions resolve to bounded user-facing copy keys', () => {
  const input = buildM1FirstRunAuditInput({
    companionHealth: {
      ...companionHealth,
      settings: {
        ...baseSettings,
        apiBaseUrl: '',
        apiKey: '',
        apiProviderId: 'openai',
        model: '',
      },
    },
    textConnectionResult: {
      message: 'missing key',
      ok: false,
      status: 'needs_key',
    },
    chatMessages: [],
  })
  const report = buildM1FirstRunEvidenceReport(input, '2026-06-18T08:00:00Z')

  assert.deepEqual(resolveM1FirstRunActionMessageKeys(report, 4), [
    'onboarding.first_run_evidence.action.set_base_url',
    'onboarding.first_run_evidence.action.select_model',
    'onboarding.first_run_evidence.action.add_api_key',
    'onboarding.first_run_evidence.action.check_connection',
  ])
  assert.deepEqual(resolveM1FirstRunActionMessageKeys(report, 5), [
    'onboarding.first_run_evidence.action.set_base_url',
    'onboarding.first_run_evidence.action.select_model',
    'onboarding.first_run_evidence.action.add_api_key',
    'onboarding.first_run_evidence.action.check_connection',
    'onboarding.first_run_evidence.action.rerun_readiness',
  ])
  assert.deepEqual(resolveM1FirstRunActionMessageKeys({
    nextActions: ['unknown-action', 'run-first-conversation-smoke'],
  }, 3), [
    'onboarding.first_run_evidence.action.run_first_message',
  ])
})

test('M1 first-run next actions expose only safe settings navigation targets', () => {
  assert.deepEqual(resolveM1FirstRunSettingsNavigationTargets({
    nextActions: [
      'set-text-provider-base-url',
      'select-text-model',
      'run-first-conversation-smoke',
      'retry-first-conversation-after-model-repair',
      'unknown-action',
    ],
  }), ['model'])
  assert.deepEqual(resolveM1FirstRunSettingsNavigationTargets({
    nextActions: [
      'run-first-conversation-smoke',
      'rerun-companion-readiness',
      'tighten-first-run-five-minute-budget',
      'unknown-action',
    ],
  }), [])
})

test('M1 text connection evidence only reuses matching setup without raw secrets', () => {
  const result: ServiceConnectionResponse = {
    checkedAt: '2026-06-18T08:00:05.000Z',
    message: 'connected',
    ok: true,
    status: 'ready',
  }
  const evidence = buildM1TextConnectionEvidence({
    apiBaseUrl: 'http://localhost:11434/v1/private',
    apiKey: 'private-api-key',
    apiProviderId: 'ollama',
    model: 'private-local-model',
  }, result)
  const json = JSON.stringify(evidence)

  assert.equal(resolveM1TextConnectionResult({
    apiBaseUrl: 'http://localhost:11434/v1/private',
    apiKey: 'private-api-key',
    apiProviderId: 'ollama',
    model: 'private-local-model',
  }, evidence), result)
  assert.equal(resolveM1TextConnectionResult({
    apiBaseUrl: 'http://localhost:11434/v1/private',
    apiKey: 'private-api-key',
    apiProviderId: 'ollama',
    model: 'different-local-model',
  }, evidence), null)
  assert.equal(json.includes('http://localhost:11434/v1/private'), false)
  assert.equal(json.includes('private-api-key'), false)
  assert.equal(json.includes('private-local-model'), false)
})
