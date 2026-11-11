import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildIpcContractReport,
  summarizeIpcContractReport,
} from '../scripts/ipc-contract-audit.mjs'

function findChannel(report: ReturnType<typeof buildIpcContractReport>, channel: string) {
  return report.channels.find((item) => item.channel === channel)
}

test('IPC contract audit inventories the current preload and main handler surface', () => {
  const report = buildIpcContractReport()
  const summary = summarizeIpcContractReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(summary.errors, 0)
  assert.equal(report.counts.preloadInvokeChannels, 215)
  assert.equal(report.counts.mainHandlerChannels, 215)
  assert.equal(report.counts.preloadSubscriptionChannels, 28)
  assert.equal(report.errors.missingHandlers.length, 0)
  assert.equal(report.errors.duplicateHandlers.length, 0)
  assert.equal(report.errors.missingTrustedSender.length, 0)
  assert.equal(report.errors.missingSubscriptionSources.length, 0)
  assert.equal(report.errors.unclassifiedHighRiskCapabilities.length, 0)

  const localDataChatSessionsRead = findChannel(report, 'local-data:chat-sessions-read')
  assert.equal(localDataChatSessionsRead?.riskLevel, 'low')
  assert.equal(localDataChatSessionsRead?.rendererPayload, false)
  assert.equal(localDataChatSessionsRead?.channelCapability, 'panel')
  assert.equal(localDataChatSessionsRead?.trustedSender, true)

  const localDataStatus = findChannel(report, 'local-data:status')
  assert.equal(localDataStatus?.riskLevel, 'low')
  assert.equal(localDataStatus?.rendererPayload, false)
  assert.equal(localDataStatus?.trustedSender, true)

  const mediaPermissionStatus = findChannel(report, 'media-permission:status')
  assert.equal(mediaPermissionStatus?.riskLevel, 'low')
  assert.equal(mediaPermissionStatus?.rendererPayload, true)
  assert.equal(mediaPermissionStatus?.payloadValidation, 'schema')
  assert.equal(mediaPermissionStatus?.trustedSender, true)

  const localDataOnboardingMirror = findChannel(report, 'local-data:mirror-onboarding')
  assert.equal(localDataOnboardingMirror?.riskLevel, 'low')
  assert.equal(localDataOnboardingMirror?.rendererPayload, true)
  assert.equal(localDataOnboardingMirror?.payloadValidation, 'schema')
  assert.equal(localDataOnboardingMirror?.trustedSender, true)

  const localDataChatMigrationStatus = findChannel(report, 'local-data:chat-migration-status')
  assert.equal(localDataChatMigrationStatus?.riskLevel, 'medium')
  assert.equal(localDataChatMigrationStatus?.riskDomain, 'local-user-data')
  assert.equal(localDataChatMigrationStatus?.rendererPayload, false)
  assert.equal(localDataChatMigrationStatus?.payloadValidation, 'none')
  assert.equal(localDataChatMigrationStatus?.trustedSender, true)

  const localDataChatSessionMirror = findChannel(report, 'local-data:chat-session-mirror')
  assert.equal(localDataChatSessionMirror?.riskLevel, 'high')
  assert.equal(localDataChatSessionMirror?.riskDomain, 'local-user-data')
  assert.equal(localDataChatSessionMirror?.rendererPayload, true)
  assert.equal(localDataChatSessionMirror?.payloadValidation, 'schema')
  assert.equal(localDataChatSessionMirror?.trustedSender, true)
  assert.equal(localDataChatSessionMirror?.auditLogged, true)
  assert.equal(localDataChatSessionMirror?.permissionHint, true)

  const localDataChatComparison = findChannel(report, 'local-data:chat-comparison-preview')
  assert.equal(localDataChatComparison?.riskLevel, 'high')
  assert.equal(localDataChatComparison?.riskDomain, 'local-user-data')
  assert.equal(localDataChatComparison?.rendererPayload, true)
  assert.equal(localDataChatComparison?.payloadValidation, 'schema')
  assert.equal(localDataChatComparison?.trustedSender, true)
  assert.equal(localDataChatComparison?.auditLogged, true)
  assert.equal(localDataChatComparison?.permissionHint, true)

  const localDataChatMigrationApply = findChannel(report, 'local-data:chat-migration-apply')
  assert.equal(localDataChatMigrationApply?.riskLevel, 'high')
  assert.equal(localDataChatMigrationApply?.riskDomain, 'local-user-data')
  assert.equal(localDataChatMigrationApply?.rendererPayload, true)
  assert.equal(localDataChatMigrationApply?.payloadValidation, 'schema')
  assert.equal(localDataChatMigrationApply?.trustedSender, true)
  assert.equal(localDataChatMigrationApply?.auditLogged, true)
  assert.equal(localDataChatMigrationApply?.permissionHint, true)

  const localDataChatMigrationRollback = findChannel(report, 'local-data:chat-migration-rollback')
  assert.equal(localDataChatMigrationRollback?.riskLevel, 'high')
  assert.equal(localDataChatMigrationRollback?.riskDomain, 'local-user-data')
  assert.equal(localDataChatMigrationRollback?.rendererPayload, true)
  assert.equal(localDataChatMigrationRollback?.payloadValidation, 'schema')
  assert.equal(localDataChatMigrationRollback?.trustedSender, true)
  assert.equal(localDataChatMigrationRollback?.auditLogged, true)
  assert.equal(localDataChatMigrationRollback?.permissionHint, true)

  const localDataMemoryMigrationApply = findChannel(report, 'local-data:memory-migration-apply')
  assert.equal(localDataMemoryMigrationApply?.riskLevel, 'high')
  assert.equal(localDataMemoryMigrationApply?.riskDomain, 'local-user-data')
  assert.equal(localDataMemoryMigrationApply?.rendererPayload, true)
  assert.equal(localDataMemoryMigrationApply?.payloadValidation, 'schema')
  assert.equal(localDataMemoryMigrationApply?.trustedSender, true)
  assert.equal(localDataMemoryMigrationApply?.auditLogged, true)
  assert.equal(localDataMemoryMigrationApply?.permissionHint, true)

  const localDataMemoryRead = findChannel(report, 'local-data:memory-read')
  assert.equal(localDataMemoryRead?.riskLevel, 'medium')
  assert.equal(localDataMemoryRead?.riskDomain, 'local-user-data')
  assert.equal(localDataMemoryRead?.rendererPayload, false)
  assert.equal(localDataMemoryRead?.channelCapability, 'panel')
  assert.equal(localDataMemoryRead?.trustedSender, true)

  const localDataCompanionStatus = findChannel(report, 'local-data:companion-migration-status')
  assert.equal(localDataCompanionStatus?.riskLevel, 'medium')
  assert.equal(localDataCompanionStatus?.riskDomain, 'local-user-data')
  assert.equal(localDataCompanionStatus?.rendererPayload, false)
  assert.equal(localDataCompanionStatus?.channelCapability, 'shared')
  assert.equal(localDataCompanionStatus?.trustedSender, true)

  const localDataCompanionRead = findChannel(report, 'local-data:companion-read')
  assert.equal(localDataCompanionRead?.riskLevel, 'medium')
  assert.equal(localDataCompanionRead?.riskDomain, 'local-user-data')
  assert.equal(localDataCompanionRead?.rendererPayload, false)
  assert.equal(localDataCompanionRead?.channelCapability, 'panel')
  assert.equal(localDataCompanionRead?.trustedSender, true)

  for (const channel of [
    'local-data:companion-comparison-preview',
    'local-data:companion-dataset-mirror',
    'local-data:companion-migration-apply',
    'local-data:companion-migration-rollback',
  ]) {
    const item = findChannel(report, channel)
    assert.equal(item?.riskLevel, 'high')
    assert.equal(item?.riskDomain, 'local-user-data')
    assert.equal(item?.rendererPayload, true)
    assert.equal(item?.payloadValidation, 'schema')
    assert.equal(item?.channelCapability, 'panel')
    assert.equal(item?.trustedSender, true)
    assert.equal(item?.auditLogged, true)
    assert.equal(item?.permissionHint, true)
  }
})

