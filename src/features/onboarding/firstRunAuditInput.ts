import type {
  ChatMessage,
  ProviderHealthStatus,
  ServiceConnectionResponse,
} from '../../types'
import type { TranslationKey } from '../../types/i18n.ts'
import {
  buildCompanionHealthSummary,
  type BuildCompanionHealthInput,
  type CompanionHealthSettings,
  type CompanionHealthStatus,
} from './companionHealth.ts'

export type M1FirstRunBudgetInput = {
  installBudgetMinutes: number
  modelSetupBudgetMinutes: number
  firstConversationBudgetMinutes: number
}

export type M1FirstRunModelSetupEvidence = {
  providerId: string
  connectionChecked: boolean
  providerReachable: boolean | null
  modelAvailable: boolean | null
}

export type M1FirstRunConversationEvidence = {
  attempted: boolean
  succeeded: boolean
  latencyMs: number | null
}

export type M1FirstRunConversationGuideStatus =
  | 'ready'
  | 'waiting_user'
  | 'waiting_assistant'
  | 'failed'
  | 'slow'

export type M1FirstRunConversationGuide = {
  visible: boolean
  status: M1FirstRunConversationGuideStatus
  tone: 'ready' | 'warning' | 'error'
  messageKey: TranslationKey
  actionLabelKey: TranslationKey | null
  promptKey: TranslationKey | null
}

export type M1TextConnectionEvidence = {
  settingsFingerprint: string
  result: ServiceConnectionResponse
}

export type M1FirstRunAuditInput = {
  companionHealth: BuildCompanionHealthInput
  budget: M1FirstRunBudgetInput
  modelSetup: M1FirstRunModelSetupEvidence
  firstConversation: M1FirstRunConversationEvidence
}

export type M1FirstRunEvidenceReport = {
  schemaVersion: 1
  gate: 'nexus-v1-m1-first-run-audit'
  generatedAt: string
  ok: boolean
  overallStatus: 'ready' | 'needs-first-run-work'
  targetMilestone: 'M1'
  evidenceSource: string
  budget: {
    firstConversationBudgetMinutes: number | null
    installBudgetMinutes: number | null
    modelSetupBudgetMinutes: number | null
    totalBudgetMinutes: number | null
    withinFiveMinutes: boolean
  }
  readiness: {
    ok: boolean
    status: CompanionHealthStatus
    readyCount: number
    warningCount: number
    blockedCount: number
    totalCount: number
    blockingItemIds: string[]
    warningItemIds: string[]
    coveredItemIds: string[]
  }
  modelSetup: M1FirstRunModelSetupEvidence & {
    localProvider: boolean
    apiKeyRequired: boolean
    apiKeyPresent: boolean
    apiKeySatisfied: boolean
    baseUrlPresent: boolean
    modelPresent: boolean
    providerHintId: string
    repairActionIds: string[]
    blockedReasonIds: string[]
  }
  firstConversation: M1FirstRunConversationEvidence & {
    evidencePresent: boolean
    latencyWithinBudget: boolean | null
  }
  nextActions: string[]
  privacy: {
    artifactContentsCopied: false
    privateFieldsOmitted: string[]
  }
}

export type M1FirstRunOperatorPlatform = 'macos' | 'windows' | 'linux'

export type M1FirstRunEvidenceHandoffCommand = {
  id: string
  platform?: M1FirstRunOperatorPlatform
  label: string
  detail: string
  command: string
  placeholderFields: string[]
  safeToRunWithoutEditing: boolean
}

export type M1FirstRunEvidenceHandoff = {
  schemaVersion: 1
  reportFile: string
  statusOutputFile: string
  operatorEvidenceDir: string
  runtimeAuditReady: boolean
  requiredPlatformIds: M1FirstRunOperatorPlatform[]
  commands: M1FirstRunEvidenceHandoffCommand[]
  privacy: {
    artifactContentsCopied: false
    privateFieldsOmitted: string[]
  }
}

