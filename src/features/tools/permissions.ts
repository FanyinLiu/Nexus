import { loadSettings } from '../../lib/index.ts'
import type { BuiltInToolId, BuiltInToolPolicy, MatchedBuiltInTool } from './toolTypes'

type ToolPolicySettingsKeys = {
  enabledKey: string
  requiresConfirmationKey?: string
}

const TOOL_POLICY_SETTING_KEYS: Record<BuiltInToolId, ToolPolicySettingsKeys> = {
  web_search: {
    enabledKey: 'toolWebSearchEnabled',
  },
  weather: {
    enabledKey: 'toolWeatherEnabled',
  },
  open_external: {
    enabledKey: 'toolOpenExternalEnabled',
    requiresConfirmationKey: 'toolOpenExternalRequiresConfirmation',
  },
}

const DEFAULT_TOOL_POLICIES: Record<BuiltInToolId, BuiltInToolPolicy> = {
  web_search: {
    enabled: true,
    requiresConfirmation: false,
  },
  weather: {
    enabled: true,
    requiresConfirmation: false,
  },
  open_external: {
    enabled: true,
    requiresConfirmation: true,
  },
}

function readBooleanValue(
  source: Record<string, unknown>,
  key: string | undefined,
  fallback: boolean,
) {
  if (!key) return fallback
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

function normalizeSettingsRecord(settings: unknown) {
  if (!settings || typeof settings !== 'object') {
    return {}
  }

  return settings as Record<string, unknown>
}

export function resolveBuiltInToolPolicy(toolId: BuiltInToolId, settings?: unknown): BuiltInToolPolicy {
  const defaults = DEFAULT_TOOL_POLICIES[toolId]
  const keys = TOOL_POLICY_SETTING_KEYS[toolId]
  const resolvedSettings = normalizeSettingsRecord(settings ?? (loadSettings() as unknown))

  return {
    enabled: readBooleanValue(resolvedSettings, keys.enabledKey, defaults.enabled),
    requiresConfirmation: readBooleanValue(
      resolvedSettings,
      keys.requiresConfirmationKey,
      defaults.requiresConfirmation,
    ),
  }
}

function buildConfirmationMessage(tool: MatchedBuiltInTool) {
  if (tool.id === 'open_external') {
    return `\u5373\u5c06\u6253\u5f00\u5916\u90e8\u94fe\u63a5\uff1a\n${tool.url}\n\n\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f`
  }

  if (tool.id === 'weather') {
    return `\u5373\u5c06\u8c03\u7528\u5929\u6c14\u67e5\u8be2\uff1a${tool.location}\n\n\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f`
  }

  return `\u5373\u5c06\u8c03\u7528\u7f51\u9875\u641c\u7d22\uff1a${tool.query}\n\n\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f`
}

export async function confirmBuiltInToolExecution(tool: MatchedBuiltInTool, policy: BuiltInToolPolicy): Promise<boolean> {
  if (!policy.requiresConfirmation) {
    return true
  }

  // Use main-process dialog via IPC if available (reliable in all Electron modes)
  if (window.desktopPet?.showConfirmDialog) {
    try {
      return await window.desktopPet.showConfirmDialog(buildConfirmationMessage(tool))
    } catch {
      // Fall through to window.confirm
    }
  }

  if (typeof window.confirm !== 'function') {
    console.warn('[Tools] No confirmation mechanism available, auto-allowing tool:', tool.id)
    return true
  }

  return window.confirm(buildConfirmationMessage(tool))
}
