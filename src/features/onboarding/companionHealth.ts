import type {
  NotificationWatcherDiagnosticStatus,
  WebhookDiagnosticInfo,
} from '../context/contextDiagnostics.ts'
import type { PetModelDefinition } from '../pet/models.ts'
import { apiProviderRequiresApiKey } from '../models/providerCatalog.ts'
import {
  isSpeechInputKeyless,
  isSpeechOutputKeyless,
} from '../../lib/audioProviders.ts'
import type { FocusState } from '../../types/autonomy.ts'
import type { AppSettings, PlatformProfile } from '../../types/app.ts'
import type { VoicePipelineState, VoiceState } from '../../types/voice.ts'

export type CompanionHealthStatus = 'ready' | 'warning' | 'blocked'

export type CompanionHealthItemId =
  | 'standard_companion'
  | 'presence_state'
  | 'text_model'
  | 'microphone'
  | 'tts'
  | 'live2d'
  | 'notification_permission'
  | 'local_webhook'
  | 'privacy_boundary'

export type CompanionPresenceReadinessState =
  | 'resting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'away'
  | 'quiet'

export type CompanionHealthItem = {
  id: CompanionHealthItemId
  status: CompanionHealthStatus
  detail: string
  evidence: Record<string, unknown>
}

export type CompanionHealthSummary = {
  status: CompanionHealthStatus
  readyCount: number
  warningCount: number
  blockedCount: number
  totalCount: number
  items: CompanionHealthItem[]
}

export type CompanionHealthSettings = Pick<
  AppSettings,
  | 'apiBaseUrl'
  | 'apiKey'
  | 'apiProviderId'
  | 'autonomyNotificationMessagePreviewEnabled'
  | 'autonomyNotificationsEnabled'
  | 'companionName'
  | 'contextAwarenessEnabled'
  | 'continuousVoiceModeEnabled'
  | 'discordAnnounceMessagePreview'
  | 'macosMessageWatcherEnabled'
  | 'model'
  | 'petModelId'
  | 'speechInputApiBaseUrl'
  | 'speechInputEnabled'
  | 'speechInputProviderId'
  | 'speechOutputApiBaseUrl'
  | 'speechOutputEnabled'
  | 'speechOutputProviderId'
  | 'speechOutputVoice'
  | 'systemPrompt'
  | 'telegramAnnounceMessagePreview'
  | 'userName'
  | 'voiceTriggerMode'
>

