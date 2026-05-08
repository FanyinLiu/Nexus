import type {
  AppSettings,
  ChatModelListRequest,
  DiscoveredModel,
  ModelCapability,
  ProviderHealthResult,
} from '../../types'
import type { ApiProviderPreset, TextProviderCatalogScope } from './providerCatalog.ts'
import {
  getProviderModelCapability,
  getProviderPresetModels,
  getTextProviderCatalogOptions,
} from './providerCatalog.ts'

export type ModelConnectionSettings = Pick<
  AppSettings,
  'apiProviderId' | 'apiBaseUrl' | 'apiKey' | 'model' | 'textProviderProfiles'
>

export type DiscoveredModelsByProvider = Record<string, DiscoveredModel[]>

export type ModelCatalogProvider = ApiProviderPreset & {
  catalogModelEntries: DiscoveredModel[]
}

export type ProviderCredentialStatus =
  | 'current'
  | 'current_needs_key'
  | 'available'
  | 'needs_key'

function hasSecretValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveProviderConnectionRequest(
  provider: ApiProviderPreset,
  settings: ModelConnectionSettings,
): ChatModelListRequest {
  const profile = settings.textProviderProfiles[provider.id]
  const current = provider.id === settings.apiProviderId

  return {
    providerId: provider.id,
    baseUrl: current ? settings.apiBaseUrl : profile?.apiBaseUrl || provider.baseUrl,
    apiKey: current ? settings.apiKey : profile?.apiKey || '',
    model: current ? settings.model : profile?.model || provider.defaultModel,
  }
}

export function resolveProviderCredentialStatus(
  provider: ApiProviderPreset,
  settings: ModelConnectionSettings,
  hasRuntimeCredential = false,
): ProviderCredentialStatus {
  const isCurrentProvider = provider.id === settings.apiProviderId
  const hasCredential = !provider.requiresApiKey
    || (isCurrentProvider && hasSecretValue(settings.apiKey))
    || hasSecretValue(settings.textProviderProfiles[provider.id]?.apiKey)
    || hasRuntimeCredential

  if (isCurrentProvider && !hasCredential) return 'current_needs_key'
  if (isCurrentProvider) return 'current'
  return hasCredential ? 'available' : 'needs_key'
}

export function getProviderCredentialStatusClass(status: ProviderCredentialStatus) {
  if (status === 'current') return 'is-current'
  if (status === 'available') return 'is-available'
  return 'is-missing'
}

export function resolveProviderModelEntries(
  provider: ApiProviderPreset,
  discoveredModelsByProvider: DiscoveredModelsByProvider,
): DiscoveredModel[] {
  const discoveredModels = discoveredModelsByProvider[provider.id]
  return discoveredModels?.length ? discoveredModels : getProviderPresetModels(provider)
}

export function getModelCatalogProviders(
  scope: TextProviderCatalogScope,
  selectedProviderId: string,
  discoveredModelsByProvider: DiscoveredModelsByProvider,
): ModelCatalogProvider[] {
  return getTextProviderCatalogOptions(scope, selectedProviderId).map((provider) => ({
    ...provider,
    catalogModelEntries: resolveProviderModelEntries(provider, discoveredModelsByProvider),
  }))
}

export function countModelCatalogEntries(providers: ModelCatalogProvider[]) {
  return providers.reduce(
    (count, provider) => count + provider.catalogModelEntries.length,
    0,
  )
}

export function resolveActiveCatalogProvider(
  providers: ModelCatalogProvider[],
  options: {
    catalogProviderId: string | null
    selectedProviderId: string
  },
): ModelCatalogProvider {
  const provider = providers.find((provider) => provider.id === options.catalogProviderId)
    ?? providers.find((provider) => provider.id === options.selectedProviderId)
    ?? providers[0]

  if (!provider) {
    throw new Error('Model catalog has no providers')
  }

  return provider
}

export function resolveActiveCatalogModelId(
  provider: ModelCatalogProvider,
  options: {
    selectedProviderId: string
    selectedModel: string
  },
) {
  if (provider.id === options.selectedProviderId) {
    return options.selectedModel
  }

  return provider.catalogModelEntries[0]?.id ?? provider.defaultModel
}

export function resolveActiveModelCapability(
  provider: ModelCatalogProvider,
  modelId: string,
): ModelCapability {
  return provider.catalogModelEntries
    .find((model) => model.id === modelId)
    ?.capabilities
    ?? getProviderModelCapability(provider, modelId)
}

export function createProviderDiscoveryErrorResult(options: {
  providerId: string
  error: unknown
  recommendation: string
  checkedAt?: string
}): ProviderHealthResult {
  return {
    ok: false,
    providerId: options.providerId,
    status: 'unreachable',
    message: options.error instanceof Error ? options.error.message : String(options.error),
    recommendation: options.recommendation,
    discoveredModels: [],
    checkedAt: options.checkedAt ?? new Date().toISOString(),
  }
}
