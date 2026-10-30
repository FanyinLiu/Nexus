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
const FEW_SHOT_LIMIT = 4

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

test('Xinghui examples still cover the required prompt regression scenarios', async () => {
  const persona = await loadXinghui()
  const allUsers = persona.examples.map((example) => example.user).join('\n')
  const allAssistants = persona.examples.map((example) => example.assistant).join('\n')

  assert.match(allUsers, /早/)
  assert.match(allUsers, /TypeScript/)
  assert.match(allUsers, /烦死了/)
  assert.match(allUsers, /桌面上的文件/)
  assert.match(allUsers, /打开那个链接了吗/)
  assert.match(allUsers, /上次说的那个项目名/)
  assert.match(allUsers, /为什么知道我在做 Nexus/)
  assert.match(allUsers, /给群里说/)

  assert.match(allAssistants, /我先不碰/)
  assert.match(allAssistants, /没打开成功/)
  assert.match(allAssistants, /没有可靠记忆命中/)
  assert.match(allAssistants, /Memory/)
  assert.match(allAssistants, /确认后我再发/)
})

test('buildDecisionPrompt prefers proactive openers in the speak contract', async () => {
  const persona = await loadXinghui()
  const messages = buildDecisionPrompt(makeContext(), persona)
  const fewShotMessages = messages.slice(1, -1)
  const fewShotAssistants = fewShotMessages.filter((message) => message.role === 'assistant')

  assert.ok(fewShotAssistants.length > 0)
  assert.ok(fewShotAssistants.length <= FEW_SHOT_LIMIT + 1)
  assert.equal(messages.at(-1)?.role, 'user')

  const assistantPayloads = fewShotAssistants.map((message) => JSON.parse(message.content))
  for (const payload of assistantPayloads) assert.equal(payload.action, 'speak')
  assert.match(assistantPayloads[0].text, /三点了|还不睡/)
  assert.match(assistantPayloads[1].text, /会开完了|顺利吗/)
  // A proactive opener still gets a quiet-user turn first so every provider
  // sees a valid user → assistant pair.
  assert.equal(fewShotMessages[0].role, 'user')
  assert.equal(fewShotMessages[1].role, 'assistant')
  assert.equal(fewShotMessages[2].role, 'user')
  assert.equal(fewShotMessages[3].role, 'assistant')
})

test('decision prompt leaves the reply register to the character', async () => {
  const persona = await loadXinghui()
  const system = String(buildDecisionPrompt(makeContext(), persona, { uiLanguage: 'en-US' })[0]?.content ?? '')

  assert.doesNotMatch(system, /default to acknowledging/i)
  assert.match(system, /answer the way your character would/i)
})
