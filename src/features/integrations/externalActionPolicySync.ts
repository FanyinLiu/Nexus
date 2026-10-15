import type { AppSettings, IntegrationPermissionMode } from '../../types'

type ExternalActionIntegrationId = 'telegram' | 'discord' | 'minecraft' | 'factorio' | 'mcp'

export type ExternalActionPolicySyncPayload = {
  policies: Record<ExternalActionIntegrationId, {
    mode: IntegrationPermissionMode
    active: boolean
  }>
  desktopContext: {
    activeWindow: boolean
    clipboard: boolean
    screenshot: boolean
  }
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function buildExternalActionPolicySyncPayload(settings: AppSettings): ExternalActionPolicySyncPayload {
  const contextAwarenessEnabled = settings.contextAwarenessEnabled === true
  return {
    desktopContext: {
      activeWindow: contextAwarenessEnabled && settings.activeWindowContextEnabled === true,
      clipboard: contextAwarenessEnabled && settings.clipboardContextEnabled === true,
      screenshot: contextAwarenessEnabled && settings.screenContextEnabled === true,
    },
    policies: {
      telegram: {
        mode: settings.telegramPermissionMode,
        active: settings.telegramIntegrationEnabled && hasText(settings.telegramBotToken),
      },
      discord: {
        mode: settings.discordPermissionMode,
        active: settings.discordIntegrationEnabled && hasText(settings.discordBotToken),
      },
      minecraft: {
        mode: settings.minecraftPermissionMode,
        active: settings.minecraftIntegrationEnabled && hasText(settings.minecraftServerAddress),
      },
      factorio: {
        mode: settings.factorioPermissionMode,
        active: settings.factorioIntegrationEnabled && hasText(settings.factorioServerAddress),
      },
      mcp: {
        mode: settings.mcpPermissionMode,
        active: Array.isArray(settings.mcpServers) && settings.mcpServers.some((server) => (
          Boolean(server?.enabled) && hasText(server?.command)
        )),
      },
    },
  }
}

export async function syncExternalActionPolicyToMain(settings: AppSettings): Promise<void> {
  const sync = typeof window !== 'undefined' ? window.desktopPet?.externalActionPolicySync : undefined
  if (!sync) return
  await sync(buildExternalActionPolicySyncPayload(settings))
}
