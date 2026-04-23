import type {
  ChatMessage,
  DailyMemoryEntry,
  DailyMemoryStore,
  EmotionalValence,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
} from '../../types'
import type { EmotionState } from '../autonomy/emotionModel'
import { computeMemorySignificance } from './decay.ts'
import { createId } from '../../lib/index.ts'

const longTermDuplicateThreshold = 0.72
const dailyDuplicateThreshold = 0.88
const maxLongTermMemories = 500
const maxDailyEntriesPerDay = 16

export function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function wordSet(text: string) {
  return new Set(normalizeText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean))
}

export function scoreLexicalSimilarity(left: string, right: string) {
  const leftWords = wordSet(left)
  const rightWords = wordSet(right)

  if (!leftWords.size || !rightWords.size) {
    return 0
  }

  let shared = 0
  for (const token of leftWords) {
    if (rightWords.has(token)) {
      shared += 1
    }
  }

  return shared / Math.max(leftWords.size, rightWords.size)
}

export function scoreContainment(left: string, right: string) {
  const leftWords = wordSet(left)
  const rightWords = wordSet(right)
  const minSize = Math.min(leftWords.size, rightWords.size)

  if (minSize === 0) {
    return 0
  }

  let shared = 0
  for (const token of leftWords) {
    if (rightWords.has(token)) {
      shared += 1
    }
  }

  return shared / minSize
}

const IMPORTANCE_WEIGHTS: Record<MemoryImportance, number> = {
  pinned: 1.0,
  high: 0.85,
  reflection: 0.6,
  normal: 0.5,
  low: 0.2,
}

const TIME_DECAY_HALF_LIFE_DAYS = 30

export function computeTimeDecay(memoryTimestamp: string, nowMs = Date.now()) {
  const parsed = Date.parse(memoryTimestamp)
  if (Number.isNaN(parsed)) return 1
  const ageMs = nowMs - parsed
  if (ageMs <= 0) return 1
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.pow(0.5, ageDays / TIME_DECAY_HALF_LIFE_DAYS)
}

export function computeMemoryRetentionScore(memory: MemoryItem, nowMs = Date.now()) {
  const importance = memory.importance ?? 'normal'
  if (importance === 'pinned') return 1

  const referenceTime = memory.lastUsedAt ?? memory.createdAt
  const decay = computeTimeDecay(referenceTime, nowMs)
  const weight = IMPORTANCE_WEIGHTS[importance]
  return weight + (1 - weight) * decay
}