test('IPC contract audit classifies high-risk channels without reading secret values', () => {
  const report = buildIpcContractReport()
  const highRiskChannels = report.channels
    .filter((item) => item.riskLevel === 'high')
    .map((item) => item.channel)

  for (const channel of [
    'vault:store',
    'desktop-context:get',
    'mcp:call-tool',
    'plugin:start',
    'factorio:execute',
    'tool:open-external',
    'local-data:chat-comparison-preview',
    'local-data:chat-session-mirror',
    'local-data:chat-migration-apply',
    'local-data:chat-migration-rollback',
    'local-data:memory-migration-apply',
    'local-data:memory-migration-rollback',
    'local-data:companion-dataset-mirror',
    'local-data:companion-migration-apply',
    'local-data:companion-migration-rollback',
    'vts-bridge:migrate-legacy-token',
  ]) {
    assert.ok(highRiskChannels.includes(channel), `${channel} should be high risk`)
  }

  assert.equal(report.privacy.readsEnvironment, false)
  assert.equal(report.privacy.readsKeychain, false)
  assert.equal(report.privacy.readsUserData, false)
  assert.equal(report.privacy.readsSecretValues, false)
  assert.equal(report.privacy.staticSourceOnly, true)
})

test('IPC contract audit distinguishes schema, manual, and no-payload handlers', () => {
  const report = buildIpcContractReport()

  assert.equal(findChannel(report, 'chat:complete')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'desktop-context:get')?.auditLogged, true)
  assert.equal(findChannel(report, 'desktop-context:get')?.permissionHint, true)
  assert.equal(findChannel(report, 'file:save-text')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'file:open-text')?.auditLogged, true)
  assert.equal(findChannel(report, 'file:open-text')?.permissionHint, true)
  assert.equal(findChannel(report, 'vault:store')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vault:retrieve')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vault:retrieve-many')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vts-bridge:connect')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vts-bridge:update-input')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vts-bridge:migrate-legacy-token')?.payloadValidation, 'schema')
  assert.equal(findChannel(report, 'vts-bridge:migrate-legacy-token')?.riskDomain, 'secret-vault')
  assert.equal(findChannel(report, 'pet-window:get-state')?.payloadValidation, 'none')
  assert.equal(findChannel(report, 'pet-window:get-state')?.rendererPayload, false)
  assert.equal(findChannel(report, 'vault:store')?.rendererPayload, true)
  assert.equal(findChannel(report, 'vts-bridge:migrate-legacy-token')?.rendererPayload, true)
  assert.equal(findChannel(report, 'vts-auth-token:get'), undefined)
  assert.equal(findChannel(report, 'vts-auth-token:store'), undefined)
  assert.equal(findChannel(report, 'vts-auth-token:delete'), undefined)
})

