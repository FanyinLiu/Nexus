#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'electron/ipc/vaultIpc.js',
  'electron/services/keyVault.js',
  'electron/services/vaultRefs.js',
  'electron/ipc/vaultAudit.js',
  'electron/preload.js',
  'electron/ipc/chatIpc.js',
  'electron/ipc/audioIpc.js',
  'electron/ipc/ttsStreamIpc.js',
  'electron/ipc/serviceIpc.js',
  'electron/ipc/telegramIpc.js',
  'electron/ipc/discordIpc.js',
  'electron/tools/toolRegistry.js',
  'src/lib/keyVaultBridge.ts',
  'src/vite-env.d.ts',
  'tests/vault-audit.test.ts',
  'tests/ipc-contract-audit.test.ts',
]

const UNSAFE_PATTERNS = [
  {
    id: 'vault-ipc-imports-plaintext-retrieve',
    file: 'electron/ipc/vaultIpc.js',
    pattern: /import\s*\{[\s\S]*\bvaultRetrieve(?:Many)?\b[\s\S]*\}\s*from\s+['"]\.\.\/services\/keyVault\.js['"]/,
    message: 'vault IPC must issue opaque refs, not retrieve plaintext secrets for renderer returns',
  },
  {
    id: 'vault-ipc-returns-plaintext-variable',
    file: 'electron/ipc/vaultIpc.js',
    pattern: /return\s+(?:plaintext|value|values)\b/,
    message: 'vault IPC retrieval paths must not return plaintext variables to the renderer',
  },
  {
    id: 'vault-ref-service-allows-untrusted-global-resolution',
    file: 'electron/services/vaultRefs.js',
    pattern: /const\s+_refsBySender\s*=\s*new\s+Map\(/,
    message: 'vault refs must stay scoped by sender with WeakMap, not a process-global Map',
  },
  {
    id: 'vault-preload-doc-says-plaintext',
    file: 'electron/preload.js',
    pattern: /vaultRetrieve(?:Many)?:\s*\([^)]*\)\s*=>\s*Promise<[^>]*plaintext/i,
    message: 'preload comments must not document vault retrieval as plaintext access',
  },
  {
    id: 'renderer-vault-type-doc-says-plaintext',
    file: 'src/vite-env.d.ts',
    pattern: /vaultRetrieve[\s\S]{0,260}plaintext(?! is resolved only in the main process)/i,
    message: 'renderer vault types must describe opaque refs, not plaintext retrieval',
  },
  {
    id: 'key-vault-raw-read-error-log',
    file: 'electron/services/keyVault.js',
    pattern: /console\.warn\('\[KeyVault\] Failed to read vault file:',\s*error\)/,
    message: 'KeyVault read failures must redact raw error objects before logging',
  },
  {
    id: 'key-vault-raw-slot-log',
    file: 'electron/services/keyVault.js',
    pattern: /cannot decrypt slot:\s*\$\{slot\}|Failed to decrypt slot "\$\{slot\}"/,
    message: 'KeyVault decrypt logs must not record raw vault slot names',
  },
  {
    id: 'key-vault-raw-decrypt-error-log',
    file: 'electron/services/keyVault.js',
    pattern: /console\.warn\(`\[KeyVault\] Failed to decrypt slot[^`]+`,\s*error\)/,
    message: 'KeyVault decrypt failures must redact raw error objects before logging',
  },
]

const REQUIRED_PHRASES = [
  {
    id: 'vault-ipc-retrieval-issues-refs',
    file: 'electron/ipc/vaultIpc.js',
    phrases: [
      "import { issueVaultRefForSender } from '../services/vaultRefs.js'",
      "ipcMain.handle('vault:retrieve'",
      'return issueVaultRefForSender(event.sender, name)',
      "ipcMain.handle('vault:retrieve-many'",
      'refs[name] = issueVaultRefForSender(event.sender, name)',
      'rateLimitSingleRetrieve(event, name)',
      "rateLimitBulkOp(event, 'retrieve-many')",
    ],
  },
  {
    id: 'key-vault-support-logs-are-secret-safe',
    file: 'electron/services/keyVault.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'function formatVaultSlotLogLabel(slot)',
      "console.warn('[KeyVault] Failed to read vault file:', getRedactedErrorMessage(error))",
      'Encryption unavailable, cannot decrypt slot (${formatVaultSlotLogLabel(slot)})',
      'Failed to decrypt slot (${formatVaultSlotLogLabel(slot)}):',
      'getRedactedErrorMessage(error)',
    ],
  },
  {
    id: 'vault-refs-resolve-only-for-sender',
    file: 'electron/services/vaultRefs.js',
    phrases: [
      'export const VAULT_REF_PREFIX',
      'const _refsBySender = new WeakMap()',
      'export function issueVaultRefForSender(sender, slot)',
      'export async function resolveVaultRefsForSender(sender, source, fields)',
      'const refs = sender ? _refsBySender.get(sender) : null',
      'if (!entry) throw new Error(`payload.${field} references an expired vault token`)',
      'const values = await vaultRetrieveMany(slots)',
    ],
  },
  {
    id: 'vault-audit-metadata-only',
    file: 'electron/ipc/vaultAudit.js',
    phrases: [
      'plaintextLength',
      'refCount',
      'refTextTotalLength',
      'returnedSlotNameTotalLength',
    ],
  },
  {
    id: 'renderer-vault-bridge-keeps-ref-in-state',
    file: 'src/lib/keyVaultBridge.ts',
    phrases: [
      'export const VAULT_REF_PREFIX',
      'displaySecretInputValue',
      'if (isVaultRefString(value)) return',
      'await window.desktopPet!.vaultRetrieveMany(allSlots)',
      'hydrateProfileKeys',
    ],
  },
  {
    id: 'renderer-vault-types-document-opaque-refs',
    file: 'src/vite-env.d.ts',
    phrases: [
      'Retrieval returns opaque',
      'nexus-vault-ref tokens; plaintext is resolved only in the main process.',
      'vaultRetrieve: (slot: string) => Promise<string>',
      'vaultRetrieveMany: (slots: string[]) => Promise<Record<string, string>>',
    ],
  },
  {
    id: 'preload-vault-documents-opaque-refs',
    file: 'electron/preload.js',
    phrases: [
      'Retrieval returns opaque refs;',
      'plaintext secret values stay in main-process handlers.',
      "vaultRetrieve: (slot) => ipcRenderer.invoke('vault:retrieve', slot)",
      "vaultRetrieveMany: (slots) => ipcRenderer.invoke('vault:retrieve-many', slots)",
    ],
  },
  {
    id: 'chat-ipc-resolves-vault-refs',
    file: 'electron/ipc/chatIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['apiKey'])",
    ],
  },
  {
    id: 'audio-ipc-resolves-vault-refs',
    file: 'electron/ipc/audioIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['apiKey'])",
    ],
  },
  {
    id: 'tts-stream-ipc-resolves-vault-refs',
    file: 'electron/ipc/ttsStreamIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['apiKey'])",
    ],
  },
  {
    id: 'service-ipc-resolves-vault-refs',
    file: 'electron/ipc/serviceIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['apiKey'])",
    ],
  },
  {
    id: 'telegram-ipc-resolves-vault-refs',
    file: 'electron/ipc/telegramIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['botToken'])",
    ],
  },
  {
    id: 'discord-ipc-resolves-vault-refs',
    file: 'electron/ipc/discordIpc.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "resolveVaultRefsForSender(event.sender, payload, ['botToken'])",
    ],
  },
  {
    id: 'tool-registry-resolves-secret-fields',
    file: 'electron/tools/toolRegistry.js',
    phrases: [
      "import { resolveVaultRefsForSender } from '../services/vaultRefs.js'",
      "secretFields: ['apiKey']",
      'const resolvedPayload = await resolveVaultRefsForSender(',
      'toolDefinition.secretFields ?? []',
    ],
  },
  {
    id: 'vault-tests-cover-ref-boundary',
    file: 'tests/vault-audit.test.ts',
    phrases: [
      'vault audit summaries exclude slot names plaintext and ref tokens',
      'nexus-vault-ref:private-token',
    ],
  },
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

export function buildVaultSecurityReport(root = ROOT) {
  const missingFiles = []
  const unsafePatterns = []
  const missingRequiredPhrases = []
  const sourceByFile = new Map()

  for (const file of CHECKED_FILES) {
    const fullPath = join(root, file)
    if (!existsSync(fullPath)) {
      missingFiles.push({ file })
      continue
    }
    sourceByFile.set(file, readText(root, file))
  }

  for (const item of UNSAFE_PATTERNS) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    if (item.pattern.test(source)) {
      unsafePatterns.push({
        id: item.id,
        file: item.file,
        message: item.message,
      })
    }
  }

  for (const item of REQUIRED_PHRASES) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    for (const phrase of item.phrases) {
      if (!source.includes(phrase)) {
        missingRequiredPhrases.push({ id: item.id, file: item.file, phrase })
      }
    }
  }

  const errors = { missingFiles, unsafePatterns, missingRequiredPhrases }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: CHECKED_FILES,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
      warnings: 0,
    },
    privacy: {
      staticSourceOnly: true,
      readsUserData: false,
      readsSecrets: false,
      rendererReceivesPlaintextSecrets: false,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Vault security audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.privacy.staticSourceOnly}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file}: ${item.id ?? item.phrase ?? item.message}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildVaultSecurityReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
