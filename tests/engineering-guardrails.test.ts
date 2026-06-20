import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildCompanionBoundaryReport } from '../scripts/companion-boundary-audit.mjs'
import { buildArchitectureBoundaryReport } from '../scripts/architecture-boundary-audit.mjs'
import { buildDesktopContextPrivacyReport } from '../scripts/desktop-context-privacy-audit.mjs'
import { buildHeavyModuleAuditReport } from '../scripts/heavy-module-audit.mjs'
import { buildIpcContractReport } from '../scripts/ipc-contract-audit.mjs'
import { buildMessagePrivacyReport } from '../scripts/message-privacy-audit.mjs'
import { buildSourceSizeReport } from '../scripts/source-size-audit.mjs'
import { buildStorageContractReport } from '../scripts/storage-contract-audit.mjs'
import { buildVaultSecurityReport } from '../scripts/vault-security-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

test('engineering guardrail npm scripts stay wired into PR and release verification', () => {
  const pkg = JSON.parse(readWorkspaceFile('package.json')) as { scripts: Record<string, string> }

  for (const scriptName of [
    'lint:js',
    'storage:audit',
    'heavy:audit',
    'architecture:audit',
    'source-size:audit',
    'performance:baseline',
    'companion-boundary:audit',
    'message-privacy:audit',
    'desktop-context-privacy:audit',
    'vault-security:audit',
    'verify:pr',
    'verify:release',
  ]) {
    assert.equal(typeof pkg.scripts[scriptName], 'string', `missing npm script: ${scriptName}`)
  }

  assert.match(pkg.scripts['verify:pr'], /npm run storage:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run heavy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run architecture:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run source-size:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run performance:baseline/)
  assert.match(pkg.scripts['verify:pr'], /npm run companion-boundary:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run message-privacy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run desktop-context-privacy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run vault-security:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run ipc:audit/)
  assert.match(pkg.scripts['verify:release'], /npm run verify:pr/)
  assert.match(pkg.scripts['verify:release'], /npm run sqlite:smoke/)
})

test('source-only engineering audits are clean at the current baseline', () => {
  const ipcReport = buildIpcContractReport(ROOT)
  const storageReport = buildStorageContractReport(ROOT)
  const heavyReport = buildHeavyModuleAuditReport(ROOT)
  const architectureReport = buildArchitectureBoundaryReport(ROOT)
  const sourceSizeReport = buildSourceSizeReport(ROOT)
  const boundaryReport = buildCompanionBoundaryReport(ROOT)
  const messagePrivacyReport = buildMessagePrivacyReport(ROOT)
  const desktopContextPrivacyReport = buildDesktopContextPrivacyReport(ROOT)
  const vaultSecurityReport = buildVaultSecurityReport(ROOT)

  assert.equal(ipcReport.summary.errors, 0)
  assert.equal(ipcReport.summary.warnings, 0)
  assert.equal(ipcReport.summary.ok, true)
  assert.equal(storageReport.summary.errors, 0)
  assert.equal(storageReport.discoveredKeys, storageReport.contracts)
  assert.ok(storageReport.discoveredKeyReferences >= storageReport.discoveredKeys)
  assert.ok(storageReport.discoveredKeys >= 60)
  assert.equal(heavyReport.summary.errors, 0)
  assert.equal(architectureReport.summary.errors, 0)
  assert.equal(sourceSizeReport.summary.errors, 0)
  assert.equal(boundaryReport.summary.errors, 0)
  assert.equal(messagePrivacyReport.summary.errors, 0)
  assert.equal(messagePrivacyReport.privacy.readsMessageContent, false)
  assert.equal(desktopContextPrivacyReport.summary.errors, 0)
  assert.equal(desktopContextPrivacyReport.privacy.readsClipboard, false)
  assert.equal(desktopContextPrivacyReport.privacy.readsScreenshots, false)
  assert.equal(desktopContextPrivacyReport.privacy.readsActiveWindow, false)
  assert.equal(vaultSecurityReport.summary.errors, 0)
  assert.equal(vaultSecurityReport.privacy.readsSecrets, false)
  assert.equal(vaultSecurityReport.privacy.rendererReceivesPlaintextSecrets, false)
})

test('IPC schema primitives are split without changing public validators', () => {
  assert.equal(existsSync(join(ROOT, 'electron/ipc/payloadSchemaPrimitives.js')), true)
  assert.equal(existsSync(join(ROOT, 'electron/ipc/assistantPayloadSchemas.js')), true)
  assert.equal(existsSync(join(ROOT, 'electron/ipc/voicePayloadSchemas.js')), true)
  assert.equal(existsSync(join(ROOT, 'electron/ipc/localDataPayloadSchemas.js')), true)

  const payloadSchemas = readWorkspaceFile('electron/ipc/payloadSchemas.js')
  const payloadPrimitives = readWorkspaceFile('electron/ipc/payloadSchemaPrimitives.js')
  const assistantPayloadSchemas = readWorkspaceFile('electron/ipc/assistantPayloadSchemas.js')
  const voicePayloadSchemas = readWorkspaceFile('electron/ipc/voicePayloadSchemas.js')
  const localDataPayloadSchemas = readWorkspaceFile('electron/ipc/localDataPayloadSchemas.js')

  assert.match(payloadSchemas, /from '\.\/assistantPayloadSchemas\.js'/)
  assert.match(payloadSchemas, /from '\.\/voicePayloadSchemas\.js'/)
  assert.match(payloadSchemas, /from '\.\/localDataPayloadSchemas\.js'/)
  assert.match(assistantPayloadSchemas, /export function validateChatCompletionPayload/)
  assert.match(voicePayloadSchemas, /export function validateVadStartPayload/)
  assert.match(localDataPayloadSchemas, /export function validateLocalDataChatMigrationApplyPayload/)
  assert.match(payloadPrimitives, /export const SHORT_TEXT_MAX/)
  assert.match(payloadPrimitives, /export const SAFE_SKILL_ID_PATTERN/)
})

test('companion task boundary is explicit for legacy agent-named code', () => {
  const agentReadme = readWorkspaceFile('src/features/agent/README.md').replace(/\s+/g, ' ')
  const architecture = readWorkspaceFile('docs/ARCHITECTURE.md').replace(/\s+/g, ' ')

  assert.match(agentReadme, /not a Codex-style work agent/)
  assert.match(agentReadme, /default-off or confirmation-gated/)
  assert.match(architecture, /Companion task boundary/)
  assert.match(architecture, /user-facing copy should describe companion tasks/)
})
