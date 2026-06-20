import { isHttpHeaderSafeCredential } from '../../core/routing/AuthProfileStore.ts'
import { isVaultRefString } from '../../lib/keyVaultBridge.ts'
import { getApiProviderPreset } from './providerCatalog.ts'
import type { UiLanguage } from '../../types/i18n.ts'
import type { ProviderHealthStatus } from '../../types/model.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'

export type PreflightResult = {
  ok: boolean
  status: ProviderHealthStatus
  message: string
  recommendation?: string
  repair?: ConnectionPreflightRepair
}

export type ConnectionPreflightRepair = {
  apiBaseUrl?: string
  model?: string
}

type PreflightInput = {
  providerId: string
  apiKey: string
  apiBaseUrl: string
  model: string
  uiLanguage: UiLanguage
  skipMissingApiKey?: boolean
}

const HAS_CJK = /[一-鿿぀-ゟ゠-ヿ가-힯]/
const HAS_WHITESPACE = /\s/
const URL_PROTOCOL_RE = /^https?:\/\//i

function normalizeProviderId(value: string) {
  return String(value || '').trim().toLowerCase()
}

function trimTrailingSlashes(value: string) {
  return value.trim().replace(/\/+$/u, '')
}

function buildDefaultRepair(
  input: PreflightInput,
  {
    apiBaseUrl,
    model,
  }: {
    apiBaseUrl?: string
    model?: string
  },
): ConnectionPreflightRepair | undefined {
  const repair: ConnectionPreflightRepair = {}
  if (apiBaseUrl) {
    repair.apiBaseUrl = apiBaseUrl
  }
  if (!input.model.trim() && model) {
    repair.model = model
  }
  return Object.keys(repair).length ? repair : undefined
}

export function runConnectionPreflight(input: PreflightInput): PreflightResult | null {
  const t = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(input.uiLanguage, key, params)
  const preset = getApiProviderPreset(input.providerId)
  const providerId = normalizeProviderId(input.providerId)
  const isOllama = providerId === 'ollama'
  const isDeepSeek = providerId === 'deepseek'
  const isCustom = providerId === 'custom'
  const providerLabel = preset.label || input.providerId || 'provider'
  const defaultBaseUrl = preset.baseUrl.trim()
  const defaultModel = preset.defaultModel.trim()

  if (preset.requiresApiKey && !input.apiKey.trim() && !input.skipMissingApiKey) {
    return {
      ok: false,
      status: 'needs_key',
      message: t('settings.preflight.no_key'),
      recommendation: isDeepSeek
        ? t('settings.preflight.no_key_rec_deepseek')
        : t('settings.preflight.no_key_rec_provider', { provider: providerLabel }),
    }
  }

  if (input.apiKey && !isVaultRefString(input.apiKey)) {
    const trimmed = input.apiKey.trim()
    if (HAS_CJK.test(trimmed)) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.cjk_key'),
        recommendation: t('settings.preflight.cjk_key_rec'),
      }
    }
    if (HAS_WHITESPACE.test(trimmed)) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.whitespace_key'),
        recommendation: t('settings.preflight.whitespace_key_rec'),
      }
    }
    if (!isHttpHeaderSafeCredential(trimmed)) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.invalid_key'),
        recommendation: t('settings.preflight.invalid_key_rec'),
      }
    }
  }

  const trimmedUrl = input.apiBaseUrl.trim()
  if (!trimmedUrl) {
    if (isOllama) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.no_url_ollama'),
        recommendation: t('settings.preflight.no_url_ollama_rec', { url: defaultBaseUrl }),
        repair: buildDefaultRepair(input, { apiBaseUrl: defaultBaseUrl, model: defaultModel || 'qwen3:8b' }),
      }
    }

    if (isCustom || !defaultBaseUrl) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.no_url_custom'),
        recommendation: t('settings.preflight.no_url_custom_rec'),
      }
    }

    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.no_url_provider', { provider: providerLabel }),
      recommendation: t('settings.preflight.no_url_provider_rec', { url: defaultBaseUrl }),
      repair: buildDefaultRepair(input, { apiBaseUrl: defaultBaseUrl, model: defaultModel }),
    }
  }

  if (!URL_PROTOCOL_RE.test(trimmedUrl)) {
    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.bad_url'),
      recommendation: isOllama && defaultBaseUrl
        ? t('settings.preflight.bad_url_ollama_rec', { url: defaultBaseUrl })
        : t('settings.preflight.bad_url_rec'),
      repair: buildDefaultRepair(input, {
        apiBaseUrl: defaultBaseUrl,
        model: isOllama ? defaultModel || 'qwen3:8b' : defaultModel,
      }),
    }
  }

  if (isOllama && !/\/v1$/iu.test(trimTrailingSlashes(trimmedUrl))) {
    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.ollama_missing_v1'),
      recommendation: t('settings.preflight.ollama_missing_v1_rec', { url: defaultBaseUrl }),
      repair: buildDefaultRepair(input, { apiBaseUrl: defaultBaseUrl, model: defaultModel || 'qwen3:8b' }),
    }
  }

  if (!input.model.trim()) {
    if (isOllama) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.no_model_ollama'),
        recommendation: t('settings.preflight.no_model_ollama_rec', { model: defaultModel || 'qwen3:8b' }),
        repair: buildDefaultRepair(input, { model: defaultModel || 'qwen3:8b' }),
      }
    }

    if (isCustom || !defaultModel) {
      return {
        ok: false,
        status: 'misconfigured',
        message: t('settings.preflight.no_model_custom'),
        recommendation: t('settings.preflight.no_model_custom_rec'),
      }
    }

    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.no_model_provider', { provider: providerLabel }),
      recommendation: isDeepSeek
        ? t('settings.preflight.no_model_deepseek_rec', { model: defaultModel })
        : t('settings.preflight.no_model_provider_rec', { model: defaultModel }),
      repair: buildDefaultRepair(input, { model: defaultModel }),
    }
  }

  return null
}

export function runTextConnectionTestPreflight(input: PreflightInput): PreflightResult | null {
  const structuralFailure = runConnectionPreflight({
    ...input,
    skipMissingApiKey: true,
  })
  if (structuralFailure && structuralFailure.status !== 'needs_key') {
    return structuralFailure
  }

  return runConnectionPreflight(input)
}
