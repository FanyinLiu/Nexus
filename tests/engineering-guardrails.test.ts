import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildCompanionBoundaryReport } from '../scripts/companion-boundary-audit.mjs'
import { buildArchitectureBoundaryReport } from '../scripts/architecture-boundary-audit.mjs'
import { buildDesktopContextPrivacyReport } from '../scripts/desktop-context-privacy-audit.mjs'
import { buildErrorRedactionReport } from '../scripts/error-redaction-audit.mjs'
import { buildHeavyModuleAuditReport } from '../scripts/heavy-module-audit.mjs'
import { buildIpcContractReport } from '../scripts/ipc-contract-audit.mjs'
import { buildMessagePrivacyReport } from '../scripts/message-privacy-audit.mjs'
import { buildSourceSizeReport } from '../scripts/source-size-audit.mjs'
import { buildStorageContractReport } from '../scripts/storage-contract-audit.mjs'
import { buildVaultSecurityReport } from '../scripts/vault-security-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DISTRIBUTION_AUDIT_GATES = [
  ['release:trust:audit', 'buildReleaseTrustReport', 'summarizeReleaseTrustReport'],
  ['ipc:audit', 'buildIpcContractReport', 'summarizeIpcContractReport'],
  ['storage:audit', 'buildStorageContractReport', null],
  ['heavy:audit', 'buildHeavyModuleAuditReport', null],
  ['architecture:audit', 'buildArchitectureBoundaryReport', null],
  ['source-size:audit', 'buildSourceSizeReport', null],
  ['performance:baseline', 'buildPerformanceBaselineReport', null],
  ['v04:draft-stack:audit:quick', 'buildV04DraftStackReport', null],
  ['companion-boundary:audit', 'buildCompanionBoundaryReport', null],
  ['message-privacy:audit', 'buildMessagePrivacyReport', null],
  ['desktop-context-privacy:audit', 'buildDesktopContextPrivacyReport', null],
  ['vault-security:audit', 'buildVaultSecurityReport', null],
  ['error-redaction:audit', 'buildErrorRedactionReport', null],
] as const

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function listSourceFiles(relativeDir: string): string[] {
  const root = join(ROOT, relativeDir)
  const files: string[] = []
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry)
    const relative = `${relativeDir}/${entry}`
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(relative))
    } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry)) {
      files.push(relative)
    }
  }
  return files
}

test('engineering guardrail npm scripts stay wired into PR and release verification', () => {
  const pkg = JSON.parse(readWorkspaceFile('package.json')) as { scripts: Record<string, string> }

  for (const scriptName of [
    'lint',
    'lint:js',
    'test',
    'build',
    'storage:audit',
    'heavy:audit',
    'architecture:audit',
    'source-size:audit',
    'ui:references:audit',
    'composer:surface:audit',
    'v04:ui-route:audit',
    'chat:surface:audit',
    'settings:surface:audit',
    'forms:surface:audit',
    'focus:surface:audit',
    'streaming:surface:audit',
    'agent-activity:surface:audit',
    'image4:color:audit',
    'image4:contract:check',
    'image4:contract:report',
    'image4:visual-contract:audit',
    'performance:baseline',
    'companion-boundary:audit',
    'message-privacy:audit',
    'desktop-context-privacy:audit',
    'vault-security:audit',
    'error-redaction:audit',
    'distribution:audit',
    'verify:pr',
    'verify:release',
  ]) {
    assert.equal(typeof pkg.scripts[scriptName], 'string', `missing npm script: ${scriptName}`)
  }

  assert.match(pkg.scripts.test, /--test "tests\/\*\.test\.ts"/)
  assert.ok(
    readdirSync(join(ROOT, 'tests')).includes('settings-ui-scale.test.ts'),
    'settings-ui-scale.test.ts must stay under tests/ so npm test includes the UI scale guard',
  )
  assert.match(pkg.scripts['verify:pr'], /npm run lint/)
  assert.match(pkg.scripts['verify:pr'], /npm test/)
  assert.match(pkg.scripts['verify:pr'], /npm run build/)
  assert.match(pkg.scripts['verify:pr'], /npm run storage:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run heavy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run architecture:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run source-size:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run v04:ui-route:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run ui:references:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run composer:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run chat:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run settings:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run forms:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run focus:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run streaming:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run agent-activity:surface:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run image4:color:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run image4:contract:check/)
  assert.match(pkg.scripts['verify:pr'], /npm run performance:baseline/)
  assert.match(pkg.scripts['verify:pr'], /npm run companion-boundary:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run message-privacy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run desktop-context-privacy:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run vault-security:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run error-redaction:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run ipc:audit/)
  assert.match(pkg.scripts['verify:pr'], /npm run distribution:audit/)
  assert.match(pkg.scripts['verify:release'], /npm run verify:pr/)
  assert.match(pkg.scripts['verify:release'], /npm run sqlite:smoke/)
})