export type M1FirstRunSettingsNavigationTarget = 'model'

export type BuildM1FirstRunAuditInputOptions = {
  companionHealth: BuildCompanionHealthInput
  textConnectionResult?: ServiceConnectionResponse | null
  chatMessages?: readonly Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>[]
  budget?: Partial<M1FirstRunBudgetInput>
  firstConversation?: Partial<M1FirstRunConversationEvidence>
}

export const DEFAULT_M1_FIRST_RUN_BUDGET: M1FirstRunBudgetInput = {
  firstConversationBudgetMinutes: 1,
  installBudgetMinutes: 1,
  modelSetupBudgetMinutes: 2,
}

export const DEFAULT_M1_FIRST_RUN_RUNTIME_REPORT_FILE = 'artifacts/v1/m1-first-run-audit.json'
export const DEFAULT_M1_FIRST_RUN_STATUS_OUTPUT_FILE = 'artifacts/v1/m1-first-run-status.json'
export const DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_DIR = 'artifacts/v1'
export const REQUIRED_M1_FIRST_RUN_OPERATOR_PLATFORMS: M1FirstRunOperatorPlatform[] = ['macos', 'windows', 'linux']

export const M1_FIRST_RUN_ACTION_MESSAGE_KEYS: Record<string, TranslationKey> = {
  'set-text-provider-base-url': 'onboarding.first_run_evidence.action.set_base_url',
  'select-text-model': 'onboarding.first_run_evidence.action.select_model',
  'add-provider-api-key': 'onboarding.first_run_evidence.action.add_api_key',
  'check-text-provider-connection': 'onboarding.first_run_evidence.action.check_connection',
  'start-ollama': 'onboarding.first_run_evidence.action.start_ollama',
  'start-local-model-service': 'onboarding.first_run_evidence.action.start_local_service',
  'check-remote-provider-status': 'onboarding.first_run_evidence.action.check_remote_status',
  'pull-ollama-model': 'onboarding.first_run_evidence.action.pull_ollama_model',
  'install-local-model': 'onboarding.first_run_evidence.action.install_local_model',
  'choose-available-model': 'onboarding.first_run_evidence.action.choose_available_model',
  'rerun-companion-readiness': 'onboarding.first_run_evidence.action.rerun_readiness',
  'tighten-first-run-five-minute-budget': 'onboarding.first_run_evidence.action.tighten_budget',
  'run-first-conversation-smoke': 'onboarding.first_run_evidence.action.run_first_message',
  'retry-first-conversation-after-model-repair': 'onboarding.first_run_evidence.action.retry_first_message',
  'reduce-first-conversation-latency': 'onboarding.first_run_evidence.action.reduce_latency',
}

const M1_FIRST_RUN_MODEL_SETTINGS_ACTIONS = new Set([
  'set-text-provider-base-url',
  'select-text-model',
  'add-provider-api-key',
  'check-text-provider-connection',
  'start-ollama',
  'start-local-model-service',
  'check-remote-provider-status',
  'pull-ollama-model',
  'install-local-model',
  'choose-available-model',
  'retry-first-conversation-after-model-repair',
  'reduce-first-conversation-latency',
])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasText(value: unknown): boolean {
  return Boolean(cleanString(value))
}

