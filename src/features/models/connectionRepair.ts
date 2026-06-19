import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { AppSettings } from '../../types/app.ts'
import type { UiLanguage } from '../../types/i18n.ts'
import type { DiscoveredModel, ProviderHealthStatus } from '../../types/model.ts'
import { getApiProviderPreset } from './providerCatalog.ts'
import type { ConnectionPreflightRepair } from './connectionPreflight.ts'

export type ConnectionRepairSource = {
  ok: boolean
  status?: ProviderHealthStatus
  repair?: ConnectionPreflightRepair
  discoveredModels?: DiscoveredModel[]
}

export type ConnectionTestRepairAction = {
  label: string
  appliedMessage: string
  patch: ConnectionPreflightRepair
}

function trimTrailingSlashes(value: string) {
  return value.trim().replace(/\/+$/u, '')
}

function hasRepairPatch(repair: ConnectionPreflightRepair | undefined): repair is ConnectionPreflightRepair {
  return Boolean(repair && (repair.apiBaseUrl || repair.model))
}

function normalizePatch(patch: ConnectionPreflightRepair): ConnectionPreflightRepair | null {
  const next: ConnectionPreflightRepair = {}
  if (patch.apiBaseUrl?.trim()) {
    next.apiBaseUrl = patch.apiBaseUrl.trim()
  }
  if (patch.model?.trim()) {
    next.model = patch.model.trim()
  }
  return hasRepairPatch(next) ? next : null
}

function pickInstalledModel(result: ConnectionRepairSource, currentModel: string) {
  const installedModels = result.discoveredModels
    ?.map((model) => model.id.trim())
    .filter(Boolean) ?? []
  if (!installedModels.length || installedModels.includes(currentModel.trim())) {
    return ''
  }
  return installedModels[0]
}

function buildPostTestRepairPatch(
  result: ConnectionRepairSource,
  settings: Pick<AppSettings, 'apiProviderId' | 'apiBaseUrl' | 'model'>,
): ConnectionPreflightRepair | null {
  if (result.status !== 'misconfigured' && result.status !== 'model_missing') {
    return null
  }

  const preset = getApiProviderPreset(settings.apiProviderId)
  if (preset.id !== settings.apiProviderId || preset.id === 'custom') {
    return null
  }

  const installedModel = pickInstalledModel(result, settings.model)
  if (installedModel) {
    return { model: installedModel }
  }

  const patch: ConnectionPreflightRepair = {}
  const defaultBaseUrl = preset.baseUrl.trim()
  const defaultModel = preset.defaultModel.trim()
  const currentBaseUrl = trimTrailingSlashes(settings.apiBaseUrl)
  const currentModel = settings.model.trim()

  if (
    result.status === 'misconfigured'
    && defaultBaseUrl
    && currentBaseUrl !== trimTrailingSlashes(defaultBaseUrl)
  ) {
    patch.apiBaseUrl = defaultBaseUrl
  }

  if (
    defaultModel
    && (
      !currentModel
      || result.status === 'model_missing'
      || (result.status === 'misconfigured' && !preset.models.includes(currentModel))
    )
  ) {
    patch.model = defaultModel
  }

  return normalizePatch(patch)
}

export function buildConnectionTestRepairAction(
  result: ConnectionRepairSource,
  settings: Pick<AppSettings, 'apiProviderId' | 'apiBaseUrl' | 'model' | 'uiLanguage'>,
): ConnectionTestRepairAction | null {
  if (result.ok) return null

  const patch = normalizePatch(result.repair ?? {})
    ?? buildPostTestRepairPatch(result, settings)
  if (!patch) return null

  const uiLanguage: UiLanguage = settings.uiLanguage
  return {
    label: pickTranslatedUiText(uiLanguage, 'settings.connection_repair.apply'),
    appliedMessage: pickTranslatedUiText(uiLanguage, 'settings.connection_repair.applied'),
    patch,
  }
}

export function applyConnectionTestRepairDraft(
  draft: AppSettings,
  repair: ConnectionTestRepairAction,
): AppSettings {
  return {
    ...draft,
    ...repair.patch,
  }
}
