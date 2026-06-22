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

export type ModelConnectionErrorCode =
  | 'missing_api_key'
  | 'api_key_contains_cjk'
  | 'api_key_contains_whitespace'
  | 'api_key_header_unsafe'
  | 'missing_api_base_url'
  | 'invalid_api_base_url'
  | 'ollama_missing_v1'
  | 'missing_model'
  | 'model_not_found'
  | 'auth_failed'
  | 'quota_or_permission'
  | 'rate_limited'
  | 'request_timeout'
  | 'provider_unreachable'
  | 'provider_server_error'
  | 'unknown_connection_error'

export interface ProviderHealthResult {
  ok: boolean
  providerId: string
  status: ProviderHealthStatus
  code?: ModelConnectionErrorCode
  message: string
  recommendation?: string
  discoveredModels?: DiscoveredModel[]
  checkedAt: string
}
