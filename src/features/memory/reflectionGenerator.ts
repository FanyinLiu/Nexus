/**
 * Reflection store (N.E.K.O. borrow).
 *
 * A reflection is a self-generated observation about the user — "user
 * seems stressed on Mondays," "user tends to code late at night." These
 * are distinct from user-stated facts (long-term memories) and the
 * companion's own persona. Autonomy V2 reads reflections as context
 * when deciding tone and timing of proactive turns.
 *
 * Storage piggybacks on MemoryItem with `importance: 'reflection'` so no
 * new store is introduced — matches Nexus's "stability over refactor"
 * constraint. Dedup is by `reflectionTopic`: a new entry on the same
 * topic supersedes the old one.
 *
 * Generation runs inside the dream cycle so it amortises onto LLM work
 * that was going to happen anyway — see useMemoryDream.
 */

import type {
  DailyMemoryEntry,
  MemoryItem,
} from '../../types/memory.ts'

const MAX_REFLECTIONS = 20
const MIN_CONFIDENCE = 0.4
const MAX_NEW_REFLECTIONS_PER_CYCLE = 3
const MAX_CONTENT_CHARS = 200
const MAX_TOPIC_CHARS = 40

export interface ReflectionCandidate {
  content: string
  topic: string
  confidence: number
}

/**
 * Build the LLM prompt that asks the model to emit reflections about
 * the user based on recent diary entries + emotion / relationship trend
 * lines. Returns null when there isn't enough signal to be worth a call.
 */
export function buildReflectionPrompt(opts: {
  uiLanguage: string
  dailyEntries: DailyMemoryEntry[]
  relationshipTrend: string | null
  emotionTrend: string | null
  existingReflections: Array<{ topic: string; content: string }>
}): { system: string; user: string } | null {
  // We need at least a handful of diary entries; otherwise the model is
  // guessing from no data. The threshold is low on purpose — a user who
  // only logs two entries a week still deserves reflections.
  if (opts.dailyEntries.length < 5) return null

  const system = [
    'You generate short observations ("reflections") about the user based on',
    'their recent diary entries and emotional trend. Each reflection is a',
    'single sentence summarising something stable you noticed — a habit, a',
    'preference, a pattern. Ignore one-off events. If an existing reflection',
    'already covers a topic, only emit a replacement if your new phrasing is',
    'materially better — otherwise skip that topic.',
    '',
    'Output strict JSON: {"reflections": [{"content": "...", "topic": "one-word-slug",',
    '"confidence": 0.7}, ...]}',
    '- content: the observation sentence itself, in the user\'s language',
    '- topic: short kebab-case slug identifying the recurring theme',
    '- confidence: 0 to 1, how sure you are the pattern is real',
    '',
    'Emit at most 3 reflections per response. If no clear pattern exists,',
    `return {"reflections": []}. Respond in ${opts.uiLanguage}.`,
  ].join('\n')

  const recentEntries = opts.dailyEntries.slice(-30).map((e) => (
    `[${e.day} ${e.role}] ${e.content.slice(0, 140)}`
  )).join('\n')

  const trendLines: string[] = []
  if (opts.emotionTrend) trendLines.push(`Emotion trend: ${opts.emotionTrend}`)
  if (opts.relationshipTrend) trendLines.push(`Relationship trend: ${opts.relationshipTrend}`)
  const existingSummary = opts.existingReflections.length
    ? opts.existingReflections.map((r) => `- [${r.topic}] ${r.content}`).join('\n')
    : '(none yet)'

  const user = [
    'Recent diary entries (oldest first):',
    recentEntries || '(empty)',
    '',
    trendLines.length ? trendLines.join('\n') : 'No trend data available.',
    '',
    'Existing reflections:',
    existingSummary,
  ].join('\n')

  return { system, user }
}

/**
 * Parse the LLM response into structured reflection candidates. Rejects
 * malformed entries silently — one bad reflection should not kill the
 * whole batch. Returns at most MAX_NEW_REFLECTIONS_PER_CYCLE.
 */
export function parseReflectionResponse(raw: string): ReflectionCandidate[] {
  if (!raw) return []
  const trimmed = raw.trim()

  // Fast path: whole response is clean JSON.
  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmed)
  } catch { /* fall through */ }

  if (!parsed) {
    // Pull the first balanced {...} out of noisy responses.
    const start = trimmed.indexOf('{')
    if (start === -1) return []
    let depth = 0
    let inString = false
    let escape = false
    let end = -1
    for (let i = start; i < trimmed.length; i += 1) {
      const ch = trimmed[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end === -1) return []
    try {
      parsed = JSON.parse(trimmed.slice(start, end))
    } catch {
      return []
    }
  }

  if (!parsed || typeof parsed !== 'object') return []
  const reflections = (parsed as { reflections?: unknown }).reflections
  if (!Array.isArray(reflections)) return []

  const out: ReflectionCandidate[] = []
  for (const entry of reflections) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const content = typeof obj.content === 'string' ? obj.content.trim().slice(0, MAX_CONTENT_CHARS) : ''
    const topic = typeof obj.topic === 'string' ? obj.topic.trim().toLowerCase().slice(0, MAX_TOPIC_CHARS) : ''
    const confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0
    if (!content || !topic) continue
    if (confidence < MIN_CONFIDENCE) continue
    out.push({ content, topic, confidence })
    if (out.length >= MAX_NEW_REFLECTIONS_PER_CYCLE) break
  }
  return out
}

/**
 * Merge new reflection candidates into the existing memory array.
 *   - Replaces existing reflections with the same topic (topic is the
 *     dedup key).
 *   - Caps total reflection memories at MAX_REFLECTIONS, evicting the
 *     oldest when the cap is exceeded.
 *   - Leaves non-reflection memories untouched.
 *
 * Pure function; caller persists the result via setMemories.
 */
export function mergeReflections(
  memories: MemoryItem[],
  candidates: ReflectionCandidate[],
  nowIso: string,
): MemoryItem[] {
  if (candidates.length === 0) return memories

  const nonReflection = memories.filter((m) => m.importance !== 'reflection')
  let reflections = memories.filter((m) => m.importance === 'reflection')

  for (const cand of candidates) {
    reflections = reflections.filter((r) => r.reflectionTopic !== cand.topic)
    reflections.push({
      id: `refl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      content: cand.content,
      category: 'reference',
      source: 'dream',
      importance: 'reflection',
      reflectionTopic: cand.topic,
      reflectionConfidence: cand.confidence,
      createdAt: nowIso,
    })
  }

  if (reflections.length > MAX_REFLECTIONS) {
    reflections.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    reflections = reflections.slice(reflections.length - MAX_REFLECTIONS)
  }

  return [...nonReflection, ...reflections]
}

export function extractReflectionsFromMemories(memories: MemoryItem[]): Array<{ topic: string; content: string }> {
  return memories
    .filter((m) => m.importance === 'reflection' && m.reflectionTopic)
    .map((m) => ({ topic: String(m.reflectionTopic), content: m.content }))
}
