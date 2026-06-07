import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  generateAndSaveSkill,
  loadRelevantSkills,
  shouldGenerateSkill,
} from '../src/features/skills/autoSkillGenerator.ts'
import type { AppSettings } from '../src/types/app.ts'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    autoSkillGenerationEnabled: true,
    apiProviderId: 'openai',
    apiBaseUrl: 'https://api.example/v1',
    apiKey: 'key',
    model: 'model',
    ...overrides,
  } as AppSettings
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  })
})

test('shouldGenerateSkill requires opt-in, real tool usage, and substantive reply text', () => {
  const base = {
    userQuery: 'find and summarize',
    assistantReply: 'A'.repeat(150),
    toolCallNames: ['search_web'],
    settings: settings(),
  }

  assert.equal(shouldGenerateSkill(base), true)
  assert.equal(shouldGenerateSkill({ ...base, settings: settings({ autoSkillGenerationEnabled: false }) }), false)
  assert.equal(shouldGenerateSkill({ ...base, toolCallNames: ['   '] }), false)
  assert.equal(shouldGenerateSkill({ ...base, assistantReply: ' '.repeat(200) }), false)
})

test('generateAndSaveSkill refuses contexts that do not satisfy generation rules', async () => {
  let completeCalls = 0
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        completeChat: async () => {
          completeCalls += 1
          return { content: 'unused' }
        },
        skillSave: async () => {},
      },
    },
    configurable: true,
    writable: true,
  })

  const saved = await generateAndSaveSkill({
    userQuery: 'tiny',
    assistantReply: 'short',
    toolCallNames: ['search_web'],
    settings: settings(),
  })

  assert.equal(saved, false)
  assert.equal(completeCalls, 0)
})

test('generateAndSaveSkill saves a parsed skill document', async () => {
  let savedPayload: unknown = null
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        completeChat: async () => ({
          content: `---
title: Research workflow
trigger: research, summarize
summary: Summarize source-backed findings.
---

## Steps
1. Search sources.
2. Summarize evidence.
`,
        }),
        skillSave: async (payload: unknown) => {
          savedPayload = payload
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const saved = await generateAndSaveSkill({
    userQuery: 'research a topic',
    assistantReply: 'A'.repeat(180),
    toolCallNames: ['search_web'],
    settings: settings(),
  })

  assert.equal(saved, true)
  assert.equal((savedPayload as { title: string }).title, 'Research workflow')
  assert.equal((savedPayload as { trigger: string }).trigger, 'research, summarize')
  assert.match((savedPayload as { id: string }).id, /^auto-/)
})

test('loadRelevantSkills strips frontmatter and marks loaded skills as used', async () => {
  const marked: string[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        skillSearch: async () => [
          {
            id: 'skill-1',
            title: 'Research workflow',
            content: `---
title: Research workflow
---
## Steps
Use sources.`,
          },
        ],
        skillMarkUsed: async ({ id }: { id: string }) => {
          marked.push(id)
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const prompt = await loadRelevantSkills('research')

  assert.match(prompt, /Auto skill · Research workflow/)
  assert.match(prompt, /## Steps/)
  assert.doesNotMatch(prompt, /title: Research workflow/)
  assert.deepEqual(marked, ['skill-1'])
})