test('distribution audit stays wired to every release, performance, and privacy gate', () => {
  const pkg = JSON.parse(readWorkspaceFile('package.json')) as { scripts: Record<string, string> }
  const distributionAudit = readWorkspaceFile('scripts/distribution-audit.mjs')

  assert.equal(pkg.scripts['distribution:audit'], 'node scripts/distribution-audit.mjs')
  assert.match(distributionAudit, /'lint'/)
  assert.match(distributionAudit, /'test'/)
  assert.match(distributionAudit, /'build'/)
  assert.match(distributionAudit, /'distribution:audit'/)
  assert.match(distributionAudit, /'vault-security:audit'/)
  assert.match(distributionAudit, /'error-redaction:audit'/)

  for (const [scriptName, builderName, summaryName] of DISTRIBUTION_AUDIT_GATES) {
    assert.match(distributionAudit, new RegExp(`import \\{[^}]*${builderName}`), `distribution audit should import ${builderName}`)
    assert.match(distributionAudit, new RegExp(`${builderName}\\(ROOT(?:\\)|,)`), `distribution audit should run ${builderName}`)
    assert.match(distributionAudit, new RegExp(`run npm run ${scriptName}`), `distribution audit should point failures at npm run ${scriptName}`)
    if (summaryName) {
      assert.match(distributionAudit, new RegExp(summaryName), `distribution audit should summarize ${builderName}`)
    }
  }
})

