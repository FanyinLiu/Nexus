import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPersonaProfileFromReader } from '../electron/services/personaProfileLoader.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const XINGHUI_SEED_DIR = join(REPO_ROOT, 'src/features/autonomy/v2/personas/xinghui')

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

function makeMapReader(files: Record<string, string>): PersonaFileReader {
  return async (relative) => files[relative] ?? null
}

async function loadExamples(raw: string) {
  const loaded = await loadPersonaProfileFromReader({
    id: 'examples',
    rootDir: '/examples',
    read: makeMapReader({ 'examples.md': raw }),
  })
  return loaded.examples
}

test('persona profile loader returns [] for empty examples input', async () => {
  assert.deepEqual(await loadExamples(''), [])
  assert.deepEqual(await loadExamples('\n\n  \n'), [])
})

test('persona profile loader pairs adjacent User / Assistant example turns', async () => {
  const md = `
### morning
User: 早
Assistant: 醒啦。
`
  const examples = await loadExamples(md)
  assert.equal(examples.length, 1)
  assert.equal(examples[0].user, '早')
  assert.equal(examples[0].assistant, '醒啦。')
})

test('persona profile loader accepts Chinese markers and multi-line example content', async () => {
  const md = `
### ex
用户: 帮我看下
这段代码
助手: 好
第二行
`
  const examples = await loadExamples(md)
  assert.equal(examples.length, 1)
  assert.equal(examples[0].user, '帮我看下\n这段代码')
  assert.equal(examples[0].assistant, '好\n第二行')
})

test('persona profile loader drops an unpaired user example turn', async () => {
  const md = `
User: hanging
User: first
Assistant: matched
`
  const examples = await loadExamples(md)
  assert.equal(examples.length, 1)
  assert.equal(examples[0].user, 'first')
})

test('persona profile loader handles headers as example turn separators', async () => {
  const md = `
### a
User: u1
Assistant: a1

### b
User: u2
Assistant: a2
`
  const examples = await loadExamples(md)
  assert.equal(examples.length, 2)
  assert.equal(examples[0].user, 'u1')
  assert.equal(examples[1].assistant, 'a2')
})

// ── loadPersona: missing files ──────────────────────────────────────────

test('persona profile loader on a completely empty dir returns present=false', async () => {
  const loaded = await loadPersonaProfileFromReader({
    id: 'empty',
    rootDir: '/nowhere',
    read: async () => null,
  })
  assert.equal(loaded.id, 'empty')
  assert.equal(loaded.rootDir, '/nowhere')
  assert.equal(loaded.present, false)
  assert.equal(loaded.soul, '')
  assert.deepEqual(loaded.style, {})
  assert.deepEqual(loaded.examples, [])
})

test('persona profile loader with only soul.md sets present=true and leaves other fields empty', async () => {
  const loaded = await loadPersonaProfileFromReader({
    id: 'partial',
    rootDir: '/partial',
    read: makeMapReader({ 'soul.md': '# only the soul\n' }),
  })
  assert.equal(loaded.present, true)
  assert.equal(loaded.soul, '# only the soul')
  assert.deepEqual(loaded.style, {})
  assert.deepEqual(loaded.examples, [])
  assert.deepEqual(loaded.voice, {})
})

test('persona profile loader gracefully recovers from malformed JSON', async () => {
  const loaded = await loadPersonaProfileFromReader({
    id: 'broken',
    rootDir: '/broken',
    read: makeMapReader({
      'style.json': '{ not valid json',
      'voice.json': '[]',          // wrong top-level type
      'tools.json': '"just a string"',
    }),
  })
  // All three should fall back to {} without throwing.
  assert.deepEqual(loaded.style, {})
  assert.deepEqual(loaded.voice, {})
  assert.deepEqual(loaded.tools, {})
  // style.json WAS present (even if unparseable) → present is true.
  assert.equal(loaded.present, true)
})

// ── loadPersona: real Xinghui seed files ────────────────────────────────

test('persona profile loader loads the bundled Xinghui seed profile end-to-end', async () => {
  const loaded = await loadPersonaProfileFromReader({
    id: 'xinghui',
    rootDir: XINGHUI_SEED_DIR,
    read: makeFsReader(XINGHUI_SEED_DIR),
  })

  assert.equal(loaded.present, true)
  assert.ok(loaded.soul.includes('星绘'), 'soul.md should contain 星绘')
  assert.ok(loaded.soul.includes('Xinghui'), 'soul.md should mention Xinghui')

  // style.json — forbidden phrases are the main guardrail input
  assert.ok(Array.isArray(loaded.style.forbiddenPhrases))
  assert.ok(loaded.style.forbiddenPhrases!.includes('作为 AI'))
  assert.ok(Array.isArray(loaded.style.signaturePhrases))
  assert.ok(loaded.style.signaturePhrases!.length >= 3)

  // voice override should name an Edge TTS Chinese voice
  assert.equal(loaded.voice.providerId, 'edge-tts')
  assert.ok(loaded.voice.voice?.startsWith('zh-CN'))

  // tools allowlist should include web_search + weather
  assert.ok(Array.isArray(loaded.tools.allowlist))
  assert.ok(loaded.tools.allowlist!.includes('web_search'))

  // few-shot parsing — the seed file has > 3 pairs
  assert.ok(loaded.examples.length >= 3, `expected ≥3 examples, got ${loaded.examples.length}`)
  for (const ex of loaded.examples) {
    assert.ok(ex.user.length > 0)
    assert.ok(ex.assistant.length > 0)
  }
})