test('IPC contract audit keeps file dialog channels out of warning buckets', () => {
  const report = buildIpcContractReport()
  const warningChannels = [
    ...report.warnings.payloadWithoutValidation,
    ...report.warnings.highRiskWithoutAudit,
    ...report.warnings.highRiskWithoutPermissionHint,
  ].map((item) => item.channel)

  assert.ok(!warningChannels.includes('file:save-text'))
  assert.ok(!warningChannels.includes('file:open-text'))
})

test('IPC contract audit keeps desktop context out of high-risk audit and permission warnings', () => {
  const report = buildIpcContractReport()
  const warningChannels = [
    ...report.warnings.highRiskWithoutAudit,
    ...report.warnings.highRiskWithoutPermissionHint,
  ].map((item) => item.channel)

  assert.ok(!warningChannels.includes('desktop-context:get'))
})

test('IPC contract audit keeps external actions out of high-risk audit warnings', () => {
  const report = buildIpcContractReport()
  const highRiskWithoutAudit = report.warnings.highRiskWithoutAudit.map((item) => item.channel)

  for (const channel of [
    'telegram:send-message',
    'telegram:send-voice',
    'discord:send-message',
    'discord:send-voice',
    'minecraft:send-command',
    'factorio:execute',
    'mcp:call-tool',
    'mcp:sync-servers',
    'local-data:chat-comparison-preview',
    'local-data:chat-session-mirror',
  ]) {
    assert.ok(!highRiskWithoutAudit.includes(channel), `${channel} should write an audit record`)
  }
})

