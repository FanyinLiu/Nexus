import {
  getWebSearchProviderPreset,
  resolveWebSearchApiBaseUrl,
  WEB_SEARCH_PROVIDER_PRESETS,
  type WebSearchProviderPreset,
} from '../../lib/webSearchProviders.ts'
import type {
  ToolSettings,
} from '../../types'

export type WebSearchProviderView = {
  provider: WebSearchProviderPreset
  providers: WebSearchProviderPreset[]
}

export function resolveWebSearchProviderView(
  settings: Pick<ToolSettings, 'toolWebSearchProviderId'>,
): WebSearchProviderView {
  return {
    provider: getWebSearchProviderPreset(settings.toolWebSearchProviderId),
    providers: WEB_SEARCH_PROVIDER_PRESETS,
  }
}

export function resolveWebSearchProviderUpdate(
  current: Pick<
    ToolSettings,
    'toolWebSearchProviderId' | 'toolWebSearchApiBaseUrl' | 'toolWebSearchApiKey'
  >,
  providerId: string,
): Pick<
  ToolSettings,
  'toolWebSearchProviderId' | 'toolWebSearchApiBaseUrl' | 'toolWebSearchApiKey'
> {
  const preset = getWebSearchProviderPreset(providerId)

  return {
    toolWebSearchProviderId: preset.id,
    toolWebSearchApiBaseUrl: resolveWebSearchApiBaseUrl(preset.id, current.toolWebSearchApiBaseUrl),
    toolWebSearchApiKey: preset.id === current.toolWebSearchProviderId
      ? current.toolWebSearchApiKey
      : '',
  }
}
