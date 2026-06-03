export type ModelRunLocation = 'local' | 'cloud' | 'custom'

export interface ModelCapability {
  runLocation: ModelRunLocation
  supportsTools: boolean
  supportsVision: boolean
  supportsSpeech: boolean
  contextWindowTokens: number | null
  requiresApiKey: boolean
}

export type DiscoveredModelSource = 'preset' | 'ollama' | 'custom'

export interface DiscoveredModel {
  id: string
  label: string
  providerId: string
  source: DiscoveredModelSource
  capabilities: ModelCapability
  sizeBytes?: number | null
  modifiedAt?: string | null
  family?: string | null
}

export type ProviderHealthStatus =
  | 'ready'
  | 'needs_key'
  | 'unreachable'
  | 'model_missing'
  | 'misconfigured'
  | 'error'

export interface ProviderHealthResult {
  ok: boolean
  providerId: string
  status: ProviderHealthStatus
  message: string
  recommendation?: string
  discoveredModels?: DiscoveredModel[]
  checkedAt: string
}