test('prerelease check keeps the packaged smoke release gate visible', () => {
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const releasingDoc = readWorkspaceFile('docs/RELEASING.md')

  for (const phrase of [
    'verify:release',
    'verify:pr + sqlite + core path smoke',
    'npm run smoke',
    'npm run package:dir:smoke',
    'Coverage ≥ 80% lines',
    'Bundle: app-runtime ≤ 1700 KB',
    'Benchmarks',
  ]) {
    assert.match(prereleaseCheck, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.match(prereleaseCheck, /--quick\s+.*skip slow checks \(smoke, packaged smoke, coverage, benchmarks\)/)
  assert.match(prereleaseCheck, /smoke \/ packaged smoke \/ coverage skipped \(--quick\)/)
  assert.match(releasingDoc, /### Stage B — Code quality \(6 checks\)/)
  assert.match(releasingDoc, /`npm run package:dir:smoke`/)
  assert.match(releasingDoc, /smoke, packaged smoke, coverage, benchmarks/)
  for (const phrase of [
    'storage/heavy/architecture/source-size audits',
    'performance baseline',
    'v0.4 draft-stack quick audit',
    'message privacy',
    'desktop context privacy',
    'vault security',
    'error redaction',
    'IPC, and distribution audits',
  ]) {
    assert.match(releasingDoc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('prerelease docs compliance summary matches the implemented checks', () => {
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const releasingDoc = readWorkspaceFile('docs/RELEASING.md')

  assert.match(
    prereleaseCheck,
    /E\. Docs \+ compliance\s+\(release notes, README sync, license scan, AI disclosure\)/,
  )
  assert.doesNotMatch(prereleaseCheck, /\bSBOM\b/)
  assert.match(releasingDoc, /### Stage E — Docs \+ compliance \(beta: 3 checks; stable: 10 checks\)/)
  assert.doesNotMatch(releasingDoc, /Stage E — Docs \+ compliance \(5[–-]8 checks\)/)
  assert.match(releasingDoc, /English release notes no longer contain draft\/pre-tag markers/)
  assert.match(releasingDoc, /RELEASE-NOTES-<tag>\.zh-CN\.md/)
  assert.match(releasingDoc, /docs\/README\.\{zh-CN,zh-TW,ja,ko\}\.md/)
  assert.match(prereleaseCheck, /No GPL\/AGPL\/SSPL in production deps/)
  assert.match(releasingDoc, /No GPL\/AGPL\/SSPL in production deps/)
  assert.match(releasingDoc, /README mentions "AI"/)
})

test('prerelease asset integrity checks packaged sherpa resources on every desktop platform', () => {
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const releasingDoc = readWorkspaceFile('docs/RELEASING.md')

  assert.match(releasingDoc, /build\.\{mac,win,linux\}\.extraResources/)
  assert.match(prereleaseCheck, /pkg\.build\?\.mac\?\.extraResources/)
  assert.match(prereleaseCheck, /pkg\.build\?\.win\?\.extraResources/)
  assert.match(prereleaseCheck, /pkg\.build\?\.linux\?\.extraResources/)
  assert.match(prereleaseCheck, /sherpaInLinux/)
  assert.match(prereleaseCheck, /!sherpaInLinux && 'linux'/)
})

test('prerelease privacy governance summary matches the implemented checks', () => {
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const releasingDoc = readWorkspaceFile('docs/RELEASING.md')

  assert.match(
    prereleaseCheck,
    /F\. Privacy \+ governance\s+\(telemetry guard, H4 status, unsigned caveats\)/,
  )
  assert.doesNotMatch(prereleaseCheck, /known-issues coverage/)
  assert.match(releasingDoc, /### Stage F — Privacy \+ governance \(1–3 checks\)/)
  assert.match(prereleaseCheck, /No default outbound telemetry/)
  assert.match(releasingDoc, /No suspicious telemetry hosts hardcoded/)
  for (const host of [
    'sentry.io',
    'mixpanel.com',
    'segment.io',
    'amplitude.com',
    'google-analytics.com',
    'datadoghq.com',
    'logflare.app',
  ]) {
    assert.match(prereleaseCheck, new RegExp(host.replace('.', '\\.')))
  }
  assert.match(prereleaseCheck, /Audit deferred items still tracked \(H4 noted\)/)
  assert.match(releasingDoc, /Audit-findings doc still tracks H4 deferral/)
  assert.match(prereleaseCheck, /Release notes mention unsigned\/SmartScreen workaround/)
  assert.match(releasingDoc, /xattr\/SmartScreen/)
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
  const errorRedactionReport = buildErrorRedactionReport(ROOT)

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
  assert.equal(errorRedactionReport.summary.errors, 0)
  assert.equal(errorRedactionReport.privacy.readsSecrets, false)
})

test('performance baseline guards large CSS and lazy settings chunks', () => {
  const performanceBaseline = readWorkspaceFile('scripts/performance-baseline.mjs')
  const architecture = readWorkspaceFile('docs/ARCHITECTURE.md')
  const optimizationChecklist = readWorkspaceFile('docs/PACKAGE_STARTUP_OPTIMIZATION.md')

  assert.match(performanceBaseline, /maxCssChunkBytes/)
  assert.match(performanceBaseline, /maxInitialCssChunkBytes/)
  assert.match(performanceBaseline, /maxSettingsDrawerCssChunkBytes/)
  assert.match(performanceBaseline, /maxSettingsDrawerEntryChunkBytes/)
  assert.match(performanceBaseline, /missingSettingsDrawerCssChunk/)
  assert.match(performanceBaseline, /missingSettingsDrawerEntryChunk/)
  assert.match(performanceBaseline, /largestCssChunk/)
  assert.match(performanceBaseline, /settingsDrawerCssChunk/)
  assert.match(performanceBaseline, /settingsDrawerEntryChunk/)
  assert.match(architecture, /largest CSS chunk/)
  assert.match(architecture, /lazy settings drawer entry chunk/)
  assert.match(optimizationChecklist, /最大 CSS chunk/)
  assert.match(optimizationChecklist, /Settings drawer lazy CSS/)
  assert.match(optimizationChecklist, /Settings drawer lazy JS entry/)
})

test('source size audit covers CSS source files', () => {
  const sourceSizeAudit = readWorkspaceFile('scripts/source-size-audit.mjs')
  const architecture = readWorkspaceFile('docs/ARCHITECTURE.md')
  const optimizationChecklist = readWorkspaceFile('docs/PACKAGE_STARTUP_OPTIMIZATION.md')

  assert.match(sourceSizeAudit, /css/)
  assert.match(sourceSizeAudit, /src\/app\/styles\/settings-themes\.css/)
  assert.match(architecture, /CSS source file/)
  assert.match(optimizationChecklist, /TS\/JS\/CSS/)
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

test('removed voice bus reducer does not re-enter source imports', () => {
  const removedImportPath = ['features', 'voice', 'busReducer'].join('/')
  const offenders = [...listSourceFiles('src'), ...listSourceFiles('tests')]
    .filter((file) => readWorkspaceFile(file).includes(removedImportPath))

  assert.deepEqual(offenders, [])
})