function quoteCommandValue(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

function providerIdForCommand(value: string): string {
  const providerId = cleanString(value).toLowerCase()
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(providerId)
    ? providerId
    : 'REPLACE_WITH_PROVIDER_ID'
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildM1TextConnectionSettingsFingerprint(
  settings: Pick<CompanionHealthSettings, 'apiBaseUrl' | 'apiKey' | 'apiProviderId' | 'model'>,
): string {
  const payload = JSON.stringify([
    cleanString(settings.apiProviderId),
    cleanString(settings.apiBaseUrl),
    cleanString(settings.model),
    cleanString(settings.apiKey),
  ])
  return `m1-text:${hashString(payload)}`
}

export function buildM1TextConnectionEvidence(
  settings: Pick<CompanionHealthSettings, 'apiBaseUrl' | 'apiKey' | 'apiProviderId' | 'model'>,
  result: ServiceConnectionResponse,
): M1TextConnectionEvidence {
  return {
    settingsFingerprint: buildM1TextConnectionSettingsFingerprint(settings),
    result,
  }
}

export function resolveM1TextConnectionResult(
  settings: Pick<CompanionHealthSettings, 'apiBaseUrl' | 'apiKey' | 'apiProviderId' | 'model'>,
  evidence: M1TextConnectionEvidence | null | undefined,
): ServiceConnectionResponse | null {
  if (!evidence) return null
  return evidence.settingsFingerprint === buildM1TextConnectionSettingsFingerprint(settings)
    ? evidence.result
    : null
}

function normalizeIso(value = new Date().toISOString()): string {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))]
}

function statusIsNetworkBacked(status: ProviderHealthStatus | undefined): boolean {
  return status === 'ready' || status === 'model_missing' || status === 'unreachable'
}

function resultHasCheckedAt(result: ServiceConnectionResponse | null | undefined): boolean {
  return Boolean(cleanString(result?.checkedAt))
}

function resolveProviderReachable(
  result: ServiceConnectionResponse | null | undefined,
  connectionChecked: boolean,
): boolean | null {
  if (!connectionChecked) return null
  if (result?.status === 'unreachable') return false
  return true
}

function resolveModelAvailable(
  settings: CompanionHealthSettings,
  result: ServiceConnectionResponse | null | undefined,
): boolean | null {
  if (!result) return null
  if (result.status === 'model_missing') return false
  if (result.ok) return true

  const selectedModel = cleanString(settings.model)
  if (!selectedModel || !Array.isArray(result.discoveredModels)) return null
  if (!result.discoveredModels.length) return null

  return result.discoveredModels.some((model) => model.id === selectedModel)
}

