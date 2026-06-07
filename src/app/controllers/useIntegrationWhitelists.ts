import { useEffect } from 'react'
import {
  setDiscordKnownChannelIds,
  setTelegramKnownChatIds,
} from '../../lib/coreRuntime'
import {
  parseDiscordChannelIdList,
  parseTelegramChatIdList,
} from '../../features/integrations/allowlists.ts'
import type { AppSettings } from '../../types'

/**
 * Seed the core runtime's cross-channel broadcast targets from settings.
 * The React gateway hooks own the actual bridge connections; this hook only
 * keeps the allowed-id lists in sync with the user's settings string.
 */
export function useIntegrationWhitelists(settings: AppSettings): void {
  useEffect(() => {
    const allowedChatIds = settings.telegramIntegrationEnabled
      ? parseTelegramChatIdList(settings.telegramAllowedChatIds)
      : []
    setTelegramKnownChatIds(allowedChatIds)
  }, [settings.telegramIntegrationEnabled, settings.telegramAllowedChatIds])

  useEffect(() => {
    const allowedChannelIds = settings.discordIntegrationEnabled
      ? parseDiscordChannelIdList(settings.discordAllowedChannelIds)
      : []
    setDiscordKnownChannelIds(allowedChannelIds)
  }, [settings.discordIntegrationEnabled, settings.discordAllowedChannelIds])
}
