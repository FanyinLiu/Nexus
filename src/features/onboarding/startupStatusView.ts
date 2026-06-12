import type { PetModelDefinition } from '../pet/models.ts'
import { PET_MODEL_PRESETS } from '../pet/models.ts'
import {
  getApiProviderPreset,
  isCommonTextProviderId,
} from '../models/index.ts'
import type { AppSettings } from '../../types/app.ts'
import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'

export type StartupStatusLevel = 'ok' | 'warning'

export type StartupStatusItem = {
  id: 'preview' | 'bridge' | 'model' | 'avatar' | 'voice'
  detailKey: TranslationKey
  detailParams?: TranslationParams
  labelKey: TranslationKey
  status: StartupStatusLevel
}

type StartupStatusSettings = Pick<
  AppSettings,
  | 'apiKey'
  | 'apiProviderId'
  | 'continuousVoiceModeEnabled'
  | 'model'
  | 'speechInputEnabled'
  | 'speechOutputEnabled'
>

export type ResolveStartupStatusInput = {
  bridgeReady: boolean
  origin: string
  petModel: PetModelDefinition | undefined
  settings: StartupStatusSettings
}

export type StartupStatusSummary = {
  items: StartupStatusItem[]
  warningCount: number
}

export function isDevPreviewOrigin(origin: string) {
  return /^https?:\/\/(127\.0\.0\.1|localhost):47821$/.test(origin)
}

export function isPackagedOrigin(origin: string) {
  return origin === 'file://' || origin === 'null' || origin.startsWith('app://')
}

function resolvePreviewStatus(origin: string): StartupStatusItem {
  if (origin.includes(':11434')) {
    return {
      id: 'preview',
      labelKey: 'settings.startup_status.preview.label',
      status: 'warning',
      detailKey: 'settings.startup_status.preview.ollama_api_warning',
    }
  }

  if (isDevPreviewOrigin(origin)) {
    return {
      id: 'preview',
      labelKey: 'settings.startup_status.preview.label',
      status: 'ok',
      detailKey: 'settings.startup_status.preview.ready',
      detailParams: { origin },
    }
  }

  if (isPackagedOrigin(origin)) {
    return {
      id: 'preview',
      labelKey: 'settings.startup_status.preview.label',
      status: 'ok',
      detailKey: 'settings.startup_status.preview.packaged_or_electron',
    }
  }

  return {
    id: 'preview',
    labelKey: 'settings.startup_status.preview.label',
    status: 'warning',
    detailKey: 'settings.startup_status.preview.other_origin',
    detailParams: { origin: origin || 'unknown' },
  }
}

function resolveModelStatus(settings: StartupStatusSettings): StartupStatusItem {
  const textProvider = getApiProviderPreset(settings.apiProviderId)
  const normalizedModel = settings.model.trim()
  const normalizedApiKey = settings.apiKey.trim()

  if (!normalizedModel) {
    return {
      id: 'model',
      labelKey: 'settings.startup_status.model.label',
      status: 'warning',
      detailKey: 'settings.startup_status.model.missing',
    }
  }

  if (settings.apiProviderId === 'deepseek' && !normalizedApiKey) {
    return {
      id: 'model',
      labelKey: 'settings.startup_status.model.label',
      status: 'warning',
      detailKey: 'settings.startup_status.model.deepseek_missing_key',
    }
  }

  if (isCommonTextProviderId(settings.apiProviderId)) {
    return {
      id: 'model',
      labelKey: 'settings.startup_status.model.label',
      status: 'ok',
      detailKey: 'settings.startup_status.model.ready',
      detailParams: {
        provider: textProvider.label,
        model: normalizedModel,
      },
    }
  }

  return {
    id: 'model',
    labelKey: 'settings.startup_status.model.label',
    status: 'warning',
    detailKey: 'settings.startup_status.model.non_common',
    detailParams: { provider: textProvider.label },
  }
}

function resolveAvatarStatus(petModel: PetModelDefinition | undefined): StartupStatusItem {
  // Built-in presets (Live2D 星绘 included — it is the default now) are
  // always ready; only imported/external models warrant the "custom model,
  // verify it loads" warning.
  const isBuiltIn = !petModel || PET_MODEL_PRESETS.some((preset) => preset.id === petModel.id)

  return {
    id: 'avatar',
    labelKey: 'settings.startup_status.avatar.label',
    status: isBuiltIn ? 'ok' : 'warning',
    detailKey: isBuiltIn
      ? 'settings.startup_status.avatar.nexus_mini'
      : 'settings.startup_status.avatar.custom',
  }
}

function resolveVoiceStatus(settings: StartupStatusSettings): StartupStatusItem {
  const voiceEnabled = (
    settings.speechInputEnabled
    || settings.speechOutputEnabled
    || settings.continuousVoiceModeEnabled
  )

  return {
    id: 'voice',
    labelKey: 'settings.startup_status.voice.label',
    status: voiceEnabled ? 'warning' : 'ok',
    detailKey: voiceEnabled
      ? 'settings.startup_status.voice.enabled'
      : 'settings.startup_status.voice.text_only',
  }
}

export function resolveStartupStatusSummary({
  bridgeReady,
  origin,
  petModel,
  settings,
}: ResolveStartupStatusInput): StartupStatusSummary {
  const items: StartupStatusItem[] = [
    resolvePreviewStatus(origin),
    {
      id: 'bridge',
      labelKey: 'settings.startup_status.bridge.label',
      status: bridgeReady ? 'ok' : 'warning',
      detailKey: bridgeReady
        ? 'settings.startup_status.bridge.ready'
        : 'settings.startup_status.bridge.web_only',
    },
    resolveModelStatus(settings),
    resolveAvatarStatus(petModel),
    resolveVoiceStatus(settings),
  ]

  return {
    items,
    warningCount: items.filter((item) => item.status === 'warning').length,
  }
}
