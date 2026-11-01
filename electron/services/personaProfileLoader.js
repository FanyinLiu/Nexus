// @ts-nocheck
import path from 'node:path'
import { acceptPersonaSoulContent, PERSONA_SOUL_MAX_CHARS } from '../../shared/personaSoul.js'
import { normalizePersonaSpeechStyle } from '../../shared/speechStyle.js'

export { acceptPersonaSoulContent, PERSONA_SOUL_MAX_CHARS }

const PERSONA_PROFILE_FILES = {
  soul: 'soul.md',
  memory: 'memory.md',
  examples: 'examples.md',
  style: 'style.json',
  voice: 'voice.json',
  tools: 'tools.json',
}

/**
 * Persona text may arrive with CRLF endings (a Windows checkout of the seed,
 * or an editor that saved CRLF). Normalize so one profile yields the same
 * prompt text on every platform.
 * @param {string} text
 * @returns {string}
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, '\n')
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

/**
 * Normalize the optional speech dials in a persona style object.
 *
 * Unknown keys are dropped and numbers are clamped by the shared module so
 * the settings card, the prompt builder, and a hand-edited style.json agree.
 * The rest of style.json is passed through untouched.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizePersonaStyle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const style = { .../** @type {Record<string, unknown>} */ (raw) }
  if ('speechStyle' in style) {
    const speechStyle = normalizePersonaSpeechStyle(style.speechStyle)
    if (speechStyle) style.speechStyle = speechStyle
    else delete style.speechStyle
  }
  return style
}

const MOOD_HEADING_PATTERN = /^#{1,6}\s*mood\s*[:：]\s*([A-Za-z][\w-]*)\s*$/i
const PROACTIVE_HEADING_PATTERN = /^#{1,6}\s*(?:kind\s*[:：]\s*)?proactive\s*$/i
const BROAD_HEADING_PATTERN = /^#{1,2}\s/

/**
 * Parse examples.md into voice samples.
 *
 * Supported grouping headings, applied to the examples that follow until the
 * next broad (`#` / `##`) heading:
 * - `## mood: affectionate` — tag the group with a feeling word.
 * - `## proactive` — these are lines she opens with, not replies.
 *
 * Any other `#` / `##` heading resets the group back to an untagged reply.
 * Untagged files parse exactly as before, and a proactive group may contain a
 * bare `Assistant:` line because nobody spoke before her.
 * @param {string} raw
 * @returns {Array<{ user: string, assistant: string, mood?: string, kind: 'reply' | 'proactive' }>}
 */
export function parsePersonaExamplesMarkdown(raw) {
  if (!raw.trim()) return []

  const examples = []
  const userPattern = /^(?:User|用户|U)\s*[:：]\s*(.*)$/i
  const assistantPattern = /^(?:Assistant|助手|Bot|A)\s*[:：]\s*(.*)$/i
  const headerPattern = /^#{1,6}\s/
  const turns = []
  let current = null
  let groupMood
  let groupKind = 'reply'

  const pushCurrent = () => {
    if (!current) return
    current.content = current.content.trim()
    if (current.content) turns.push(current)
    current = null
  }

  const startTurn = (role, content) => {
    pushCurrent()
    current = { role, content, groupMood, groupKind }
  }

  for (const line of raw.split(/\r?\n/)) {
    const moodMatch = MOOD_HEADING_PATTERN.exec(line)
    if (moodMatch) {
      pushCurrent()
      groupMood = moodMatch[1].toLowerCase()
      groupKind = 'reply'
      continue
    }
    if (PROACTIVE_HEADING_PATTERN.test(line)) {
      pushCurrent()
      groupMood = undefined
      groupKind = 'proactive'
      continue
    }
    if (headerPattern.test(line)) {
      pushCurrent()
      if (BROAD_HEADING_PATTERN.test(line)) {
        groupMood = undefined
        groupKind = 'reply'
      }
      continue
    }
    const userMatch = userPattern.exec(line)
    if (userMatch) {
      startTurn('user', userMatch[1])
      continue
    }
    const assistantMatch = assistantPattern.exec(line)
    if (assistantMatch) {
      startTurn('assistant', assistantMatch[1])
      continue
    }
    if (current) current.content += (current.content ? '\n' : '') + line
  }

  pushCurrent()

  const withKind = (turn, user, assistant) => ({
    user,
    assistant,
    ...(turn.groupMood ? { mood: turn.groupMood } : {}),
    kind: turn.groupKind,
  })

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]
    if (turn.role === 'user' && turns[index + 1]?.role === 'assistant') {
      examples.push(withKind(turn, turn.content, turns[index + 1].content))
      index += 1
      continue
    }
    // A proactive group may hold a line with no prompting turn; keep it as an
    // assistant-only example so the decision prompt can show her opening.
    if (turn.role === 'assistant' && turn.groupKind === 'proactive') {
      examples.push(withKind(turn, '', turn.content))
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
    result.soul = normalizeLineEndings(soul).trim()
    result.present = true
  }
  if (memory != null) {
    result.memory = normalizeLineEndings(memory).trim()
    result.present = true
  }
  if (examplesRaw != null) {
    const normalizedExamples = normalizeLineEndings(examplesRaw)
    result.examplesRaw = normalizedExamples.trim()
    result.examples = parsePersonaExamplesMarkdown(normalizedExamples)
    result.present = true
  }
  if (styleRaw != null) {
    result.style = normalizePersonaStyle(safeParseObject(styleRaw))
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
 * Absolute path for one file inside a profile directory, or null when the id
 * is not already one safe path segment. Stripping characters would write a
 * different directory than the one the loader reads, so those ids are refused.
 * @param {unknown} userDataDir
 * @param {unknown} profileId
 * @param {string} fileName
 * @returns {string | null}
 */
function resolvePersonaProfileFilePath(userDataDir, profileId, fileName) {
  if (typeof profileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(profileId)) return null
  const root = path.resolve(String(userDataDir ?? ''), 'personas')
  const filePath = path.resolve(root, profileId, fileName)
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (!filePath.startsWith(rootPrefix)) return null
  return filePath
}

/**
 * Absolute `soul.md` path for a profile.
 * @param {unknown} userDataDir
 * @param {unknown} profileId
 * @returns {string | null}
 */
export function resolvePersonaProfileSoulPath(userDataDir, profileId) {
  return resolvePersonaProfileFilePath(userDataDir, profileId, PERSONA_PROFILE_FILES.soul)
}

/**
 * Absolute `style.json` path for a profile. Style writes use the same
 * segment check as soul writes so the card cannot create a sibling directory
 * the loader would never read.
 * @param {unknown} userDataDir
 * @param {unknown} profileId
 * @returns {string | null}
 */
export function resolvePersonaProfileStylePath(userDataDir, profileId) {
  return resolvePersonaProfileFilePath(userDataDir, profileId, PERSONA_PROFILE_FILES.style)
}