export function buildM1FirstRunModelSetupEvidence(
  settings: CompanionHealthSettings,
  textConnectionResult?: ServiceConnectionResponse | null,
): M1FirstRunModelSetupEvidence {
  const connectionChecked = Boolean(
    textConnectionResult?.ok
    || resultHasCheckedAt(textConnectionResult)
    || statusIsNetworkBacked(textConnectionResult?.status),
  )

  return {
    providerId: cleanString(settings.apiProviderId) || 'unknown',
    connectionChecked,
    providerReachable: resolveProviderReachable(textConnectionResult, connectionChecked),
    modelAvailable: resolveModelAvailable(settings, textConnectionResult),
  }
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildM1FirstRunConversationEvidence(
  messages: readonly Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>[] = [],
): M1FirstRunConversationEvidence {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user')
  if (firstUserIndex < 0) {
    return {
      attempted: false,
      latencyMs: null,
      succeeded: false,
    }
  }

  const firstUserMessage = messages[firstUserIndex]
  const firstAssistantMessage = messages
    .slice(firstUserIndex + 1)
    .find((message) => message.role === 'assistant')
  const userAt = parseTimestamp(firstUserMessage.createdAt)
  const assistantAt = firstAssistantMessage ? parseTimestamp(firstAssistantMessage.createdAt) : null
  const latencyMs = userAt !== null && assistantAt !== null && assistantAt >= userAt
    ? assistantAt - userAt
    : null

  return {
    attempted: true,
    latencyMs,
    succeeded: Boolean(firstAssistantMessage && firstAssistantMessage.tone !== 'error'),
  }
}

export function buildM1FirstRunConversationGuide(
  messages: readonly Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>[] = [],
  budget: Pick<M1FirstRunBudgetInput, 'firstConversationBudgetMinutes'> = DEFAULT_M1_FIRST_RUN_BUDGET,
): M1FirstRunConversationGuide {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user')
  if (firstUserIndex < 0) {
    return {
      visible: true,
      status: 'waiting_user',
      tone: 'warning',
      messageKey: 'panel.first_run.waiting_user',
      actionLabelKey: 'panel.first_run.action',
      promptKey: 'panel.first_run.prompt',
    }
  }

  const firstAssistantMessage = messages
    .slice(firstUserIndex + 1)
    .find((message) => message.role === 'assistant')
  if (!firstAssistantMessage) {
    return {
      visible: true,
      status: 'waiting_assistant',
      tone: 'warning',
      messageKey: 'panel.first_run.waiting_assistant',
      actionLabelKey: null,
      promptKey: null,
    }
  }

  const evidence = buildM1FirstRunConversationEvidence(messages)
  if (!evidence.succeeded) {
    return {
      visible: true,
      status: 'failed',
      tone: 'error',
      messageKey: 'panel.first_run.failed',
      actionLabelKey: 'panel.first_run.retry_action',
      promptKey: 'panel.first_run.prompt',
    }
  }

  const latencyBudgetMs = Number.isFinite(budget.firstConversationBudgetMinutes)
    ? budget.firstConversationBudgetMinutes * 60 * 1000
    : null
  if (
    evidence.latencyMs !== null
    && latencyBudgetMs !== null
    && evidence.latencyMs > latencyBudgetMs
  ) {
    return {
      visible: true,
      status: 'slow',
      tone: 'warning',
      messageKey: 'panel.first_run.slow',
      actionLabelKey: null,
      promptKey: null,
    }
  }

  return {
    visible: false,
    status: 'ready',
    tone: 'ready',
    messageKey: 'panel.first_run.ready',
    actionLabelKey: null,
    promptKey: null,
  }
}

function normalizeBudget(input: Partial<M1FirstRunBudgetInput> | undefined): M1FirstRunBudgetInput {
  return {
    firstConversationBudgetMinutes: input?.firstConversationBudgetMinutes
      ?? DEFAULT_M1_FIRST_RUN_BUDGET.firstConversationBudgetMinutes,
    installBudgetMinutes: input?.installBudgetMinutes
      ?? DEFAULT_M1_FIRST_RUN_BUDGET.installBudgetMinutes,
    modelSetupBudgetMinutes: input?.modelSetupBudgetMinutes
      ?? DEFAULT_M1_FIRST_RUN_BUDGET.modelSetupBudgetMinutes,
  }
}

function summarizeBudget(input: M1FirstRunBudgetInput): M1FirstRunEvidenceReport['budget'] {
  const values = [
    input.installBudgetMinutes,
    input.modelSetupBudgetMinutes,
    input.firstConversationBudgetMinutes,
  ]
  const totalBudgetMinutes = values.every((value) => Number.isFinite(value) && value >= 0)
    ? values.reduce((sum, value) => sum + value, 0)
    : null

  return {
    firstConversationBudgetMinutes: Number.isFinite(input.firstConversationBudgetMinutes)
      ? input.firstConversationBudgetMinutes
      : null,
    installBudgetMinutes: Number.isFinite(input.installBudgetMinutes)
      ? input.installBudgetMinutes
      : null,
    modelSetupBudgetMinutes: Number.isFinite(input.modelSetupBudgetMinutes)
      ? input.modelSetupBudgetMinutes
      : null,
    totalBudgetMinutes,
    withinFiveMinutes: totalBudgetMinutes !== null && totalBudgetMinutes <= 5,
  }
}

function isLocalProvider(providerId: string): boolean {
  const id = cleanString(providerId).toLowerCase()
  return [
    'ollama',
    'lm-studio',
    'jan',
    'local',
    'kobold',
    'llamacpp',
    'custom-local',
  ].some((token) => id.includes(token))
}

function repairActionForUnavailableProvider(providerId: string): string {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'start-ollama'
  if (isLocalProvider(providerId)) return 'start-local-model-service'
  return 'check-remote-provider-status'
}

function repairActionForMissingModel(providerId: string): string {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'pull-ollama-model'
  if (isLocalProvider(providerId)) return 'install-local-model'
  return 'choose-available-model'
}

function providerHintId(providerId: string): string {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'ollama-start-serve-and-pull-selected-model'
  if (id.includes('deepseek')) return 'deepseek-check-api-key-base-url-and-model'
  if (id.includes('openai')) return 'openai-compatible-check-api-key-base-url-and-model'
  if (isLocalProvider(providerId)) return 'local-provider-start-service-and-select-model'
  return 'provider-check-base-url-key-and-model'
}

function buildReadinessReport(input: M1FirstRunAuditInput): M1FirstRunEvidenceReport['readiness'] {
  const summary = buildCompanionHealthSummary(input.companionHealth)
  return {
    ok: summary.status === 'ready',
    status: summary.status,
    readyCount: summary.readyCount,
    warningCount: summary.warningCount,
    blockedCount: summary.blockedCount,
    totalCount: summary.totalCount,
    blockingItemIds: summary.items
      .filter((item) => item.status === 'blocked')
      .map((item) => item.id),
    warningItemIds: summary.items
      .filter((item) => item.status === 'warning')
      .map((item) => item.id),
    coveredItemIds: summary.items.map((item) => item.id),
  }
}

function buildModelSetupReport(input: M1FirstRunAuditInput): M1FirstRunEvidenceReport['modelSetup'] {
  const summary = buildCompanionHealthSummary(input.companionHealth)
  const textModelItem = summary.items.find((item) => item.id === 'text_model')
  const textEvidence = textModelItem?.evidence ?? {}
  const providerId = cleanString(input.modelSetup.providerId) || 'unknown'
  const baseUrlPresent = Boolean(textEvidence.baseUrlReady)
  const modelPresent = Boolean(textEvidence.modelReady)
  const apiKeyRequired = Boolean(textEvidence.providerRequiresKey)
  const apiKeyPresent = hasText(input.companionHealth.settings.apiKey)
  const apiKeySatisfied = !apiKeyRequired || apiKeyPresent
  const localProvider = isLocalProvider(providerId)
  const blockedReasonIds: string[] = []
  const repairActionIds: string[] = []

  if (!baseUrlPresent) {
    blockedReasonIds.push('missing-base-url')
    repairActionIds.push('set-text-provider-base-url')
  }
  if (!modelPresent) {
    blockedReasonIds.push('missing-model')
    repairActionIds.push('select-text-model')
  }
  if (!apiKeySatisfied) {
    blockedReasonIds.push('missing-api-key')
    repairActionIds.push('add-provider-api-key')
  }
  if (!input.modelSetup.connectionChecked) {
    blockedReasonIds.push('connection-not-checked')
    repairActionIds.push('check-text-provider-connection')
    if (localProvider) repairActionIds.push(repairActionForUnavailableProvider(providerId))
  }
  if (input.modelSetup.providerReachable === false) {
    blockedReasonIds.push('provider-unreachable')
    repairActionIds.push(repairActionForUnavailableProvider(providerId))
  }
  if (input.modelSetup.modelAvailable === false) {
    blockedReasonIds.push('model-unavailable')
    repairActionIds.push(repairActionForMissingModel(providerId))
  }

  return {
    ...input.modelSetup,
    providerId,
    localProvider,
    apiKeyRequired,
    apiKeyPresent,
    apiKeySatisfied,
    baseUrlPresent,
    modelPresent,
    providerHintId: providerHintId(providerId),
    repairActionIds: unique(repairActionIds),
    blockedReasonIds: unique(blockedReasonIds),
  }
}

function buildFirstConversationReport(
  input: M1FirstRunAuditInput,
  budget: M1FirstRunEvidenceReport['budget'],
): M1FirstRunEvidenceReport['firstConversation'] {
  const latencyBudgetMs = budget.firstConversationBudgetMinutes === null
    ? null
    : budget.firstConversationBudgetMinutes * 60 * 1000
  const latencyWithinBudget = input.firstConversation.latencyMs === null || latencyBudgetMs === null
    ? null
    : input.firstConversation.latencyMs <= latencyBudgetMs

  return {
    ...input.firstConversation,
    evidencePresent: input.firstConversation.attempted && input.firstConversation.succeeded,
    latencyWithinBudget,
  }
}

function buildNextActions(
  readiness: M1FirstRunEvidenceReport['readiness'],
  budget: M1FirstRunEvidenceReport['budget'],
  modelSetup: M1FirstRunEvidenceReport['modelSetup'],
  firstConversation: M1FirstRunEvidenceReport['firstConversation'],
): string[] {
  const actions = [...modelSetup.repairActionIds]
  if (!readiness.ok) actions.push('rerun-companion-readiness')
  if (!budget.withinFiveMinutes) actions.push('tighten-first-run-five-minute-budget')
  if (!firstConversation.attempted) actions.push('run-first-conversation-smoke')
  if (firstConversation.attempted && !firstConversation.succeeded) {
    actions.push('retry-first-conversation-after-model-repair')
  }
  if (firstConversation.latencyWithinBudget === false) {
    actions.push('reduce-first-conversation-latency')
  }
  return unique(actions)
}

export function resolveM1FirstRunActionMessageKeys(
  report: Pick<M1FirstRunEvidenceReport, 'nextActions'>,
  limit = 3,
): TranslationKey[] {
  const keys = report.nextActions
    .map((action) => M1_FIRST_RUN_ACTION_MESSAGE_KEYS[action])
    .filter((key): key is TranslationKey => Boolean(key))

  return limit > 0 ? keys.slice(0, limit) : keys
}

export function resolveM1FirstRunSettingsNavigationTargets(
  report: Pick<M1FirstRunEvidenceReport, 'nextActions'>,
): M1FirstRunSettingsNavigationTarget[] {
  const targets = report.nextActions.map((action) => (
    M1_FIRST_RUN_MODEL_SETTINGS_ACTIONS.has(action) ? 'model' : null
  ))

  return unique(targets.filter((target): target is M1FirstRunSettingsNavigationTarget => Boolean(target)))
}

export function buildM1FirstRunAuditInput(
  options: BuildM1FirstRunAuditInputOptions,
): M1FirstRunAuditInput {
  const inferredConversation = buildM1FirstRunConversationEvidence(options.chatMessages)
  const conversation = {
    attempted: options.firstConversation?.attempted ?? inferredConversation.attempted,
    latencyMs: options.firstConversation?.latencyMs ?? inferredConversation.latencyMs,
    succeeded: options.firstConversation?.succeeded ?? inferredConversation.succeeded,
  }

  return {
    companionHealth: options.companionHealth,
    budget: normalizeBudget(options.budget),
    modelSetup: buildM1FirstRunModelSetupEvidence(
      options.companionHealth.settings,
      options.textConnectionResult,
    ),
    firstConversation: conversation,
  }
}

export function buildM1FirstRunEvidenceReport(
  input: M1FirstRunAuditInput,
  generatedAt = new Date().toISOString(),
  evidenceSource = 'runtime-safe-summary',
): M1FirstRunEvidenceReport {
  const budget = summarizeBudget(input.budget)
  const readiness = buildReadinessReport(input)
  const modelSetup = buildModelSetupReport(input)
  const firstConversation = buildFirstConversationReport(input, budget)
  const nextActions = buildNextActions(readiness, budget, modelSetup, firstConversation)
  const ok = (
    readiness.ok
    && budget.withinFiveMinutes
    && modelSetup.blockedReasonIds.length === 0
    && firstConversation.evidencePresent
    && firstConversation.latencyWithinBudget !== false
  )

  return {
    schemaVersion: 1,
    gate: 'nexus-v1-m1-first-run-audit',
    generatedAt: normalizeIso(generatedAt),
    ok,
    overallStatus: ok ? 'ready' : 'needs-first-run-work',
    targetMilestone: 'M1',
    evidenceSource,
    budget,
    readiness,
    modelSetup,
    firstConversation,
    nextActions,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'userName',
        'companionName',
        'systemPrompt',
        'apiKey',
        'apiBaseUrl',
        'selected model name',
        'speech provider endpoint URLs',
        'webhook URL',
        'webhook auth header',
        'voice transcripts',
        'chat prompt and answer text',
      ],
    },
  }
}

