import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildVaultSecurityReport } from '../scripts/vault-security-audit.mjs'

const BASELINE_FILES: Record<string, string> = {
  'electron/ipc/vaultIpc.js': `
import { issueVaultRefForSender } from '../services/vaultRefs.js'
ipcMain.handle('vault:retrieve'
return issueVaultRefForSender(event.sender, name)
ipcMain.handle('vault:retrieve-many'
refs[name] = issueVaultRefForSender(event.sender, name)
rateLimitSingleRetrieve(event, name)
rateLimitBulkOp(event, 'retrieve-many')
`,
  'electron/services/keyVault.js': `
import { getRedactedErrorMessage } from './errorRedaction.js'
function formatVaultSlotLogLabel(slot) {}
console.warn('[KeyVault] Failed to read vault file:', getRedactedErrorMessage(error))
Encryption unavailable, cannot decrypt slot (${'${formatVaultSlotLogLabel(slot)}'})
Failed to decrypt slot (${'${formatVaultSlotLogLabel(slot)}'}):
getRedactedErrorMessage(error)
`,
  'electron/services/vaultRefs.js': `
export const VAULT_REF_PREFIX = 'nexus-vault-ref:'
const _refsBySender = new WeakMap()
export function issueVaultRefForSender(sender, slot) {}
export async function resolveVaultRefsForSender(sender, source, fields) {}
const refs = sender ? _refsBySender.get(sender) : null
if (!entry) throw new Error(\`payload.\${field} references an expired vault token\`)
const values = await vaultRetrieveMany(slots)
`,
  'electron/ipc/vaultAudit.js': `
plaintextLength
refCount
refTextTotalLength
returnedSlotNameTotalLength
`,
  'electron/preload.js': `
Retrieval returns opaque refs;
plaintext secret values stay in main-process handlers.
vaultRetrieve: (slot) => ipcRenderer.invoke('vault:retrieve', slot)
vaultRetrieveMany: (slots) => ipcRenderer.invoke('vault:retrieve-many', slots)
`,
  'electron/ipc/chatIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
`,
  'electron/ipc/audioIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
`,
  'electron/ipc/ttsStreamIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
`,
  'electron/ipc/serviceIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
`,
  'electron/ipc/telegramIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['botToken'])
`,
  'electron/ipc/discordIpc.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
resolveVaultRefsForSender(event.sender, payload, ['botToken'])
`,
  'electron/tools/toolRegistry.js': `
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
secretFields: ['apiKey']
const resolvedPayload = await resolveVaultRefsForSender(
toolDefinition.secretFields ?? []
`,
  'src/app/store/settingsStore.ts': `
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
console.error('[settingsStore] Failed to sync external action policy:', getRedactedLogErrorMessage(err))
console.error('[settingsStore] Vault hydration failed, API keys may be unavailable:', getRedactedLogErrorMessage(err))
`,
  'src/lib/keyVaultBridge.ts': `
export const VAULT_REF_PREFIX = 'nexus-vault-ref:'
displaySecretInputValue
if (isVaultRefString(value)) return
await window.desktopPet!.vaultRetrieveMany(allSlots)
hydrateProfileKeys
`,
  'src/vite-env.d.ts': `
Retrieval returns opaque
nexus-vault-ref tokens; plaintext is resolved only in the main process.
vaultRetrieve: (slot: string) => Promise<string>
vaultRetrieveMany: (slots: string[]) => Promise<Record<string, string>>
`,
  'tests/vault-audit.test.ts': `
vault audit summaries exclude slot names plaintext and ref tokens
nexus-vault-ref:private-token
`,
  'tests/ipc-contract-audit.test.ts': 'export const ipcAudit = true\n',
}

function createVaultSecurityFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-vault-security-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withVaultSecurityFixture<T>(overrides: Record<string, string>, callback: (root: string) => T): T {
  const root = createVaultSecurityFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('vault security audit passes a minimal opaque-ref fixture', () => {
  withVaultSecurityFixture({}, (root) => {
    const report = buildVaultSecurityReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.readsSecrets, false)
    assert.equal(report.privacy.rendererReceivesPlaintextSecrets, false)
  })
})

test('vault security audit rejects plaintext returns from vault IPC', () => {
  withVaultSecurityFixture({
    'electron/ipc/vaultIpc.js': `${BASELINE_FILES['electron/ipc/vaultIpc.js']}
return value
`,
  }, (root) => {
    const report = buildVaultSecurityReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'vault-ipc-returns-plaintext-variable'),
    )
  })
})

test('vault security audit rejects process-global vault ref maps', () => {
  withVaultSecurityFixture({
    'electron/services/vaultRefs.js': BASELINE_FILES['electron/services/vaultRefs.js']
      .replace('const _refsBySender = new WeakMap()', 'const _refsBySender = new Map()'),
  }, (root) => {
    const report = buildVaultSecurityReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'vault-ref-service-allows-untrusted-global-resolution'),
    )
  })
})
