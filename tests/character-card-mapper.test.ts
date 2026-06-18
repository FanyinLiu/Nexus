import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildCharacterCardImportReport,
  mapCardToPersona,
} from '../electron/services/characterCardMapper.js'
import {
  buildCharacterCardReport,
  parseCharacterCardImportReportArgs,
  SAMPLE_CHARACTER_CARD,
} from '../scripts/character-card-import-report.mjs'

const execFileAsync = promisify(execFile)

test('mapCardToPersona writes the assembled persona as systemPrompt, not a placeholder', () => {
  const result = mapCardToPersona({
    data: {
      name: 'Aria',
      description: 'A calm seaside companion.',
      personality: 'Gentle, curious, a little playful.',
      scenario: 'You meet on a quiet pier at dusk.',
    },
  })

  // systemPrompt must carry the real card identity (same as soul.md) so an
  // imported card drives chat even when the per-profile persona flag is off —
  // not the old "[Character card: X]" stub that leaked in as literal text.
  assert.equal(result.profile.systemPrompt, result.files['soul.md'])
  assert.ok(!result.profile.systemPrompt.includes('[Character card:'))
  assert.match(result.profile.systemPrompt, /Aria/)
  assert.match(result.profile.systemPrompt, /Gentle, curious/)
  assert.match(result.profile.systemPrompt, /## Scenario/)
})

test('mapCardToPersona emits a safe import report for role package review', () => {
  const result = mapCardToPersona({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      description: 'A calm seaside companion.',
      personality: 'Gentle, curious, a little playful.',
      scenario: 'You meet on a quiet pier at dusk.',
      creator_notes: 'Private creator note that should not be copied verbatim.',
      first_mes: 'Good evening.',
      mes_example: '<START>\n{{user}}: hello\n{{char}}: hello back',
      character_book: {
        entries: [{
          name: 'Pier',
          keys: ['pier', 'dusk'],
          content: 'The pier is quiet after sunset.',
          enabled: true,
          priority: 12,
        }],
      },
      tags: ['soft', 'seaside'],
    },
  })

  const report = result.importReport
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.gate, 'character-card-import')
  assert.equal(report.spec, 'chara_card_v2')
  assert.equal(report.source.name, 'Aria')
  assert.equal(report.source.hasCreatorNotes, true)
  assert.equal(report.source.hasGreeting, true)
  assert.equal(report.source.exampleBlocks, 1)
  assert.equal(report.source.characterBookEntries, 1)
  assert.equal(report.personaFiles['soul.md'].present, true)
  assert.equal(report.personaFiles['style.json'].present, true)
  assert.equal(report.lorebook.entries, 1)
  assert.equal(report.lorebook.enabledEntries, 1)
  assert.equal(report.lorebook.keywordCount, 2)
  assert.equal(report.profile.systemPromptChars, result.profile.systemPrompt.length)
  assert.equal(checks.get('card-name'), true)
  assert.equal(checks.get('profile-created'), true)
  assert.equal(checks.get('system-prompt-matches-soul'), true)
  assert.equal(checks.get('persona-files-written'), true)
  assert.equal(checks.get('examples-normalized'), true)
  assert.equal(checks.get('lorebook-normalized'), true)
  assert.equal(checks.get('greeting-captured'), true)
  assert.equal(checks.get('role-package-preset-normalized'), true)
  assert.equal(JSON.stringify(report).includes('Private creator note'), false)
  assert.equal(JSON.stringify(report).includes('The pier is quiet after sunset.'), false)
})

