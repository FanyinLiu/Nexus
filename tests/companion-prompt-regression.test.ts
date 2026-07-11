import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import type { AutonomyContextV2 } from '../src/features/autonomy/v2/contextGatherer.ts'
import { buildDecisionPrompt } from '../src/features/autonomy/v2/decisionPrompt.ts'
import { loadPersonaProfileFromReader } from '../electron/services/personaProfileLoader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const XINGHUI_SEED_DIR = join(REPO_ROOT, 'src/features/autonomy/v2/personas/xinghui')
const RUNTIME_FEW_SHOT_LIMIT = 8

type PersonaFileReader = (relativePath: string) => Promise<string | null>

function makeFsReader(rootDir: string): PersonaFileReader {
  return async (relative) => {
    try {
      return await readFile(join(rootDir, relative), 'utf8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
}

function makeContext(): AutonomyContextV2 {
  return {
    timestamp: '2026-06-20T10:00:00.000Z',
    hour: 10,
    dayOfWeek: 6,
    focusState: 'active',
    activeWindowTitle: 'Nexus',
    activityClass: 'coding',
    userDeepFocused: false,
    idleSeconds: 2,
    consecutiveIdleTicks: 0,
    phase: 'awake',
    lastWakeAt: '2026-06-20T09:30:00.000Z',
    lastSleepAt: null,
    emotion: createDefaultEmotionState(),
    relationshipLevel: 'friend',
    relationshipScore: 40,
    daysInteracted: 30,
    streak: 4,
    recentMessages: [
      { role: 'user', content: '帮我看看人格会不会漂', at: '2026-06-20T09:59:00.000Z' },
    ],
    topMemories: [
      { id: 'm1', content: '主人在做 Nexus 桌面伙伴社区', category: 'project', importanceScore: 1.4 },
    ],
    nearReminders: [],
    activeGoals: [],
    activityWindow: 'short',
    lastProactiveUtterance: null,
  }
}

async function loadXinghui() {
  return loadPersonaProfileFromReader({
    id: 'xinghui',
    rootDir: XINGHUI_SEED_DIR,
    read: makeFsReader(XINGHUI_SEED_DIR),
  })
}

test('companion prompt baseline keeps the stable Nexus contract visible', async () => {
  const baseline = await readFile(join(REPO_ROOT, 'docs/NEXUS_COMPANION_PROMPT.md'), 'utf8')

  assert.match(baseline, /local-first desktop AI companion/)
  assert.match(baseline, /Keep the user in control/)
  assert.match(baseline, /Ask before reading files/)
  assert.match(baseline, /Make memory visible, editable, pausable, and deletable/)
  assert.match(baseline, /自动化只是被邀请后的辅助能力/)
})

test('Xinghui seed persona carries the Nexus boundary layer', async () => {
  const persona = await loadXinghui()

  assert.match(persona.soul, /Nexus 的默认可见人格/)
  assert.match(persona.soul, /用户永远拥有控制权/)
  assert.match(persona.soul, /不假装已经执行未完成的动作/)
  assert.match(persona.soul, /读取文件、发送消息、打开外部应用/)
  assert.match(persona.soul, /记忆必须可见、可改、可暂停、可删除/)
})

test('Xinghui runtime few-shots cover the required prompt regression scenarios', async () => {
  const persona = await loadXinghui()
  const runtimeExamples = persona.examples.slice(0, RUNTIME_FEW_SHOT_LIMIT)
  const runtimeUsers = runtimeExamples.map((example) => example.user).join('\n')
  const runtimeAssistants = runtimeExamples.map((example) => example.assistant).join('\n')

  assert.equal(runtimeExamples.length, RUNTIME_FEW_SHOT_LIMIT)
  assert.match(runtimeUsers, /早/)
  assert.match(runtimeUsers, /TypeScript/)
  assert.match(runtimeUsers, /烦死了/)
  assert.match(runtimeUsers, /桌面上的文件/)
  assert.match(runtimeUsers, /打开那个链接了吗/)
  assert.match(runtimeUsers, /上次说的那个项目名/)
  assert.match(runtimeUsers, /为什么知道我在做 Nexus/)
  assert.match(runtimeUsers, /给群里说/)

  assert.match(runtimeAssistants, /我先不碰/)
  assert.match(runtimeAssistants, /没打开成功/)
  assert.match(runtimeAssistants, /没有可靠记忆命中/)
  assert.match(runtimeAssistants, /Memory/)
  assert.match(runtimeAssistants, /确认后我再发/)
})

test('buildDecisionPrompt injects eight Xinghui few-shot pairs before the live user context', async () => {
  const persona = await loadXinghui()
  const messages = buildDecisionPrompt(makeContext(), persona)
  const fewShotMessages = messages.slice(1, -1)
  const fewShotUsers = fewShotMessages.filter((message) => message.role === 'user')
  const fewShotAssistants = fewShotMessages.filter((message) => message.role === 'assistant')

  assert.equal(fewShotUsers.length, RUNTIME_FEW_SHOT_LIMIT)
  assert.equal(fewShotAssistants.length, RUNTIME_FEW_SHOT_LIMIT)
  assert.equal(messages.at(-1)?.role, 'user')

  const assistantPayloads = fewShotAssistants.map((message) => JSON.parse(message.content))
  assert.deepEqual(
    assistantPayloads.map((payload) => payload.action),
    Array.from({ length: RUNTIME_FEW_SHOT_LIMIT }, () => 'speak'),
  )
  assert.match(assistantPayloads[4].text, /没打开成功/)
  assert.match(assistantPayloads[5].text, /不能瞎说/)
})
