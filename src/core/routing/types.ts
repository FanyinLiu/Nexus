export type ProviderId = string

export type AuthProfileStatus = 'active' | 'cooldown' | 'failed'

export type AuthProfile = {
  id: string
  providerId: ProviderId
  apiKey: string
  label?: string
  status: AuthProfileStatus
  cooldownUntil?: number
  lastUsedAt?: number
  successCount: number
  failureCount: number
}

export type AuthProfileSnapshot = {
  profiles: AuthProfile[]
}

export type ModelTier = 'cheap' | 'standard' | 'heavy'

export type RoutingRequest = {
  userMessage: string
  historyLength: number
  hasToolCalls: boolean
  hasImages: boolean
  explicitTier?: ModelTier
}

export type RoutingResult = {
  tier: ModelTier
  reason: string
}

export type SmartModelRoutingConfig = {
  maxTier?: ModelTier
  minTier?: ModelTier
}
