import type { TranslationKey } from '../../types'

export type CompanionReadinessStatus = 'ready' | 'warning' | 'blocked'

export type CompanionReadinessItemId = 'identity' | 'text' | 'pet' | 'voice'

export type CompanionReadinessItem = {
  id: CompanionReadinessItemId
  status: CompanionReadinessStatus
  messageKey: TranslationKey
}

export type CompanionReadinessSummary = {
  status: CompanionReadinessStatus
  summaryKey: TranslationKey
  items: CompanionReadinessItem[]
}

export type CompanionReadinessInput = {
  userName: string
  companionName: string
  apiBaseUrl: string
  apiKey: string
  model: string
  textProviderRequiresApiKey: boolean
  petModelAvailable: boolean
  speechInputEnabled: boolean
  speechInputProviderId: string
  speechInputApiBaseUrl: string
  speechInputUsesLocalRuntime: boolean
  speechOutputEnabled: boolean
  speechOutputProviderId: string
  speechOutputApiBaseUrl: string
  continuousVoiceModeEnabled: boolean
}

const SUMMARY_KEY_BY_STATUS: Record<CompanionReadinessStatus, TranslationKey> = {
  ready: 'onboarding.readiness.summary.ready',
  warning: 'onboarding.readiness.summary.warning',
  blocked: 'onboarding.readiness.summary.blocked',
}

function hasValue(value: string) {
  return value.trim().length > 0
}

function getOverallStatus(items: CompanionReadinessItem[]): CompanionReadinessStatus {
  if (items.some((item) => item.status === 'blocked')) return 'blocked'
  if (items.some((item) => item.status === 'warning')) return 'warning'
  return 'ready'
}

function buildIdentityItem(input: CompanionReadinessInput): CompanionReadinessItem {
  if (!hasValue(input.userName) || !hasValue(input.companionName)) {
    return {
      id: 'identity',
      status: 'blocked',
      messageKey: 'onboarding.readiness.identity.blocked',
    }
  }

  return {
    id: 'identity',
    status: 'ready',
    messageKey: 'onboarding.readiness.identity.ready',
  }
}

function buildTextItem(input: CompanionReadinessInput): CompanionReadinessItem {
  if (!hasValue(input.apiBaseUrl) || !hasValue(input.model)) {
    return {
      id: 'text',
      status: 'blocked',
      messageKey: 'onboarding.readiness.text.blocked',
    }
  }

  if (input.textProviderRequiresApiKey && !hasValue(input.apiKey)) {
    return {
      id: 'text',
      status: 'warning',
      messageKey: 'onboarding.readiness.text.warning_api_key',
    }
  }

  return {
    id: 'text',
    status: 'ready',
    messageKey: 'onboarding.readiness.text.ready',
  }
}

function buildPetItem(input: CompanionReadinessInput): CompanionReadinessItem {
  if (!input.petModelAvailable) {
    return {
      id: 'pet',
      status: 'warning',
      messageKey: 'onboarding.readiness.pet.warning',
    }
  }

  return {
    id: 'pet',
    status: 'ready',
    messageKey: 'onboarding.readiness.pet.ready',
  }
}

function buildVoiceItem(input: CompanionReadinessInput): CompanionReadinessItem {
  if (input.continuousVoiceModeEnabled && (!input.speechInputEnabled || !input.speechOutputEnabled)) {
    return {
      id: 'voice',
      status: 'warning',
      messageKey: 'onboarding.readiness.voice.warning_continuous',
    }
  }

  if (!input.speechInputEnabled && !input.speechOutputEnabled) {
    return {
      id: 'voice',
      status: 'ready',
      messageKey: 'onboarding.readiness.voice.text_only',
    }
  }

  const speechInputMissing = input.speechInputEnabled
    && (
      !hasValue(input.speechInputProviderId)
      || (!input.speechInputUsesLocalRuntime && !hasValue(input.speechInputApiBaseUrl))
    )
  const speechOutputMissing = input.speechOutputEnabled
    && (
      !hasValue(input.speechOutputProviderId)
      || !hasValue(input.speechOutputApiBaseUrl)
    )

  if (speechInputMissing || speechOutputMissing) {
    return {
      id: 'voice',
      status: 'blocked',
      messageKey: 'onboarding.readiness.voice.blocked',
    }
  }

  return {
    id: 'voice',
    status: 'ready',
    messageKey: 'onboarding.readiness.voice.ready',
  }
}

export function buildCompanionReadiness(input: CompanionReadinessInput): CompanionReadinessSummary {
  const items = [
    buildIdentityItem(input),
    buildTextItem(input),
    buildPetItem(input),
    buildVoiceItem(input),
  ]
  const status = getOverallStatus(items)

  return {
    status,
    summaryKey: SUMMARY_KEY_BY_STATUS[status],
    items,
  }
}
