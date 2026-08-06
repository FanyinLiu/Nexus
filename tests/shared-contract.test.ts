import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  normalizeWebSearchProviderId,
  WEB_SEARCH_PROVIDER_IDS,
} from '../shared/webSearchProviderIds.js'
import { LOCAL_DATA_COMPANION_STORAGE_KEYS } from '../shared/localDataStorageKeys.js'
import { RUNTIME_STATE_BOOLEAN_FIELD_NAMES, RUNTIME_STATE_FIELD_NAMES } from '../shared/runtimeStateFields.js'

// Source-level single-source contract for the root shared/ modules. Each
// entry pins the literals that used to be copied verbatim between the
// Electron main process and the Vite renderer — the drift points this
// refactor eliminated. If one of these literals reappears under electron/
// or src/, the duplication is back and this test fails.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCANNED_ROOTS = ['electron', 'src']
const SOURCE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

const SINGLE_SOURCE_CONTRACTS: Array<{ name: string; canonicalFile: string; literals: string[] }> = [
  {
    name: 'vault ref prefix',
    canonicalFile: 'shared/vaultRefs.js',
    literals: ['nexus-vault-ref:'],
  },
  {
    name: 'sensitive-text redaction chain',
    canonicalFile: 'shared/redaction.js',
    literals: ['Bearer ***', 'sk-***', 'AIza***', 'jwt***', '[vault-slot]'],
  },
  {
    name: 'desktop context secret patterns',
    canonicalFile: 'shared/desktopContextPrivacy.js',
    literals: ['SECRET_LINE_PATTERNS', 'SECRET_VALUE_PATTERNS'],
  },
  {
    name: 'sprite pet atlas contract',
    canonicalFile: 'shared/spriteAtlasContract.js',
    literals: ['SPRITE_PET_CELL_WIDTH = 192', 'durationsMs: [280, 110, 110, 140, 140, 320]'],
  },
  {
    name: 'model capability heuristics',
    canonicalFile: 'shared/modelCapabilities.js',
    literals: ['gpt-4o(?!-mini-tts|-mini-transcribe|-transcribe)', '/glm-4v/i', 'grok-4\\.20'],
  },
  {
    name: 'provider host inference table',
    canonicalFile: 'shared/providerHostInference.js',
    literals: [
      `'api.minimax.io/anthropic', 'minimax-global',`,
      `'api.minimaxi.com/anthropic', 'minimax',`,
      `'coding.dashscope.aliyuncs.com', 'modelstudio-coding'`,
      `'localhost:11434', 'ollama'`,
    ],
  },
  {
    name: 'chat IPC error codes',
    canonicalFile: 'shared/chatErrorCodes.js',
    literals: [
      `'NEXUS_ERR_CHAT_AUTH_FAILED'`,
      `'NEXUS_ERR_CHAT_UNREACHABLE'`,
      `'NEXUS_ERR_CHAT_EMPTY_CONTENT'`,
    ],
  },
  {
    name: 'GitHub releases URL',
    canonicalFile: 'shared/updates.js',
    literals: ['https://github.com/FanyinLiu/Nexus/releases/latest'],
  },
]

function walkSourceFiles(directory: string): string[] {
  const base = join(ROOT, directory)
  const files: string[] = []

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const fullPath = join(base, entry.name)
    const rel = relative(ROOT, fullPath).split('\\').join('/')
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(rel))
    } else if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) {
      files.push(rel)
    }
  }

  return files
}

const scannedFiles = SCANNED_ROOTS.flatMap((directory) => walkSourceFiles(directory))

for (const contract of SINGLE_SOURCE_CONTRACTS) {
  test(`${contract.name} stays single-sourced in ${contract.canonicalFile}`, () => {
    const canonicalSource = readFileSync(join(ROOT, contract.canonicalFile), 'utf8')
    for (const literal of contract.literals) {
      assert.ok(
        canonicalSource.includes(literal),
        `${contract.canonicalFile} must define: ${literal}`,
      )
    }

    const offenders = scannedFiles.filter((file) => {
      const source = readFileSync(join(ROOT, file), 'utf8')
      return contract.literals.some((literal) => source.includes(literal))
    })
    assert.deepEqual(
      offenders,
      [],
      `${contract.name} literals must stay only in ${contract.canonicalFile}`,
    )
  })
}

test('web search provider id whitelist keeps the 9-provider contract', () => {
  assert.deepEqual([...WEB_SEARCH_PROVIDER_IDS].sort(), [
    'bing',
    'brave',
    'duckduckgo',
    'exa',
    'firecrawl',
    'gemini',
    'minimax',
    'perplexity',
    'tavily',
  ])
  assert.equal(normalizeWebSearchProviderId('brave'), 'brave')
  assert.equal(normalizeWebSearchProviderId('unknown'), 'duckduckgo')
  assert.equal(normalizeWebSearchProviderId(undefined), 'duckduckgo')
})

test('localData companion storage keys keep the 12-key ordered contract', () => {
  // Order is contractual: relationship group (6) first, then task group (6) —
  // the renderer slices the tuple at that boundary and the storage contract
  // destructures by position.
  assert.deepEqual([...LOCAL_DATA_COMPANION_STORAGE_KEYS], [
    'nexus:autonomy:relationship',
    'nexus:autonomy:relationship-history',
    'nexus:autonomy:emotion',
    'nexus:autonomy:emotion-history',
    'nexus:autonomy:rhythm',
    'nexus:autonomy:user-affect-history',
    'nexus:plans',
    'nexus:open-goals',
    'nexus:agent-traces',
    'nexus:background-tasks',
    'nexus:agent:errands',
    'nexus:reminder-tasks',
  ])
})

test('runtime state field names keep the 20-field ordered contract', () => {
  // Order matches the historical schema declaration order shared by the
  // sanitizer and the IPC validator.
  assert.deepEqual([...RUNTIME_STATE_FIELD_NAMES], [
    'mood',
    'continuousVoiceActive',
    'panelSettingsOpen',
    'voiceState',
    'hearingEngine',
    'hearingPhase',
    'wakewordPhase',
    'wakewordActive',
    'wakewordAvailable',
    'wakewordWakeWord',
    'wakewordReason',
    'wakewordLastTriggeredAt',
    'wakewordError',
    'wakewordUpdatedAt',
    'assistantActivity',
    'searchInProgress',
    'ttsInProgress',
    'schedulerArmed',
    'schedulerNextRunAt',
    'activeTaskLabel',
  ])
})

test('runtime state boolean fields keep the 7-item subset contract', () => {
  assert.deepEqual([...RUNTIME_STATE_BOOLEAN_FIELD_NAMES], [
    'continuousVoiceActive',
    'panelSettingsOpen',
    'wakewordActive',
    'wakewordAvailable',
    'searchInProgress',
    'ttsInProgress',
    'schedulerArmed',
  ])
  // The boolean subset must stay inside the patchable field inventory.
  for (const name of RUNTIME_STATE_BOOLEAN_FIELD_NAMES) {
    assert.ok(
      (RUNTIME_STATE_FIELD_NAMES as readonly string[]).includes(name),
      `boolean field ${name} must be part of the 20-field inventory`,
    )
  }
})
