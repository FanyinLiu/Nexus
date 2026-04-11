/**
 * Graduated permission system for integrations.
 *
 * Each integration has a permission mode:
 *   - 'read-only': Can receive data but cannot send or execute actions
 *   - 'confirm':   Can act, but destructive/send operations need user confirmation
 *   - 'auto':      Full autonomy — no confirmation needed
 *
 * The companion checks permissions before performing actions through integrations.
 */

import type { AppSettings, IntegrationPermissionMode } from '../../types'

export type IntegrationActionKind =
  | 'read'      // Passive: receive messages, read state
  | 'send'      // Active: send messages, post content
  | 'execute'   // Powerful: run commands, modify game state
  | 'configure' // Admin: change integration settings

const ACTION_REQUIRES_LEVEL: Record<IntegrationActionKind, IntegrationPermissionMode[]> = {
  read: ['read-only', 'confirm', 'auto'],
  send: ['confirm', 'auto'],
  execute: ['confirm', 'auto'],
  configure: ['auto'],
}

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'blocked'; message: string }
  | { allowed: false; reason: 'needs_confirmation'; message: string }

/**
 * Get the permission mode for a specific integration.
 */
export function getIntegrationPermissionMode(
  settings: AppSettings,
  integrationId: string,
): IntegrationPermissionMode {
  switch (integrationId) {
    case 'minecraft': return settings.minecraftPermissionMode
    case 'factorio': return settings.factorioPermissionMode
    case 'telegram': return settings.telegramPermissionMode
    case 'discord': return settings.discordPermissionMode
    case 'mcp': return settings.mcpPermissionMode
    default: return 'confirm'
  }
}

/**
 * Check whether an action is permitted for the given integration.
 */
export function checkPermission(
  settings: AppSettings,
  integrationId: string,
  actionKind: IntegrationActionKind,
): PermissionCheckResult {
  const mode = getIntegrationPermissionMode(settings, integrationId)
  const allowedModes = ACTION_REQUIRES_LEVEL[actionKind]

  if (!allowedModes.includes(mode)) {
    return {
      allowed: false,
      reason: 'blocked',
      message: `${integrationId} is in "${mode}" mode — "${actionKind}" actions are not allowed.`,
    }
  }

  // 'confirm' mode for send/execute actions → needs confirmation
  if (mode === 'confirm' && (actionKind === 'send' || actionKind === 'execute')) {
    return {
      allowed: false,
      reason: 'needs_confirmation',
      message: `${integrationId} requires confirmation for "${actionKind}" actions.`,
    }
  }

  return { allowed: true }
}

/**
 * Quick check: can this integration perform this action without confirmation?
 */
export function isActionAllowed(
  settings: AppSettings,
  integrationId: string,
  actionKind: IntegrationActionKind,
): boolean {
  const result = checkPermission(settings, integrationId, actionKind)
  return result.allowed
}
