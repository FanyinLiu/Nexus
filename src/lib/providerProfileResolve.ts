/**
 * Generic provider-profile resolution. Depends only on guards/normalize —
 * safe to import from any layer.
 *
 * Text and speech provider profiles share one skeleton: look up the catalog
 * preset for a provider, fold the stored profile's fields over the preset
 * defaults, and collapse endpoint/credentials for local providers. Per-kind
 * differences (api-key validation, base-url normalization, model resolution,
 * extra fields such as voice/instructions) are injected through options so
 * each domain keeps its own field set.
 */

import { isObject } from './guards.ts'
import { normalizeString } from './normalize.ts'

/** Minimal preset shape the resolver relies on. */
type ProviderProfilePresetShape = {
  baseUrl?: string
  defaultModel?: string
}

/** Stored profiles must expose at least the three core fields. */
type StoredProviderProfileShape = {
  apiBaseUrl?: unknown
  apiKey?: unknown
  model?: unknown
}

/** The core triple every resolved provider profile shares. */
type ResolvedProviderProfileCore = {
  apiBaseUrl: string
  apiKey: string
  model: string
}

export type ResolveProviderProfileOptions<
  Stored extends StoredProviderProfileShape,
  Preset extends ProviderProfilePresetShape,
  Extra extends object = Record<never, never>,
> = {
  getPreset: (providerId: string) => Preset
  /** Local providers persist no endpoint/credentials — collapse both to ''. */
  isLocal?: (providerId: string) => boolean
  /** Defaults to normalizeString. */
  normalizeApiKey?: (value: unknown) => string
  /** Post-processes the folded base URL; defaults to identity. */
  normalizeApiBaseUrl?: (providerId: string, baseUrl: string) => string
  /** Defaults to the folded requested model. */
  resolveModel?: (providerId: string, requestedModel: string, preset: Preset) => string
  /** Additional resolved fields (voice, instructions, ...). */
  resolveExtra?: (stored: Stored | undefined, preset: Preset) => Extra
}

export function resolveProviderProfile<
  Stored extends StoredProviderProfileShape,
  Preset extends ProviderProfilePresetShape,
  Extra extends object = Record<never, never>,
>(
  providerId: string,
  stored: Stored | null | undefined,
  options: ResolveProviderProfileOptions<Stored, Preset, Extra>,
): ResolvedProviderProfileCore & Extra {
  const preset = options.getPreset(providerId)
  const isLocal = options.isLocal?.(providerId) ?? false
  const requestedModel = normalizeString(stored?.model) || preset.defaultModel || ''
  const requestedBaseUrl = normalizeString(stored?.apiBaseUrl) || preset.baseUrl || ''

  const core: ResolvedProviderProfileCore = {
    apiBaseUrl: isLocal
      ? ''
      : (options.normalizeApiBaseUrl?.(providerId, requestedBaseUrl) ?? requestedBaseUrl),
    apiKey: isLocal
      ? ''
      : (options.normalizeApiKey?.(stored?.apiKey) ?? normalizeString(stored?.apiKey)),
    model: options.resolveModel?.(providerId, requestedModel, preset) ?? requestedModel,
  }
  const extra = options.resolveExtra?.(stored ?? undefined, preset)
  // TS drops generic spreads; resolveExtra (when provided) always returns Extra.
  return (extra ? { ...core, ...extra } : core) as ResolvedProviderProfileCore & Extra
}

/**
 * Parse a stored `{ [providerId]: profile }` record, resolving each entry
 * through the given resolver. Non-object entries resolve from defaults.
 */
export function readStoredProviderProfiles<Stored, Resolved>(
  value: unknown,
  resolve: (providerId: string, stored: Stored | undefined) => Resolved,
): Record<string, Resolved> {
  if (!isObject(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, Resolved>>((accumulator, [providerId, profile]) => {
    accumulator[providerId] = resolve(providerId, isObject(profile) ? (profile as Stored) : undefined)
    return accumulator
  }, {})
}
