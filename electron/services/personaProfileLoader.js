import path from 'node:path'
import { acceptPersonaSoulContent, PERSONA_SOUL_MAX_CHARS } from '../../shared/personaSoul.js'

export { acceptPersonaSoulContent, PERSONA_SOUL_MAX_CHARS }

const PERSONA_PROFILE_FILES = {
  soul: 'soul.md',
  memory: 'memory.md',
  examples: 'examples.md',
  style: 'style.json',
  voice: 'voice.json',
  tools: 'tools.json',
}

function safeParseObject(raw, fallback = {}) {
  if (!raw || !raw.trim()) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Fall through to fallback.
  }
  return fallback
}

function parsePersonaExamplesMarkdown(raw) {
  if (!raw.trim()) return []

  const examples = []
  const userPattern = /^(?:User|用户|U)\s*[:：]\s*(.*)$/i
  const assistantPattern = /^(?:Assistant|助手|Bot|A)\s*[:：]\s*(.*)$/i
  const headerPattern = /^#{1,6}\s/
  const turns = []
  let current = null

  const pushCurrent = () => {
    if (!current) return
    current.content = current.content.trim()
    if (current.content) turns.push(current)
    current = null
  }

  for (const line of raw.split(/\r?\n/)) {
    if (headerPattern.test(line)) {
      pushCurrent()
      continue
    }
    const userMatch = userPattern.exec(line)
    if (userMatch) {
      pushCurrent()
      current = { role: 'user', content: userMatch[1] }
      continue
    }
    const assistantMatch = assistantPattern.exec(line)
    if (assistantMatch) {
      pushCurrent()
      current = { role: 'assistant', content: assistantMatch[1] }
      continue
    }
    if (current) current.content += (current.content ? '\n' : '') + line
  }

  pushCurrent()

  for (let index = 0; index + 1 < turns.length; index += 1) {
    if (turns[index].role === 'user' && turns[index + 1].role === 'assistant') {
      examples.push({
        user: turns[index].content,
        assistant: turns[index + 1].content,
      })
      index += 1
    }
  }

  return examples
}

export async function loadPersonaProfileFromReader(options) {
  const result = {
    id: String(options.id ?? ''),
    rootDir: options.rootDir,
    soul: '',
    memory: '',
    examplesRaw: '',
    examples: [],
    style: {},
    voice: {},
    tools: {},
    present: false,
  }

  const [soul, memory, examplesRaw, styleRaw, voiceRaw, toolsRaw] = await Promise.all([
    options.read(PERSONA_PROFILE_FILES.soul),
    options.read(PERSONA_PROFILE_FILES.memory),
    options.read(PERSONA_PROFILE_FILES.examples),
    options.read(PERSONA_PROFILE_FILES.style),
    options.read(PERSONA_PROFILE_FILES.voice),
    options.read(PERSONA_PROFILE_FILES.tools),
  ])

  if (soul != null) {
    result.soul = soul.trim()
    result.present = true
  }
  if (memory != null) {
    result.memory = memory.trim()
    result.present = true
  }
  if (examplesRaw != null) {
    result.examplesRaw = examplesRaw.trim()
    result.examples = parsePersonaExamplesMarkdown(examplesRaw)
    result.present = true
  }
  if (styleRaw != null) {
    result.style = safeParseObject(styleRaw)
    result.present = true
  }
  if (voiceRaw != null) {
    result.voice = safeParseObject(voiceRaw)
    result.present = true
  }
  if (toolsRaw != null) {
    result.tools = safeParseObject(toolsRaw)
    result.present = true
  }

  if (typeof options.soulMtime === 'function') {
    try {
      const mtimeMs = await options.soulMtime()
      if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)) {
        result.soulMtimeMs = mtimeMs
      }
    } catch {
      // A missing or unreadable stat is not a load failure.
    }
  }

  return result
}

/**
 * Absolute `soul.md` path for a profile, or null when the id is not already
 * one safe path segment. Stripping characters would write a different
 * directory than the one the loader reads, so those ids are refused.
 * @param {unknown} userDataDir
 * @param {unknown} profileId
 * @returns {string | null}
 */
export function resolvePersonaProfileSoulPath(userDataDir, profileId) {
  if (typeof profileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(profileId)) return null
  const root = path.resolve(String(userDataDir ?? ''), 'personas')
  const filePath = path.resolve(root, profileId, PERSONA_PROFILE_FILES.soul)
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (!filePath.startsWith(rootPrefix)) return null
  return filePath
}