export function buildM1FirstRunEvidenceHandoff(
  report: Pick<M1FirstRunEvidenceReport, 'ok' | 'modelSetup' | 'privacy'>,
  options: Partial<Pick<M1FirstRunEvidenceHandoff, 'operatorEvidenceDir' | 'reportFile' | 'statusOutputFile'>> = {},
): M1FirstRunEvidenceHandoff {
  const reportFile = cleanString(options.reportFile) || DEFAULT_M1_FIRST_RUN_RUNTIME_REPORT_FILE
  const statusOutputFile = cleanString(options.statusOutputFile) || DEFAULT_M1_FIRST_RUN_STATUS_OUTPUT_FILE
  const operatorEvidenceDir = cleanString(options.operatorEvidenceDir) || DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_DIR
  const providerId = providerIdForCommand(report.modelSetup.providerId)
  const statusCommand = [
    'npm run m1:first-run:status --',
    '--audit-file',
    quoteCommandValue(reportFile),
    '--operator-dir',
    quoteCommandValue(operatorEvidenceDir),
    '--output',
    quoteCommandValue(statusOutputFile),
  ].join(' ')
  const commands: M1FirstRunEvidenceHandoffCommand[] = [
    {
      id: 'm1-first-run-status',
      label: 'M1 status rollup',
      detail: 'Summarizes the saved runtime report and platform operator records.',
      command: statusCommand,
      placeholderFields: [],
      safeToRunWithoutEditing: true,
    },
  ]

  for (const platform of REQUIRED_M1_FIRST_RUN_OPERATOR_PLATFORMS) {
    const outputFile = `${operatorEvidenceDir}/m1-first-run-operator-${platform}.json`
    const command = [
      'npm run m1:first-run:record --',
      '--platform',
      platform,
      '--observed-at',
      quoteCommandValue('REPLACE_WITH_OBSERVED_AT'),
      '--operator',
      quoteCommandValue('REPLACE_WITH_OPERATOR'),
      '--provider-id',
      quoteCommandValue(providerId),
      '--latency-ms',
      'REPLACE_WITH_LATENCY_MS',
      '--app-started',
      '--model-connection-checked',
      '--first-message-sent',
      '--assistant-reply-observed',
      '--panel-guide-ready',
      '--private-safe-report-copied',
      '--no-transcript-copied',
      '--output',
      quoteCommandValue(outputFile),
      '--require-ready',
    ].join(' ')

    commands.push({
      id: `m1-first-run-record-${platform}`,
      platform,
      label: `${platform} operator record`,
      detail: 'Replace placeholders only after a real first reply is observed on this platform.',
      command,
      placeholderFields: ['observedAt', 'operator', 'latencyMs'].concat(
        providerId === 'REPLACE_WITH_PROVIDER_ID' ? ['providerId'] : [],
      ),
      safeToRunWithoutEditing: false,
    })
  }

  return {
    schemaVersion: 1,
    reportFile,
    statusOutputFile,
    operatorEvidenceDir,
    runtimeAuditReady: report.ok === true,
    requiredPlatformIds: REQUIRED_M1_FIRST_RUN_OPERATOR_PLATFORMS,
    commands,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: unique([
        ...report.privacy.privateFieldsOmitted,
        'operator names and notes',
        'first message prompt text',
        'assistant first reply text',
        'voice transcripts',
      ]),
    },
  }
}
