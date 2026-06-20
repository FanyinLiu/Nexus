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
  assert.equal(report.counts.preloadInvokeChannels, 183)
  assert.equal(report.counts.mainHandlerChannels, 183)
  assert.equal(report.counts.preloadSubscriptionChannels, 17)
  assert.equal(report.errors.missingHandlers.length, 0)
  assert.equal(report.errors.duplicateHandlers.length, 0)
  assert.equal(report.errors.missingTrustedSender.length, 0)
  assert.equal(report.errors.missingSubscriptionSources.length, 0)

  const localDataStatus = findChannel(report, 'local-data:status')
  assert.equal(localDataStatus?.riskLevel, 'low')
  assert.equal(localDataStatus?.rendererPayload, false)
  assert.equal(localDataStatus?.trustedSender, true)

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
  assert.equal(findChannel(report, 'vault:store')?.payloadValidation, 'manual')
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
    'pet-model:import-codex-gallery',
    'pet-model:create-creator-kit',
    'pet-model:inspect-creator-kit',
    'pet-model:assemble-creator-kit',
    'pet-model:install-creator-kit-codex',
    'pet-model:open-creator-kit-path',
    'pet-model:create-from-image',
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
