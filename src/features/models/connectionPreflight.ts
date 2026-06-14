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
}

type PreflightInput = {
  providerId: string
  apiKey: string
  apiBaseUrl: string
  model: string
  uiLanguage: UiLanguage
}

const HAS_CJK = /[一-鿿぀-ゟ゠-ヿ가-힯]/
const HAS_WHITESPACE = /\s/
const URL_PROTOCOL_RE = /^https?:\/\//i

export function runConnectionPreflight(input: PreflightInput): PreflightResult | null {
  const t = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(input.uiLanguage, key)
  const preset = getApiProviderPreset(input.providerId)

  if (preset.requiresApiKey && !input.apiKey.trim()) {
    return {
      ok: false,
      status: 'needs_key',
      message: t('settings.preflight.no_key'),
      recommendation: t('settings.preflight.no_key_rec'),
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
    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.no_url'),
    }
  }

  if (!URL_PROTOCOL_RE.test(trimmedUrl)) {
    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.bad_url'),
      recommendation: t('settings.preflight.bad_url_rec'),
    }
  }

  if (!input.model.trim()) {
    return {
      ok: false,
      status: 'misconfigured',
      message: t('settings.preflight.no_model'),
    }
  }

  return null
}