test('mapCardToPersona imports safe Nexus role package presets without leaking secrets to the report', () => {
  const result = mapCardToPersona({
    spec: 'chara_card_v2',
    data: {
      name: 'Mira',
      description: 'A focused coding partner.',
      tags: ['focused', 'desktop'],
      extensions: {
        nexus: {
          petModelId: 'original-virtual-swordsman',
          style: {
            toneTags: ['calm', 'focused'],
            signaturePhrases: ['Let me line that up.'],
            forbiddenPhrases: ['As an AI'],
          },
          voice: {
            providerId: 'local-tts',
            voice: 'zh_female_01',
            model: 'melo-zh-en',
            instructions: 'Speak softly and keep pauses short.',
            apiBaseUrl: 'http://secret-local.example',
            apiKey: 'sk-secret',
          },
          tools: {
            allowlist: ['weather', 'calendar'],
            blocklist: ['shell'],
          },
        },
      },
    },
  })

  const style = JSON.parse(result.files['style.json'])
  const voice = JSON.parse(result.files['voice.json'])
  const tools = JSON.parse(result.files['tools.json'])
  const reportJson = JSON.stringify(result.importReport)
  const checks = new Map(result.importReport.checks.map((check) => [check.id, check.pass]))

  assert.deepEqual(style.toneTags, ['focused', 'desktop', 'calm'])
  assert.deepEqual(style.signaturePhrases, ['Let me line that up.'])
  assert.deepEqual(style.forbiddenPhrases, ['As an AI'])
  assert.deepEqual(voice, {
    providerId: 'local-tts',
    voice: 'zh_female_01',
    model: 'melo-zh-en',
    instructions: 'Speak softly and keep pauses short.',
  })
  assert.deepEqual(tools, {
    allowlist: ['weather', 'calendar'],
    blocklist: ['shell'],
  })
  assert.equal(result.profile.petModelId, 'original-virtual-swordsman')
  assert.equal(result.profile.speechOutputProviderId, 'local-tts')
  assert.equal(result.profile.speechOutputVoice, 'zh_female_01')
  assert.equal(result.profile.speechOutputModel, 'melo-zh-en')
  assert.equal(result.profile.speechOutputInstructions, 'Speak softly and keep pauses short.')
  assert.equal(result.importReport.rolePackagePreset.explicit, true)
  assert.equal(result.importReport.rolePackagePreset.validFieldCount, 13)
  assert.equal(result.importReport.rolePackagePreset.style.toneTagCount, 3)
  assert.equal(result.importReport.rolePackagePreset.voice.hasProviderId, true)
  assert.equal(result.importReport.rolePackagePreset.voice.ignoredApiBaseUrl, true)
  assert.equal(result.importReport.rolePackagePreset.voice.ignoredApiKey, true)
  assert.equal(result.importReport.rolePackagePreset.tools.allowlistCount, 2)
  assert.equal(result.importReport.rolePackagePreset.petModel.provided, true)
  assert.equal(checks.get('role-package-preset-normalized'), true)
  assert.equal(reportJson.includes('sk-secret'), false)
  assert.equal(reportJson.includes('secret-local'), false)
  assert.equal(reportJson.includes('Speak softly'), false)
})

test('character card report args support output aliases and readiness gate', () => {
  assert.deepEqual(parseCharacterCardImportReportArgs([
    '--card-file',
    'card.json',
    '--generated-at=2026-06-16T16:00:00Z',
    '--output',
    'artifacts/v0.3.4/character-card-import.json',
    '--require-ready',
  ]), {
    cardFile: 'card.json',
    generatedAt: '2026-06-16T16:00:00Z',
    outputPath: 'artifacts/v0.3.4/character-card-import.json',
    requireReady: true,
    sample: false,
    help: false,
  })
})

test('character card report args support private-safe sample mode', () => {
  assert.deepEqual(parseCharacterCardImportReportArgs([
    '--sample',
    '--generated-at',
    '2026-06-16T16:30:00Z',
    '--output=artifacts/v0.3.4/character-card-import.json',
    '--require-ready',
  ]), {
    cardFile: '',
    generatedAt: '2026-06-16T16:30:00Z',
    outputPath: 'artifacts/v0.3.4/character-card-import.json',
    requireReady: true,
    sample: true,
    help: false,
  })
})