test('IPC contract audit keeps external action permission channels out of permission warnings', () => {
  const report = buildIpcContractReport()
  const highRiskWithoutPermission = report.warnings.highRiskWithoutPermissionHint.map((item) => item.channel)

  for (const channel of [
    'telegram:send-message',
    'telegram:send-voice',
    'discord:send-message',
    'discord:send-voice',
    'minecraft:send-command',
    'factorio:execute',
    'mcp:call-tool',
    'mcp:sync-servers',
    'external-action-policy:sync',
    'local-data:chat-comparison-preview',
    'local-data:chat-session-mirror',
    'local-data:chat-migration-apply',
    'local-data:chat-migration-rollback',
  ]) {
    assert.ok(!highRiskWithoutPermission.includes(channel), `${channel} should have a permission boundary`)
  }
})

test('IPC contract audit keeps pet model artifact channels out of high-risk warning buckets', () => {
  const report = buildIpcContractReport()
  const highRiskWarnings = [
    ...report.warnings.highRiskWithoutAudit,
    ...report.warnings.highRiskWithoutPermissionHint,
  ].map((item) => item.channel)
  const payloadWarnings = report.warnings.payloadWithoutValidation.map((item) => item.channel)

  for (const channel of [
    'pet-model:import',
  ]) {
    assert.ok(!highRiskWarnings.includes(channel), `${channel} should have audit and confirmation coverage`)
    assert.ok(!payloadWarnings.includes(channel), `${channel} should validate payloads or carry no renderer payload`)
  }
})

test('IPC contract audit keeps plugin lifecycle and bus channels out of high-risk warning buckets', () => {
  const report = buildIpcContractReport()
  const highRiskWarnings = [
    ...report.warnings.highRiskWithoutAudit,
    ...report.warnings.highRiskWithoutPermissionHint,
  ].map((item) => item.channel)
  const payloadWarnings = report.warnings.payloadWithoutValidation.map((item) => item.channel)

  for (const channel of [
    'plugin:start',
    'plugin:stop',
    'plugin:restart',
    'plugin:enable',
    'plugin:disable',
    'plugin:approve',
    'plugin:revoke',
    'plugin-bus:publish',
    'plugin-bus:subscribe',
    'plugin-bus:unsubscribe',
  ]) {
    assert.ok(!highRiskWarnings.includes(channel), `${channel} should have audit and permission coverage`)
    assert.ok(!payloadWarnings.includes(channel), `${channel} should validate payloads`)
  }
})

test('IPC contract audit keeps external link IPC out of high-risk audit warnings', () => {
  const report = buildIpcContractReport()
  const highRiskWithoutAudit = report.warnings.highRiskWithoutAudit.map((item) => item.channel)
  const payloadWarnings = report.warnings.payloadWithoutValidation.map((item) => item.channel)

  assert.ok(!highRiskWithoutAudit.includes('tool:open-external'))
  assert.ok(!payloadWarnings.includes('tool:open-external'))
})

test('IPC contract audit keeps vault channels out of high-risk warning buckets', () => {
  const report = buildIpcContractReport()
  const highRiskWarnings = [
    ...report.warnings.highRiskWithoutAudit,
    ...report.warnings.highRiskWithoutPermissionHint,
  ].map((item) => item.channel)

  for (const channel of [
    'vault:is-available',
    'vault:store',
    'vault:retrieve',
    'vault:delete',
    'vault:list-slots',
    'vault:store-many',
    'vault:retrieve-many',
    'vts-bridge:migrate-legacy-token',
  ]) {
    assert.ok(!highRiskWarnings.includes(channel), `${channel} should have audit and permission coverage`)
  }
})