function inferCategory(content: string): MemoryCategory {
  const text = normalizeText(content)

  // feedback — user correcting or confirming approach
  if (/(不要这样|别这么|不行|换个|应该用|记住以后|下次|stop|don't|instead|keep doing|perfect|exactly)/.test(text)) {
    return 'feedback'
  }

  // project — ongoing work, deadlines, incidents
  if (/(项目|上线|截止|deadline|sprint|版本|发布|bug|需求|进度|排期|会议|project|release|deploy|merge)/.test(text)) {
    return 'project'
  }

  // reference — pointers to external systems
  if (/(在\s*\S+\s*里|文档在|地址是|链接|url|jira|linear|slack|notion|github|confluence|dashboard)/.test(text)) {
    return 'reference'
  }

  if (/(喜欢|偏好|想要|讨厌|口味|不喜欢|受不了|最爱|热衷|排斥|prefer|favorite|like|dislike|love|hate|enjoy)/.test(text)) {
    return 'preference'
  }

  if (/(计划|目标|打算|准备|希望|想做|想去|需要完成|deadline|里程碑|goal|plan|aim|want to)/.test(text)) {
    return 'goal'
  }

  if (/(每天|经常|习惯|一般会|通常|每周|固定|从不|规律|坚持|定期|habit|usually|every day|often|never)/.test(text)) {
    return 'habit'
  }

  return 'profile'
}

function splitMessageSegments(content: string) {
  return content
    .split(/[。！？!?;\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 6)
}

export function extractMemoriesFromMessage(
  message: ChatMessage,
  emotionState?: EmotionState,
): MemoryItem[] {
  if (message.role !== 'user') {
    return []
  }

  const valence = emotionState ? inferValence(emotionState) : undefined

  return splitMessageSegments(message.content)
    .filter((segment) => (
      /(我是|我叫|我喜欢|我想|我要|我打算|我最近|我在|我的|希望|讨厌|偏好|习惯|计划|准备|我讨厌|我热爱|我常常|我从来|我已经|我正在|我住在|我来自|我工作|不要这样|别这么|记住|下次|项目|上线|截止|文档在|地址是|i am|i'm|my|i like|i want|i plan|i need|i hate|i love|i usually|i always|don't|stop|remember|project|deadline|url|link)/i
        .test(segment)
    ))
    .map((segment) => {
      const category = inferCategory(segment)
      return {
        id: createId('memory'),
        content: segment,
        category,
        source: 'chat',
        importance: inferImportance(segment, category),
        createdAt: new Date().toISOString(),
        emotionSnapshot: emotionState,
        emotionalValence: valence,
        significance: emotionState ? computeMemorySignificance(emotionState) : undefined,
      }
    })
}

function inferValence(emo: EmotionState): EmotionalValence {
  const pos = emo.warmth + emo.energy
  const neg = emo.concern + (1 - emo.energy)
  if (pos > 1.3 && neg < 0.8) return 'positive'
  if (neg > 1.2 && pos < 1.0) return 'negative'
  if (pos > 1.0 && neg > 1.0) return 'mixed'
  return 'neutral'
}

function inferImportance(content: string, category: MemoryCategory): MemoryImportance {
  if (category === 'manual' || category === 'feedback') return 'high'
  const text = normalizeText(content)
  if (/(重要|千万|一定要|绝对不|务必|关键|never|must|always|critical|important)/.test(text)) {
    return 'high'
  }
  return 'normal'
}

export function createManualMemory(content: string): MemoryItem {
  return {
    id: createId('memory'),
    content: content.trim(),
    category: 'manual',
    source: 'manual',
    importance: 'high',
    createdAt: new Date().toISOString(),
  }
}

export function mergeMemories(existing: MemoryItem[], incoming: MemoryItem[]) {
  const merged = [...existing]

  for (const item of incoming) {
    const duplicate = merged.find((candidate) => {
      const jaccard = scoreLexicalSimilarity(candidate.content, item.content)
      if (jaccard >= longTermDuplicateThreshold) {
        return true
      }

      const minWords = Math.min(wordSet(candidate.content).size, wordSet(item.content).size)
      if (minWords >= 3 && scoreContainment(candidate.content, item.content) >= 0.85) {
        return true
      }

      return false
    })

    if (!duplicate) {
      merged.unshift(item)
      continue
    }

    duplicate.lastUsedAt = new Date().toISOString()
  }

  const nowMs = Date.now()
  return merged
    .sort((left, right) => (
      computeMemoryRetentionScore(right, nowMs) - computeMemoryRetentionScore(left, nowMs)
    ))
    .slice(0, maxLongTermMemories)
}

export function rankMemories(memories: MemoryItem[], query: string) {
  const nowMs = Date.now()
  return [...memories]
    .map((memory) => {
      const relevance = scoreLexicalSimilarity(memory.content, query)
      const retention = computeMemoryRetentionScore(memory, nowMs)
      return {
        memory,
        score: relevance * (0.7 + 0.3 * retention),
      }
    })
    .sort((left, right) => right.score - left.score)
    .map(({ memory }) => memory)
}

export function getLocalDayKey(dateLike: string | Date) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function summarizeDailyContent(content: string, maxLength = 120) {
  const collapsed = content.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) {
    return collapsed
  }

  return `${collapsed.slice(0, Math.max(1, maxLength - 1))}…`
}

export function createDailyMemoryEntry(
  message: ChatMessage,
  source: DailyMemoryEntry['source'],
): DailyMemoryEntry | null {
  if (message.role === 'system') {
    return null
  }

  const content = summarizeDailyContent(message.content, message.role === 'assistant' ? 96 : 120)
  if (!content) {
    return null
  }

  return {
    id: createId('daily-memory'),
    day: getLocalDayKey(message.createdAt),
    role: message.role,
    content,
    source,
    createdAt: message.createdAt,
  }
}

export function mergeDailyMemories(
  existing: DailyMemoryStore,
  incoming: DailyMemoryEntry[],
  retentionDays: number,
) {
  const next: DailyMemoryStore = Object.fromEntries(
    Object.entries(existing).map(([day, entries]) => [day, [...entries]]),
  )

  for (const entry of incoming) {
    const list = next[entry.day] ? [...next[entry.day]] : []
    const duplicate = list.find((candidate) => (
      candidate.role === entry.role
      && scoreLexicalSimilarity(candidate.content, entry.content) >= dailyDuplicateThreshold
    ))

    if (!duplicate) {
      list.unshift(entry)
    }

    next[entry.day] = list.slice(0, maxDailyEntriesPerDay)
  }

  return pruneDailyMemories(next, retentionDays)
}

export function pruneDailyMemories(store: DailyMemoryStore, retentionDays: number) {
  const keptDays = Object.keys(store)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, Math.max(1, retentionDays))

  return keptDays.reduce<DailyMemoryStore>((result, day) => {
    const entries = (store[day] ?? []).slice(0, maxDailyEntriesPerDay)
    if (entries.length) {
      result[day] = entries
    }
    return result
  }, {})
}

export function clearDailyMemoriesForDay(store: DailyMemoryStore, day = getLocalDayKey(new Date())) {
  const next = { ...store }
  delete next[day]
  return next
}

export function getRecentDailyEntries(store: DailyMemoryStore, limitDays = 2) {
  return Object.keys(store)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, Math.max(1, limitDays))
    .flatMap((day) => store[day] ?? [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export function updateDailyMemoryEntry(
  store: DailyMemoryStore,
  day: string,
  id: string,
  content: string,
): DailyMemoryStore {
  const entries = store[day]
  if (!entries) return store

  const updated = entries.map((entry) =>
    entry.id === id ? { ...entry, content: content.trim() } : entry,
  )

  return { ...store, [day]: updated }
}

export function removeDailyMemoryEntry(
  store: DailyMemoryStore,
  day: string,
  id: string,
): DailyMemoryStore {
  const entries = store[day]
  if (!entries) return store

  const filtered = entries.filter((entry) => entry.id !== id)
  if (!filtered.length) {
    const next = { ...store }
    delete next[day]
    return next
  }

  return { ...store, [day]: filtered }
}

export function rankDailyEntries(entries: DailyMemoryEntry[], query: string) {
  return [...entries]
    .map((entry) => ({
      entry,
      score: scoreLexicalSimilarity(entry.content, query),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ entry }) => entry)
}
