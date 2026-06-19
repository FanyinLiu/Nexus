import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDefaultExternalActionPolicy,
  decideExternalActionPermission,
  normalizeExternalActionPolicySyncPayload,
  planExternalActionPolicySync,
  resolveExternalActionDescriptor,
} from '../electron/services/externalActionPolicyCore.js'
import { buildExternalActionPolicySyncPayload } from '../src/features/integrations/externalActionPolicySync.ts'
import type { AppSettings } from '../src/types/app.ts'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    telegramPermissionMode: 'auto',
    telegramIntegrationEnabled: true,
    telegramBotToken: 'telegram-secret-token',
    discordPermissionMode: 'confirm',
    discordIntegrationEnabled: true,
    discordBotToken: 'discord-secret-token',
    minecraftPermissionMode: 'read-only',
    minecraftIntegrationEnabled: true,
    minecraftServerAddress: 'private.minecraft.local',
    factorioPermissionMode: 'confirm',
    factorioIntegrationEnabled: false,
    factorioServerAddress: 'private.factorio.local',
    mcpPermissionMode: 'auto',
    mcpServers: [
      {
        id: 'private-mcp',
        label: 'Private MCP',
        command: '/Users/me/private-mcp',
        args: '--token private',
        enabled: true,
      },
    ],
    ...overrides,
  } as AppSettings
}

test('external action policy core defaults every integration to confirm', () => {
  assert.deepEqual(createDefaultExternalActionPolicy(), {
    telegram: 'confirm',
    discord: 'confirm',
    minecraft: 'confirm',
    factorio: 'confirm',
    mcp: 'confirm',
  })
})

test('external action policy sync normalizes malformed modes and inactive auto requests', () => {
  const payload = {
    policies: {
      telegram: { mode: 'auto', active: false },
      discord: { mode: 'auto', active: true },
      minecraft: { mode: 'invalid', active: true },
    },
  }

  assert.deepEqual(normalizeExternalActionPolicySyncPayload(payload), {
    telegram: { mode: 'auto', active: false },
    discord: { mode: 'auto', active: true },
    minecraft: { mode: 'confirm', active: true },
  })

  const plan = planExternalActionPolicySync(
    { telegram: 'confirm', discord: 'confirm', minecraft: 'confirm', factorio: 'confirm', mcp: 'confirm' },
    payload,
  )

  assert.deepEqual(plan.changes, [
    {
      integration: 'discord',
      from: 'confirm',
      to: 'auto',
      active: true,
      requiresEscalationApproval: true,
    },
  ])
})

test('external action permission decisions enforce read-only, confirm, and auto modes', () => {
  assert.deepEqual(decideExternalActionPermission('read-only', 'send'), {
    allowed: false,
    requiresConfirmation: false,
    reason: 'blocked',
  })
  assert.deepEqual(decideExternalActionPermission('confirm', 'execute'), {
    allowed: false,
    requiresConfirmation: true,
    reason: 'needs_confirmation',
  })
  assert.deepEqual(decideExternalActionPermission('confirm', 'execute', true), {
    allowed: true,
    requiresConfirmation: true,
    reason: 'confirmed',
  })
  assert.deepEqual(decideExternalActionPermission('auto', 'configure'), {
    allowed: true,
    requiresConfirmation: false,
    reason: 'auto',
  })
})

test('external action channel descriptors map send execute and configure actions', () => {
  assert.deepEqual(resolveExternalActionDescriptor('telegram:send-message'), {
    integration: 'telegram',
    permissionKind: 'send',
  })
  assert.deepEqual(resolveExternalActionDescriptor('factorio:execute'), {
    integration: 'factorio',
    permissionKind: 'execute',
  })
  assert.deepEqual(resolveExternalActionDescriptor('mcp:sync-servers'), {
    integration: 'mcp',
    permissionKind: 'configure',
  })
})

test('renderer policy sync payload omits tokens target IDs commands and args', () => {
  const payload = buildExternalActionPolicySyncPayload(settings())
  assert.deepEqual(payload, {
    policies: {
      telegram: { mode: 'auto', active: true },
      discord: { mode: 'confirm', active: true },
      minecraft: { mode: 'read-only', active: true },
      factorio: { mode: 'confirm', active: false },
      mcp: { mode: 'auto', active: true },
    },
  })

  const serialized = JSON.stringify(payload)
  for (const privateValue of [
    'telegram-secret-token',
    'discord-secret-token',
    'private.minecraft.local',
    'private.factorio.local',
    'private-mcp',
    '/Users/me/private-mcp',
    '--token private',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be synced to main`)
  }
})