test('IPC contract audit has no remaining payload validation warnings', () => {
  const report = buildIpcContractReport()

  assert.deepEqual(report.warnings.payloadWithoutValidation, [])
})

test('IPC contract audit pins payload validation and renderer payload for every main handler channel', () => {
  const report = buildIpcContractReport()

  const expectedNoneChannels = [
    'app:get-launch-on-startup',
    'app:get-platform-profile',
    'app:get-system-idle-time',
    'desktop-presence:get-typing-status',
    'desktop-presence:open-typing-permission',
    'discord:disconnect',
    'discord:pairing-list',
    'discord:status',
    'external-action-policy:get',
    'factorio:disconnect',
    'factorio:game-context',
    'factorio:status',
    'inbox:list',
    'kws:stop',
    'local-data:chat-migration-status',
    'local-data:chat-sessions-read',
    'local-data:companion-migration-status',
    'local-data:companion-read',
    'local-data:memory-migration-status',
    'local-data:memory-read',
    'local-data:status',
    'media-session:get',
    'memory:flush-complete',
    'memory:long-term-clear',
    'memory:long-term-load',
    'memory:reset-local-storage',
    'memory:vector-stats',
    'minecraft:disconnect',
    'minecraft:game-context',
    'minecraft:status',
    'models:inventory',
    'models:network-probe',
    'notification:get-channels',
    'notification:start',
    'notification:stop',
    'notification:watcher-status',
    'notification:webhook-info',
    'panel-window:get-state',
    'paraformer:abort',
    'paraformer:finish',
    'paraformer:start',
    'paraformer:status',
    'persona:import-card',
    'persona:load-memory',
    'persona:load-soul',
    'persona:open-dir',
    'persona:paths',
    'pet-model:import',
    'pet-model:list',
    'pet-window:get-state',
    'plugin-bus:stats',
    'plugin-bus:subscriptions',
    'plugin:dir',
    'plugin:list',
    'plugin:scan',
    'runtime-state:get',
    'sensevoice:abort',
    'sensevoice:finish',
    'sensevoice:start',
    'sensevoice:status',
    'skill:list',
    'skill:stats',
    'telegram:disconnect',
    'telegram:pairing-list',
    'telegram:status',
    'tencent-asr:abort',
    'tencent-asr:disconnect',
    'tencent-asr:finish',
    'tencent-asr:status',
    'updater:check',
    'updater:install',
    'updater:status',
    'vad:flush',
    'vad:status',
    'vad:stop',
    'vault:is-available',
    'vault:list-slots',
    'voice-turn:start',
    'vts-bridge:disconnect',
    'vts-bridge:status',
    'window:close-settings',
    'window:consume-model-setup-request',
    'window:decline-model-setup',
    'window:get-panel-section',
    'window:get-view-kind',
    'window:open-pet-menu',
  ]

  const expectedManualChannels = [
    'discord:connect',
    'discord:pairing-resolve',
    'doctor:probe-local-services',
    'kws:feed',
    'notification:set-channels',
    'paraformer:feed',
    'persona:load-profile',
    'persona:profile-dir',
    'persona:save-soul',
    'persona:save-style',
    'sensevoice:feed',
    'sensevoice:transcribe',
    'telegram:connect',
    'telegram:pairing-resolve',
    'tencent-asr:feed',
    'vad:feed',
  ]

  const expectedSchemaChannels = [
    'app:set-launch-on-startup',
    'audio:list-voices',
    'audio:synthesize',
    'audio:transcribe',
    'chat:abort-stream',
    'chat:complete',
    'chat:complete-stream',
    'chat:list-models',
    'chat:test-connection',
    'desktop-context:get',
    'desktop-presence:set-preferences',
    'dialog:confirm',
    'discord:send-message',
    'discord:send-voice',
    'external-action-policy:sync',
    'factorio:connect',
    'factorio:execute',
    'file:open-text',
    'file:save-text',
    'inbox:update',
    'integrations:inspect',
    'kws:start',
    'kws:status',
    'local-data:chat-comparison-preview',
    'local-data:chat-migration-apply',
    'local-data:chat-migration-rollback',
    'local-data:chat-session-mirror',
    'local-data:companion-comparison-preview',
    'local-data:companion-dataset-mirror',
    'local-data:companion-migration-apply',
    'local-data:companion-migration-rollback',
    'local-data:memory-migration-apply',
    'local-data:memory-migration-rollback',
    'local-data:mirror-onboarding',
    'mcp:call-tool',
    'mcp:list-tools',
    'mcp:status',
    'mcp:sync-servers',
    'media-permission:status',
    'media-session:control',
    'memory:clear-user-data',
    'memory:hybrid-search',
    'memory:keyword-search',
    'memory:long-term-save',
    'memory:ollama-detect',
    'memory:ollama-embed',
    'memory:vector-index',
    'memory:vector-index-batch',
    'memory:vector-remove',
    'memory:vector-search',
    'minecraft:connect',
    'minecraft:send-command',
    'models:download',
    'models:download-missing',
    'notification:watcher-set',
    'panel-window:set-state',
    'persona:init',
    'persona:save-memory',
    'pet-window:set-free-mode',
    'pet-window:update-state',
    'plugin-bus:publish',
    'plugin-bus:recent',
    'plugin-bus:subscribe',
    'plugin-bus:unsubscribe',
    'plugin:approve',
    'plugin:disable',
    'plugin:enable',
    'plugin:restart',
    'plugin:revoke',
    'plugin:start',
    'plugin:status',
    'plugin:stop',
    'proactive:deliver',
    'proactive:show-notification',
    'runtime-state:heartbeat',
    'runtime-state:update',
    'service:test-connection',
    'skill:get',
    'skill:mark-used',
    'skill:remove',
    'skill:save',
    'skill:search',
    'telegram:send-message',
    'telegram:send-voice',
    'tencent-asr:connect',
    'tool:get-weather',
    'tool:open-external',
    'tool:web-search',
    'tts:stream-abort',
    'tts:stream-finish',
    'tts:stream-push-text',
    'tts:stream-start',
    'vad:start',
    'vault:delete',
    'vault:retrieve',
    'vault:retrieve-many',
    'vault:store',
    'vault:store-many',
    'voice-profile:probe',
    'voice-runtime:sync',
    'voice-turn:probe',
    'voice-turn:stop',
    'voice:stop-playback',
    'vts-bridge:connect',
    'vts-bridge:migrate-legacy-token',
    'vts-bridge:update-input',
    'window:claim-model-setup-reminder',
    'window:close-panel',
    'window:drag-by',
    'window:open-panel',
    'window:request-model-setup',
    'window:resolve-model-setup-request',
    'window:set-system-vibrancy',
  ]

  const actualInventory = report.channels
    .map(({ channel, payloadValidation, rendererPayload }) => ({ channel, payloadValidation, rendererPayload }))
    .sort((a, b) => a.channel.localeCompare(b.channel))

  const expectedInventory = [
    ...expectedNoneChannels.map((channel) => ({ channel, payloadValidation: 'none', rendererPayload: false })),
    ...expectedManualChannels.map((channel) => ({ channel, payloadValidation: 'manual', rendererPayload: true })),
    ...expectedSchemaChannels.map((channel) => ({ channel, payloadValidation: 'schema', rendererPayload: true })),
  ].sort((a, b) => a.channel.localeCompare(b.channel))

  assert.deepEqual(actualInventory, expectedInventory)
  assert.equal(
    new Set([...expectedNoneChannels, ...expectedManualChannels, ...expectedSchemaChannels]).size,
    report.counts.mainHandlerChannels,
  )
})