export type BuildCompanionHealthInput = {
  focusState?: FocusState
  platformProfile: Pick<PlatformProfile, 'voice'>
  petModel: PetModelDefinition | undefined
  quietReason?: string | null
  settings: CompanionHealthSettings
  voicePipeline: Pick<VoicePipelineState, 'detail' | 'step' | 'updatedAt'>
  voiceState: VoiceState
  watcherStatus?: NotificationWatcherDiagnosticStatus | null
  webhookInfo?: WebhookDiagnosticInfo | null
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function healthItem(
  id: CompanionHealthItemId,
  status: CompanionHealthStatus,
  detail: string,
  evidence: Record<string, unknown>,
): CompanionHealthItem {
  return { id, status, detail, evidence }
}

function getOverallStatus(items: readonly CompanionHealthItem[]): CompanionHealthStatus {
  if (items.some((item) => item.status === 'blocked')) return 'blocked'
  if (items.some((item) => item.status === 'warning')) return 'warning'
  return 'ready'
}

function providerRequiresTextApiKey(providerId: string): boolean {
  try {
    return apiProviderRequiresApiKey(providerId)
  } catch {
    return true
  }
}

function providerIsSpeechInputKeyless(providerId: string): boolean {
  if (!hasText(providerId)) return false
  try {
    return isSpeechInputKeyless(providerId)
  } catch {
    return false
  }
}

function providerIsSpeechOutputKeyless(providerId: string): boolean {
  if (!hasText(providerId)) return false
  try {
    return isSpeechOutputKeyless(providerId)
  } catch {
    return false
  }
}

function resolvePresenceState(
  voiceState: VoiceState,
  quietReason: string | null | undefined,
  focusState: FocusState | undefined,
): CompanionPresenceReadinessState {
  if (hasText(quietReason)) return 'quiet'
  if (voiceState === 'listening') return 'listening'
  if (voiceState === 'processing') return 'thinking'
  if (voiceState === 'speaking') return 'speaking'
  if (focusState === 'away') return 'away'
  return 'resting'
}

function buildStandardCompanionItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const identityReady = hasText(input.settings.userName) && hasText(input.settings.companionName)
  const textReady = hasText(input.settings.apiBaseUrl) && hasText(input.settings.model)
  const live2dReady = Boolean(input.petModel) || hasText(input.settings.petModelId)
  const prompt = input.settings.systemPrompt.toLowerCase()
  const promptFramesCompanion = (
    prompt.includes('desktop companion')
    || prompt.includes('long-term companion')
    || prompt.includes('桌面')
    || prompt.includes('陪伴')
  )

  if (!identityReady || !textReady) {
    return healthItem(
      'standard_companion',
      'blocked',
      `identity=${identityReady}; text=${textReady}; live2d=${live2dReady}`,
      { identityReady, textReady, live2dReady, promptFramesCompanion },
    )
  }

  if (!live2dReady || !promptFramesCompanion) {
    return healthItem(
      'standard_companion',
      'warning',
      `identity=${identityReady}; text=${textReady}; live2d=${live2dReady}; companionPrompt=${promptFramesCompanion}`,
      { identityReady, textReady, live2dReady, promptFramesCompanion },
    )
  }

  return healthItem(
    'standard_companion',
    'ready',
    'Standard companion mode has identity, text model, companion prompt, and desktop pet.',
    { identityReady, textReady, live2dReady, promptFramesCompanion },
  )
}

function buildPresenceItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const presenceState = resolvePresenceState(input.voiceState, input.quietReason, input.focusState)
  const detail = input.quietReason?.trim()
    || input.voicePipeline.detail.trim()
    || `voice=${input.voiceState}; pipeline=${input.voicePipeline.step}`

  return healthItem(
    'presence_state',
    'ready',
    detail,
    {
      presenceState,
      voiceState: input.voiceState,
      voicePipelineStep: input.voicePipeline.step,
      updatedAt: input.voicePipeline.updatedAt,
      quietReason: input.quietReason?.trim() || null,
      focusState: input.focusState ?? null,
    },
  )
}

function buildTextModelItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const providerRequiresKey = providerRequiresTextApiKey(input.settings.apiProviderId)
  const baseUrlReady = hasText(input.settings.apiBaseUrl)
  const modelReady = hasText(input.settings.model)
  const apiKeyReady = !providerRequiresKey || hasText(input.settings.apiKey)

  if (!baseUrlReady || !modelReady) {
    return healthItem(
      'text_model',
      'blocked',
      `baseUrl=${baseUrlReady}; model=${modelReady}`,
      { baseUrlReady, modelReady, providerRequiresKey, apiKeyReady },
    )
  }

  if (!apiKeyReady) {
    return healthItem(
      'text_model',
      'warning',
      'Text model is selected, but this provider usually needs an API key.',
      { baseUrlReady, modelReady, providerRequiresKey, apiKeyReady },
    )
  }

  return healthItem(
    'text_model',
    'ready',
    `${input.settings.apiProviderId} / ${input.settings.model}`,
    { baseUrlReady, modelReady, providerRequiresKey, apiKeyReady },
  )
}

function buildMicrophoneItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const voiceRequested = input.settings.speechInputEnabled || input.settings.continuousVoiceModeEnabled
  const providerReady = hasText(input.settings.speechInputProviderId)
  const keylessProvider = providerIsSpeechInputKeyless(input.settings.speechInputProviderId)
  const baseUrlReady = keylessProvider || hasText(input.settings.speechInputApiBaseUrl)
  const platformSupported = input.platformProfile.voice.speechInputSupported
  const platformAvailable = input.platformProfile.voice.speechInputAvailable

  if (!voiceRequested) {
    return healthItem(
      'microphone',
      'warning',
      'Microphone is optional while voice input is off; push-to-talk can be enabled when the user is ready.',
      { voiceRequested, providerReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!platformSupported) {
    return healthItem(
      'microphone',
      'blocked',
      'This platform profile does not support speech input.',
      { voiceRequested, providerReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!platformAvailable) {
    return healthItem(
      'microphone',
      'warning',
      input.platformProfile.voice.dependencyHint || 'Speech input runtime is not available.',
      { voiceRequested, providerReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!providerReady || !baseUrlReady) {
    return healthItem(
      'microphone',
      'blocked',
      `provider=${providerReady}; baseUrl=${baseUrlReady}`,
      { voiceRequested, providerReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  return healthItem(
    'microphone',
    'ready',
    `${input.settings.speechInputProviderId} is configured for push-to-talk or continuous voice.`,
    { voiceRequested, providerReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
  )
}

function buildTtsItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const ttsRequested = input.settings.speechOutputEnabled || input.settings.continuousVoiceModeEnabled
  const providerReady = hasText(input.settings.speechOutputProviderId)
  const voiceReady = hasText(input.settings.speechOutputVoice)
  const keylessProvider = providerIsSpeechOutputKeyless(input.settings.speechOutputProviderId)
  const baseUrlReady = keylessProvider || hasText(input.settings.speechOutputApiBaseUrl)
  const platformSupported = input.platformProfile.voice.speechOutputSupported
  const platformAvailable = input.platformProfile.voice.speechOutputAvailable

  if (!ttsRequested) {
    return healthItem(
      'tts',
      'warning',
      'TTS is off, so Nexus can chat but will not speak during the standard companion path.',
      { ttsRequested, providerReady, voiceReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!platformSupported) {
    return healthItem(
      'tts',
      'blocked',
      'This platform profile does not support speech output.',
      { ttsRequested, providerReady, voiceReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!platformAvailable) {
    return healthItem(
      'tts',
      'warning',
      input.platformProfile.voice.dependencyHint || 'Speech output runtime is not available.',
      { ttsRequested, providerReady, voiceReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  if (!providerReady || !voiceReady || !baseUrlReady) {
    return healthItem(
      'tts',
      'blocked',
      `provider=${providerReady}; voice=${voiceReady}; baseUrl=${baseUrlReady}`,
      { ttsRequested, providerReady, voiceReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
    )
  }

  return healthItem(
    'tts',
    'ready',
    `${input.settings.speechOutputProviderId} / ${input.settings.speechOutputVoice}`,
    { ttsRequested, providerReady, voiceReady, keylessProvider, baseUrlReady, platformSupported, platformAvailable },
  )
}

function buildLive2dItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const petReady = Boolean(input.petModel)
  const hasExpressionMap = Boolean(input.petModel && Object.keys(input.petModel.expressionMap).length)
  const hasPresenceMotions = Boolean(
    input.petModel?.motionGroups.idle
    || input.petModel?.motionGroups.listeningStart
    || input.petModel?.motionGroups.speakingStart,
  )

  if (!petReady) {
    return healthItem(
      'live2d',
      'warning',
      'No resolved desktop pet model is loaded yet.',
      { petReady, petModelId: input.settings.petModelId, hasExpressionMap, hasPresenceMotions },
    )
  }

  return healthItem(
    'live2d',
    hasExpressionMap || hasPresenceMotions ? 'ready' : 'warning',
    `${input.petModel?.id ?? input.settings.petModelId} desktop presence is available.`,
    { petReady, petModelId: input.petModel?.id ?? input.settings.petModelId, hasExpressionMap, hasPresenceMotions },
  )
}

function buildNotificationPermissionItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const bridgeEnabled = input.settings.autonomyNotificationsEnabled
  const watcherEnabled = input.settings.macosMessageWatcherEnabled
  const watcherStatus = input.watcherStatus?.status ?? 'stopped'
  const platformSupported = input.watcherStatus?.platformSupported ?? null

  if (!bridgeEnabled || !watcherEnabled) {
    return healthItem(
      'notification_permission',
      'warning',
      'Notification awareness is off or the macOS watcher is disabled; Nexus will not proactively notice local messages.',
      { bridgeEnabled, watcherEnabled, watcherStatus, platformSupported },
    )
  }

  if (watcherStatus === 'running') {
    return healthItem(
      'notification_permission',
      'ready',
      'Notification watcher is running.',
      { bridgeEnabled, watcherEnabled, watcherStatus, platformSupported },
    )
  }

  if (watcherStatus === 'needs-permission') {
    return healthItem(
      'notification_permission',
      'warning',
      'Notification watcher needs macOS permission before local messages can be observed.',
      { bridgeEnabled, watcherEnabled, watcherStatus, platformSupported },
    )
  }

  return healthItem(
    'notification_permission',
    'warning',
    input.watcherStatus?.lastError || `Notification watcher is ${watcherStatus}.`,
    { bridgeEnabled, watcherEnabled, watcherStatus, platformSupported },
  )
}

function buildWebhookItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const bridgeEnabled = input.settings.autonomyNotificationsEnabled
  const webhookReady = Boolean(input.webhookInfo?.url && input.webhookInfo.authHeader)

  if (!bridgeEnabled) {
    return healthItem(
      'local_webhook',
      'warning',
      'Notification bridge is off, so the local message webhook is not accepting events.',
      { bridgeEnabled, webhookReady, url: input.webhookInfo?.url ?? null },
    )
  }

  if (!webhookReady) {
    return healthItem(
      'local_webhook',
      'warning',
      'Webhook endpoint or auth header is not available from the desktop bridge.',
      { bridgeEnabled, webhookReady, url: input.webhookInfo?.url ?? null },
    )
  }

  return healthItem(
    'local_webhook',
    'ready',
    `Webhook endpoint is available at ${input.webhookInfo?.url}.`,
    { bridgeEnabled, webhookReady, url: input.webhookInfo?.url ?? null },
  )
}

function buildPrivacyBoundaryItem(input: BuildCompanionHealthInput): CompanionHealthItem {
  const messagePreviewsEnabled = Boolean(
    input.settings.autonomyNotificationMessagePreviewEnabled
    || input.settings.telegramAnnounceMessagePreview
    || input.settings.discordAnnounceMessagePreview,
  )

  if (messagePreviewsEnabled) {
    return healthItem(
      'privacy_boundary',
      'warning',
      'Message body previews are enabled somewhere; v0.4 should default to source and sender only.',
      {
        contextAwarenessEnabled: input.settings.contextAwarenessEnabled,
        autonomyNotificationMessagePreviewEnabled: input.settings.autonomyNotificationMessagePreviewEnabled,
        telegramAnnounceMessagePreview: input.settings.telegramAnnounceMessagePreview,
        discordAnnounceMessagePreview: input.settings.discordAnnounceMessagePreview,
      },
    )
  }

  return healthItem(
    'privacy_boundary',
    'ready',
    'Message awareness keeps body previews gated by explicit permission.',
    {
      contextAwarenessEnabled: input.settings.contextAwarenessEnabled,
      autonomyNotificationMessagePreviewEnabled: input.settings.autonomyNotificationMessagePreviewEnabled,
      telegramAnnounceMessagePreview: input.settings.telegramAnnounceMessagePreview,
      discordAnnounceMessagePreview: input.settings.discordAnnounceMessagePreview,
    },
  )
}

export function buildCompanionHealthSummary(input: BuildCompanionHealthInput): CompanionHealthSummary {
  const items = [
    buildStandardCompanionItem(input),
    buildPresenceItem(input),
    buildTextModelItem(input),
    buildMicrophoneItem(input),
    buildTtsItem(input),
    buildLive2dItem(input),
    buildNotificationPermissionItem(input),
    buildWebhookItem(input),
    buildPrivacyBoundaryItem(input),
  ]
  const readyCount = items.filter((item) => item.status === 'ready').length
  const warningCount = items.filter((item) => item.status === 'warning').length
  const blockedCount = items.filter((item) => item.status === 'blocked').length

  return {
    status: getOverallStatus(items),
    readyCount,
    warningCount,
    blockedCount,
    totalCount: items.length,
    items,
  }
}