test('buildCharacterCardReport marks readiness and omits private card bodies', () => {
  const report = buildCharacterCardReport({
    spec: 'chara_card_v2',
    data: {
      name: 'Mira',
      description: 'Private description.',
      personality: 'Private personality.',
      scenario: 'Private scenario.',
      system_prompt: 'Private system prompt.',
      post_history_instructions: 'Private post-history instructions.',
      creator_notes: 'Private creator notes.',
      first_mes: 'Private greeting.',
      mes_example: '<START>\n{{user}}: private user\n{{char}}: private reply',
      character_book: {
        entries: [{
          keys: ['secret-keyword'],
          content: 'Private lorebook content.',
        }],
      },
      extensions: {
        nexus: {
          voice: {
            providerId: 'local-tts',
            apiBaseUrl: 'https://private.example',
            apiKey: 'sk-private',
          },
        },
      },
    },
  }, '2026-06-16T16:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.generatedAt, '2026-06-16T16:00:00.000Z')
  assert.equal(report.rolePackagePreset.voice.hasProviderId, true)
  assert.equal(report.rolePackagePreset.voice.ignoredApiBaseUrl, true)
  assert.equal(report.rolePackagePreset.voice.ignoredApiKey, true)
  assert.equal(json.includes('Private description'), false)
  assert.equal(json.includes('Private personality'), false)
  assert.equal(json.includes('Private scenario'), false)
  assert.equal(json.includes('Private system prompt'), false)
  assert.equal(json.includes('Private creator notes'), false)
  assert.equal(json.includes('Private greeting'), false)
  assert.equal(json.includes('Private lorebook content'), false)
  assert.equal(json.includes('private reply'), false)
  assert.equal(json.includes('https://private.example'), false)
  assert.equal(json.includes('sk-private'), false)
})

test('built-in sample Character Card produces private-safe readiness evidence', () => {
  const report = buildCharacterCardReport(SAMPLE_CHARACTER_CARD, '2026-06-16T16:30:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.gate, 'character-card-import')
  assert.equal(report.generatedAt, '2026-06-16T16:30:00.000Z')
  assert.equal(report.rolePackagePreset.explicit, true)
  assert.equal(report.rolePackagePreset.voice.hasProviderId, true)
  assert.equal(report.lorebook.entries, 1)
  assert.equal(report.lorebook.enabledEntries, 1)
  assert.equal(report.source.hasGreeting, true)
  assert.equal(json.includes('Mira watches for long-running'), false)
  assert.equal(json.includes('I am here'), false)
  assert.equal(json.includes('I am scattered'), false)
  assert.equal(json.includes('Speak softly'), false)
  assert.equal(json.includes('sample-local-tts'), false)
})

test('character card report CLI can persist private-safe evidence', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-character-card-'))
  const inputPath = path.join(outputRoot, 'card.json')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'character-card-import.json')
  try {
    await writeFile(inputPath, JSON.stringify({
      spec: 'chara_card_v2',
      data: {
        name: 'Aria',
        description: 'Private description for Aria.',
        personality: 'Private personality.',
        creator_notes: 'Private notes.',
        first_mes: 'Private greeting.',
        mes_example: '<START>\n{{user}}: private hello\n{{char}}: private response',
        character_book: {
          entries: [{
            name: 'Private lore',
            keys: ['private-keyword'],
            content: 'Private lorebook content.',
          }],
        },
        extensions: {
          nexus: {
            voice: {
              providerId: 'local-tts',
              apiKey: 'sk-private',
            },
          },
        },
      },
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/character-card-import-report.mjs',
      '--card-file',
      inputPath,
      '--generated-at',
      '2026-06-16T16:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, 'character-card-import')
    assert.equal(fileReport.source.hasCreatorNotes, true)
    assert.equal(fileReport.lorebook.entries, 1)
    assert.equal(json.includes('Private description for Aria'), false)
    assert.equal(json.includes('Private personality'), false)
    assert.equal(json.includes('Private notes'), false)
    assert.equal(json.includes('Private greeting'), false)
    assert.equal(json.includes('private response'), false)
    assert.equal(json.includes('Private lorebook content'), false)
    assert.equal(json.includes('sk-private'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('character card report CLI can persist the built-in sample evidence', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-character-card-sample-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'character-card-import.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/character-card-import-report.mjs',
      '--sample',
      '--generated-at',
      '2026-06-16T16:30:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, 'character-card-import')
    assert.equal(fileReport.rolePackagePreset.explicit, true)
    assert.equal(fileReport.lorebook.entries, 1)
    assert.equal(json.includes('Mira watches for long-running'), false)
    assert.equal(json.includes('I am here'), false)
    assert.equal(json.includes('I am scattered'), false)
    assert.equal(json.includes('Speak softly'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('character card report CLI fails the readiness gate for incomplete cards', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-character-card-bad-'))
  const inputPath = path.join(outputRoot, 'card.json')
  try {
    await writeFile(inputPath, JSON.stringify({
      spec: 'chara_card_v2',
      data: {
        description: 'No card name.',
      },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/character-card-import-report.mjs',
        '--card-file',
        inputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.equal(report.checks.some((check: { id: string; pass: boolean }) =>
          check.id === 'card-name' && check.pass === false,
        ), true)
        return true
      },
    )
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('mapCardToPersona ignores unsupported imported voice providers in role presets', () => {
  const result = mapCardToPersona({
    data: {
      name: 'Cloudy',
      extensions: {
        nexusRolePreset: {
          voice: {
            providerId: 'minimax-tts',
            voice: 'female-shaonv',
          },
        },
      },
    },
  })
  const voice = JSON.parse(result.files['voice.json'])

  assert.equal(voice.providerId, undefined)
  assert.equal(voice.voice, 'female-shaonv')
  assert.equal(result.profile.speechOutputProviderId, undefined)
  assert.equal(result.importReport.rolePackagePreset.voice.ignoredUnsupportedProviderId, true)
})

test('buildCharacterCardImportReport keeps optional card sections explicit', () => {
  const report = buildCharacterCardImportReport(
    { spec: 'chara_card_v2', data: { name: 'Minimal' } },
    {
      files: {
        'soul.md': '# Minimal',
        'memory.md': '',
        'examples.md': '',
        'style.json': '{}',
        'voice.json': '{}',
        'tools.json': '{}',
      },
      greeting: null,
      lorebookEntries: [],
      profile: {
        id: 'card-minimal',
        label: 'Minimal',
        companionName: 'Minimal',
        systemPrompt: '# Minimal',
        petModelId: '',
      },
    },
    '2026-06-16T15:00:00Z',
  )

  assert.equal(report.generatedAt, '2026-06-16T15:00:00.000Z')
  assert.equal(report.source.hasDescription, false)
  assert.equal(report.source.exampleBlocks, 0)
  assert.equal(report.lorebook.entries, 0)
  assert.equal(report.checks.every((check) => check.pass), true)
})

test('character card import report wiring stays available in packaged builds', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))

  assert.equal(pkg.scripts?.['character:card:report'], 'node scripts/character-card-import-report.mjs')
  assert.ok(pkg.build?.files?.includes('scripts/character-card-import-report.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/character-card-import-report.mjs'))
})
